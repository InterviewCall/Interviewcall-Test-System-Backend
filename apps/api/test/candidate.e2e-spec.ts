import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { ModelService, submitOverdueAttempts } from '@app/model';
import { NotificationsModule } from '@app/notifications';
import { SubmitReason, TestStatus, UserRole } from '@app/prisma';
import { ApiModule } from '../src/api.module.js';
import { configureApp } from '../src/app.setup.js';
import { loadConfig } from '../src/config/app.config.js';
import { ORIGIN, api, seedStaff, signIn } from './support/harness.js';
import type { FakeModel } from './support/harness.js';
import { FakeNotificationsModule, fakeNotifications } from './support/fake-notifications.js';

/**
 * The candidate flow against a real MariaDB with the question bank seeded (npm run seed), because
 * the claims that matter here (locking, scoring, nothing secret leaves the server) are database claims.
 * Run with REAL_DB_E2E=true and the DB_* variables set; skipped otherwise.
 */
const enabled = process.env.REAL_DB_E2E === 'true' && !!process.env.DB_HOST;
const RUN = `e2e${Date.now()}`;
const MINUTE = 60_000;

/** Every property name in a response, however deep. The secrecy checks look at names, not at question text. */
function keysOf(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(keysOf);
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
    return [];
}
const SECRET_KEY = /correct|marks|score|percentage|passed|explanation/i;

function ist(ms: number): string {
    return `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
}

describe.skipIf(!enabled)('candidate flow (real database)', () => {
    let app: NestExpressApplication;
    let db: ModelService;
    let staff: ReturnType<typeof request.agent>;
    let counter = 0;

    // A fresh app per test, so the rate limiter's in-memory counters start from zero.
    beforeEach(async () => {
        process.env.ALLOWED_ORIGINS = ORIGIN;
        process.env.COOKIE_SECURE = 'false';
        const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
            .overrideModule(NotificationsModule)
            .useModule(FakeNotificationsModule)
            .overrideGuard(ThrottlerGuard)
            .useValue({ canActivate: () => true })
            .compile();
        app = moduleRef.createNestApplication<NestExpressApplication>();
        configureApp(app, loadConfig());
        await app.init();
        db = moduleRef.get(ModelService);

        const admin = `${RUN}-admin@example.com`;
        if (!(await db.user.findUnique({ where: { email: admin } }))) {
            await seedStaff(db as unknown as FakeModel, { email: admin, role: UserRole.ADMIN });
        }
        staff = await signIn(app, admin);
    });

    afterEach(async () => {
        await app.close();
    });

    afterAll(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
            .overrideModule(NotificationsModule)
            .useModule(FakeNotificationsModule)
            .compile();
        db = moduleRef.get(ModelService);
        await db.$connect();
        await cleanUp();
        await db.$disconnect();
    });

    async function cleanUp() {
        const where = { candidate: { email: { startsWith: RUN } } };
        await db.attempt.deleteMany({ where: { testSchedule: where } });
        await db.testSchedule.deleteMany({ where });
        await db.candidate.deleteMany({ where: { email: { startsWith: RUN } } });
        await db.session.deleteMany({ where: { user: { email: { startsWith: RUN } } } });
        await db.user.deleteMany({ where: { email: { startsWith: RUN } } });
    }

    /** Books an Advanced test open right now and returns the secret from the invitation email. */
    async function book(windowMinutes = 30) {
        const email = `${RUN}-c${++counter}@example.com`;
        const startsAt = Date.now() - 20_000;
        const res = await staff
            .post('/api/v1/test-schedules')
            .set('Origin', ORIGIN)
            .send({
                candidate: { fullName: 'Rohan Das', email, phone: '+91 70446 10338' },
                level: 'ADVANCED',
                startsAt: ist(startsAt),
                endsAt: ist(startsAt + windowMinutes * MINUTE),
            });
        expect(res.status).toBe(201);
        const mail = fakeNotifications.testScheduledEmails.find((m) => m.email === email)!;
        return { email, scheduleId: res.body.schedule.id as number, token: mail.inviteToken };
    }

    async function signInCandidate(token: string, email: string) {
        const agent = request.agent(app.getHttpServer());
        const res = await agent.post(api('/candidate/session')).set('Origin', ORIGIN).send({ token, email });
        return { agent, res };
    }

    const declarations = { ownWork: true, accurateDetails: true };
    const startBody = { workExperienceYears: 3.5, declarations };

    async function openAttempt(windowMinutes = 30) {
        const booked = await book(windowMinutes);
        const { agent } = await signInCandidate(booked.token, booked.email);
        const started = await agent.post(api('/candidate/attempt/start')).set('Origin', ORIGIN).send(startBody);
        expect(started.status).toBe(200);
        return { ...booked, agent, attempt: started.body };
    }

    async function correctOptions(questionIds: number[]) {
        const rows = await db.questionOption.findMany({
            where: { questionVersionId: { in: questionIds }, isCorrect: true },
            select: { id: true, questionVersionId: true },
        });
        return new Map(rows.map((r) => [r.questionVersionId, r.id]));
    }

    function questionsOf(attempt: { sections: { questions: { questionVersionId: number; options: { id: number }[] }[] }[] }) {
        return attempt.sections.flatMap((s) => s.questions);
    }

    it('opens with the link and the right email, and a wrong link or email is refused the same way', async () => {
        const { email, token } = await book();
        const wrongEmail = await signInCandidate(token, `${RUN}-nobody@example.com`);
        const wrongToken = await signInCandidate('x'.repeat(43), email);
        const right = await signInCandidate(token, email);

        expect(wrongEmail.res.status).toBe(401);
        expect(wrongToken.res.status).toBe(401);
        expect(wrongEmail.res.body.message).toBe(wrongToken.res.body.message);
        expect(right.res.status).toBe(200);
        expect(right.res.headers['set-cookie']?.[0]).toMatch(/ic_candidate_session=.*HttpOnly/);
    });

    it('shows the test card before starting, without giving anything away', async () => {
        const { email, token } = await book();
        const { agent } = await signInCandidate(token, email);
        const res = await agent.get(api('/candidate/test'));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ state: 'READY', level: 'ADVANCED', durationMinutes: 12 });
        expect(res.body.test.questionCount).toBe(12);
        expect(res.body.test.sections).toHaveLength(6);
        expect(new Date(res.body.latestStartAt).getTime()).toBeLessThan(new Date(res.body.endsAt).getTime());
    });

    it('needs a session for everything but opening the link', async () => {
        for (const [method, path] of [
            ['get', '/candidate/test'],
            ['get', '/candidate/attempt'],
            ['post', '/candidate/attempt/start'],
            ['post', '/candidate/attempt/submit'],
        ] as const) {
            const res = await request(app.getHttpServer())[method](api(path)).set('Origin', ORIGIN).send({});
            expect(res.status).toBe(401);
        }
    });

    it('refuses a start without both declarations', async () => {
        const { email, token } = await book();
        const { agent } = await signInCandidate(token, email);
        const res = await agent
            .post(api('/candidate/attempt/start'))
            .set('Origin', ORIGIN)
            .send({ workExperienceYears: 2, declarations: { ownWork: true, accurateDetails: false } });
        expect(res.status).toBe(400);
    });

    it('starts the clock on the server, resumes the same attempt, and never sends the answers', async () => {
        const { agent, attempt } = await openAttempt();

        expect(attempt.status).toBe('IN_PROGRESS');
        const length = new Date(attempt.deadlineAt).getTime() - new Date(attempt.startedAt).getTime();
        expect(length).toBe(12 * MINUTE);
        expect(questionsOf(attempt)).toHaveLength(12);
        expect(keysOf(attempt).filter((key) => SECRET_KEY.test(key))).toEqual([]);

        const again = await agent.post(api('/candidate/attempt/start')).set('Origin', ORIGIN).send(startBody);
        expect(again.body.deadlineAt).toBe(attempt.deadlineAt);
        expect(questionsOf(again.body).map((q) => q.questionVersionId)).toEqual(questionsOf(attempt).map((q) => q.questionVersionId));

        const resumed = await agent.get(api('/candidate/attempt'));
        expect(resumed.body.deadlineAt).toBe(attempt.deadlineAt);
        expect((await agent.get(api('/candidate/test'))).body.state).toBe('IN_PROGRESS');
    });

    it('saves answers, lets them change or clear, and refuses an option from another question', async () => {
        const { agent, attempt } = await openAttempt();
        const [first, second] = questionsOf(attempt);
        const save = (id: number, optionId: number | null) =>
            agent.put(api(`/candidate/attempt/answers/${id}`)).set('Origin', ORIGIN).send({ optionId });

        expect((await save(first!.questionVersionId, first!.options[0]!.id)).status).toBe(200);
        expect((await save(first!.questionVersionId, first!.options[1]!.id)).status).toBe(200);
        expect((await save(second!.questionVersionId, first!.options[0]!.id)).status).toBe(400);
        expect((await save(999_999_999, null)).status).toBe(404);

        let saved = questionsOf((await agent.get(api('/candidate/attempt'))).body);
        expect(saved.find((q) => q.questionVersionId === first!.questionVersionId)!.selectedOptionId).toBe(first!.options[1]!.id);

        expect((await save(first!.questionVersionId, null)).status).toBe(200);
        saved = questionsOf((await agent.get(api('/candidate/attempt'))).body);
        expect(saved.find((q) => q.questionVersionId === first!.questionVersionId)!.selectedOptionId).toBeNull();
    });

    it('scores on submit from the stored answers, once, and says nothing about the score', async () => {
        const { agent, attempt, scheduleId } = await openAttempt();
        const questions = questionsOf(attempt);
        const right = await correctOptions(questions.map((q) => q.questionVersionId));

        // 5 right, 3 wrong, 4 left blank.
        for (const [i, q] of questions.entries()) {
            if (i >= 8) break;
            const wrong = q.options.find((o) => o.id !== right.get(q.questionVersionId))!.id;
            const optionId = i < 5 ? right.get(q.questionVersionId)! : wrong;
            await agent.put(api(`/candidate/attempt/answers/${q.questionVersionId}`)).set('Origin', ORIGIN).send({ optionId });
        }

        const submit = await agent.post(api('/candidate/attempt/submit')).set('Origin', ORIGIN);
        expect(submit.status).toBe(200);
        expect(submit.body.status).toBe('SUBMITTED');
        expect(keysOf(submit.body).filter((key) => SECRET_KEY.test(key))).toEqual([]);

        const again = await agent.post(api('/candidate/attempt/submit')).set('Origin', ORIGIN);
        expect(again.body.submittedAt).toBe(submit.body.submittedAt);

        const late = await agent
            .put(api(`/candidate/attempt/answers/${questions[10]!.questionVersionId}`))
            .set('Origin', ORIGIN)
            .send({ optionId: right.get(questions[10]!.questionVersionId) });
        expect(late.status).toBe(409);

        const stored = await db.attempt.findUniqueOrThrow({
            where: { testScheduleId: scheduleId },
            include: { result: true, testSchedule: true },
        });
        expect(stored.submitReason).toBe(SubmitReason.CANDIDATE);
        expect(stored.testSchedule.status).toBe(TestStatus.SUBMITTED);
        const perQuestion = stored.result!.totalMarks / 12;
        expect(perQuestion).toBeGreaterThan(0);
        expect(stored.result).toMatchObject({ obtainedMarks: 5 * perQuestion, reportStatus: 'PENDING' });
        expect(Number(stored.result!.percentage)).toBe(41.67);
        expect(stored.result!.passed).toBe(false);
        expect(await db.result.count({ where: { attemptId: stored.id } })).toBe(1);

        expect((await agent.get(api('/candidate/attempt'))).body).toMatchObject({ status: 'SUBMITTED', sections: [] });
        expect((await agent.get(api('/candidate/test'))).body.state).toBe('SUBMITTED');
    });

    it('gives staff a report once submitted, with the key, and keeps it from candidates and other advisors', async () => {
        const { agent, attempt, scheduleId } = await openAttempt();
        const questions = questionsOf(attempt);
        const right = await correctOptions(questions.map((q) => q.questionVersionId));
        for (const [i, q] of questions.entries()) {
            if (i >= 4) break;
            const optionId = right.get(q.questionVersionId)!;
            await agent.put(api(`/candidate/attempt/answers/${q.questionVersionId}`)).set('Origin', ORIGIN).send({ optionId });
        }

        // Nothing to show until the candidate submits.
        const early = await staff.get(api(`/test-schedules/${scheduleId}/report`));
        expect(early.status).toBe(409);
        expect(early.body.code).toBe('REPORT_NOT_READY');

        await agent.post(api('/candidate/attempt/submit')).set('Origin', ORIGIN);
        const res = await staff.get(api(`/test-schedules/${scheduleId}/report`));
        expect(res.status).toBe(200);
        expect(res.body.result).toMatchObject({ obtainedMarks: res.body.result.totalMarks / 3, passed: false });
        expect(res.body.topics.flatMap((t: { items: unknown[] }) => t.items)).toHaveLength(12);
        const items = res.body.topics.flatMap((t: { items: { status: string; options: { isCorrect: boolean }[] }[] }) => t.items);
        expect(items.filter((i: { status: string }) => i.status === 'correct')).toHaveLength(4);
        expect(items.filter((i: { status: string }) => i.status === 'blank')).toHaveLength(8);
        expect(items.every((i: { options: { isCorrect: boolean }[] }) => i.options.filter((o) => o.isCorrect).length === 1)).toBe(true);

        // Candidates have no way in; another advisor sees the same "not found" as for a missing test.
        expect((await agent.get(api(`/test-schedules/${scheduleId}/report`))).status).toBe(401);
        const other = `${RUN}-advisor@example.com`;
        await seedStaff(db as unknown as FakeModel, { email: other, role: UserRole.ADVISOR });
        const advisor = await signIn(app, other);
        expect((await advisor.get(api(`/test-schedules/${scheduleId}/report`))).status).toBe(404);
    });

    it('takes feedback only after submitting, and only once', async () => {
        const { agent } = await openAttempt();
        const send = () => agent.post(api('/candidate/feedback')).set('Origin', ORIGIN).send({ rating: 4, comment: 'Clear questions' });
        expect((await send()).status).toBe(409);
        await agent.post(api('/candidate/attempt/submit')).set('Origin', ORIGIN);
        expect((await send()).status).toBe(204);
        expect((await send()).status).toBe(204);
        expect((await agent.post(api('/candidate/feedback')).set('Origin', ORIGIN).send({ rating: 9 })).status).toBe(400);
    });

    it('submits what was saved when time runs out, even if the candidate never comes back', async () => {
        const { agent, attempt, scheduleId } = await openAttempt();
        const [first] = questionsOf(attempt);
        const right = await correctOptions([first!.questionVersionId]);
        await agent
            .put(api(`/candidate/attempt/answers/${first!.questionVersionId}`))
            .set('Origin', ORIGIN)
            .send({ optionId: right.get(first!.questionVersionId) });

        // Inside the ten-second grace the clock is still open.
        await db.attempt.update({ where: { testScheduleId: scheduleId }, data: { deadlineAt: new Date(Date.now() - 5_000) } });
        const grace = await agent
            .put(api(`/candidate/attempt/answers/${first!.questionVersionId}`))
            .set('Origin', ORIGIN)
            .send({ optionId: right.get(first!.questionVersionId) });
        expect(grace.status).toBe(200);

        // Past it, the worker submits.
        await db.attempt.update({ where: { testScheduleId: scheduleId }, data: { deadlineAt: new Date(Date.now() - 11_000) } });
        expect(await submitOverdueAttempts(db)).toBeGreaterThanOrEqual(1);

        const stored = await db.attempt.findUniqueOrThrow({ where: { testScheduleId: scheduleId }, include: { result: true } });
        expect(stored.submitReason).toBe(SubmitReason.TIMEOUT);
        expect(stored.result!.obtainedMarks).toBe(stored.result!.totalMarks / 12);
        expect((await agent.post(api('/candidate/attempt/submit')).set('Origin', ORIGIN)).status).toBe(200);
    });

    it('submits on the spot when a returning candidate finds the clock has run out', async () => {
        const { agent, scheduleId } = await openAttempt();
        await db.attempt.update({ where: { testScheduleId: scheduleId }, data: { deadlineAt: new Date(Date.now() - 20_000) } });

        const res = await agent.get(api('/candidate/attempt'));
        expect(res.body.status).toBe('SUBMITTED');
        const put = await agent.put(api('/candidate/attempt/answers/1')).set('Origin', ORIGIN).send({ optionId: null });
        expect(put.status).toBe(409);
        expect((await db.attempt.findUniqueOrThrow({ where: { testScheduleId: scheduleId } })).submitReason).toBe(SubmitReason.TIMEOUT);
    });

    it('lets two starts at once make exactly one attempt', async () => {
        const { email, token, scheduleId } = await book();
        const { agent } = await signInCandidate(token, email);
        const results = await Promise.all(
            [1, 2, 3].map(() => agent.post(api('/candidate/attempt/start')).set('Origin', ORIGIN).send(startBody)),
        );
        expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
        expect(new Set(results.map((r) => r.body.deadlineAt)).size).toBe(1);
        expect(await db.attempt.count({ where: { testScheduleId: scheduleId } })).toBe(1);
    });

    describe('when the slot is over', () => {
        it('turns the link away once the window has closed, and a missed slot cannot be started', async () => {
            const { email, token, scheduleId } = await book();
            await db.testSchedule.update({ where: { id: scheduleId }, data: { endsAt: new Date(Date.now() - MINUTE) } });
            const { res } = await signInCandidate(token, email);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('TEST_CLOSED');
        });

        it('cuts off a session already open the moment the window closes', async () => {
            const { email, token, scheduleId } = await book();
            const { agent } = await signInCandidate(token, email);
            await db.testSchedule.update({ where: { id: scheduleId }, data: { endsAt: new Date(Date.now() - MINUTE) } });
            const res = await agent.post(api('/candidate/attempt/start')).set('Origin', ORIGIN).send(startBody);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('TEST_CLOSED');
        });

        it('refuses an expired test, until staff reschedule it with a new link', async () => {
            const { email, token, scheduleId } = await book();
            const old = await signInCandidate(token, email);
            await db.testSchedule.update({
                where: { id: scheduleId },
                data: { status: TestStatus.EXPIRED, endsAt: new Date(Date.now() - 5 * MINUTE), startsAt: new Date(Date.now() - 40 * MINUTE) },
            });
            expect((await signInCandidate(token, email)).res.status).toBe(403);
            expect((await old.agent.get(api('/candidate/test'))).status).toBe(403);

            const startsAt = Date.now() + 2 * MINUTE;
            const moved = await staff
                .post(`/api/v1/test-schedules/${scheduleId}/reschedule`)
                .set('Origin', ORIGIN)
                .send({ startsAt: ist(startsAt), endsAt: ist(startsAt + 60 * MINUTE) });
            expect(moved.status).toBe(200);
            const fresh = fakeNotifications.testRescheduledEmails.filter((m) => m.email === email).at(-1)!;
            expect(fresh.inviteToken).not.toBe(token);

            // The old link and the browser that had it are finished; the new link works.
            expect((await signInCandidate(token, email)).res.status).toBe(401);
            expect((await old.agent.get(api('/candidate/test'))).status).toBe(401);
            const reopened = await signInCandidate(fresh.inviteToken, email);
            expect(reopened.res.status).toBe(200);
            expect((await reopened.agent.get(api('/candidate/test'))).body.state).toBe('NOT_OPEN');
            const early = await reopened.agent.post(api('/candidate/attempt/start')).set('Origin', ORIGIN).send(startBody);
            expect(early.status).toBe(409);
            expect(early.body.code).toBe('NOT_OPEN_YET');
        });

        it('makes a resent invitation the only working link', async () => {
            const { email, token, scheduleId } = await book();
            const res = await staff.post(`/api/v1/test-schedules/${scheduleId}/resend-email`).set('Origin', ORIGIN);
            expect(res.status).toBe(200);
            const newest = fakeNotifications.testScheduledEmails.filter((m) => m.email === email).at(-1)!;
            expect((await signInCandidate(token, email)).res.status).toBe(401);
            expect((await signInCandidate(newest.inviteToken, email)).res.status).toBe(200);
        });
    });
});
