import type { NestExpressApplication } from '@nestjs/platform-express';
import { UserRole } from '@app/prisma';
import { api, buildApp, createFakeModel, seedStaff, signIn } from './support/harness.js';
import type { FakeModel } from './support/harness.js';
import { fakeNotifications } from './support/fake-notifications.js';
import { ExpiryService } from '../../worker/src/expiry/expiry.service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** An ISO string in Indian time, the way the console will send it. */
function ist(ms: number): string {
    const shifted = new Date(ms + 5.5 * HOUR).toISOString().slice(0, 19);
    return `${shifted}+05:30`;
}

/** A slot tomorrow: opens at `startsAt`, closes `windowMinutes` later. */
function slot(windowMinutes = 60) {
    const startsAtMs = Date.now() + DAY;
    return { startsAt: ist(startsAtMs), endsAt: ist(startsAtMs + windowMinutes * 60_000), startsAtMs };
}

const candidate = (overrides: Record<string, unknown> = {}) => ({
    fullName: 'Rohan Das',
    email: 'rohan@example.com',
    phone: '+91 70446 10338',
    ...overrides,
});

describe('test schedules', () => {
    let app: NestExpressApplication;
    let db: FakeModel;

    beforeEach(async () => {
        fakeNotifications.staffEmails = [];
        fakeNotifications.testScheduledEmails = [];
        fakeNotifications.testRescheduledEmails = [];
        fakeNotifications.queueIsUp = true;
        db = createFakeModel();
        await seedStaff(db, { email: 'admin@example.com', fullName: 'Ada Admin', role: UserRole.ADMIN });
        await seedStaff(db, { email: 'asha@example.com', fullName: 'Asha Advisor', role: UserRole.ADVISOR });
        await seedStaff(db, { email: 'ben@example.com', fullName: 'Ben Advisor', role: UserRole.ADVISOR });
        await seedStaff(db, { email: 'eli@example.com', fullName: 'Eli Editor', role: UserRole.EDITOR });
        await seedStaff(db, { email: 'mia@example.com', fullName: 'Mia Manager', role: UserRole.MANAGER });
        app = await buildApp(db);
    });
    afterEach(() => app.close());

    describe('scheduling', () => {
        it('books an Intermediate test as 22 minutes and queues the invitation', async () => {
            const admin = await signIn(app, 'admin@example.com');
            const when = slot(60);

            const res = await admin
                .post(api('/test-schedules'))
                .send({ candidate: candidate(), level: 'INTERMEDIATE', startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);

            expect(res.body.emailQueued).toBe(true);
            expect(res.body.schedule).toMatchObject({
                level: 'INTERMEDIATE',
                durationMinutes: 22,
                status: 'INVITED',
                candidate: { fullName: 'Rohan Das', email: 'rohan@example.com', phone: '+91 70446 10338' },
                invitedBy: { fullName: 'Ada Admin' },
            });
            expect(new Date(res.body.schedule.startsAt).getTime()).toBe(Math.floor(when.startsAtMs / 1000) * 1000);
            expect(new Date(res.body.schedule.latestStartAt).getTime()).toBe(
                new Date(res.body.schedule.endsAt).getTime() - 22 * 60_000,
            );
            expect(res.body.schedule.invitationQueuedAt).not.toBeNull();

            expect(fakeNotifications.testScheduledEmails).toHaveLength(1);
            const email = fakeNotifications.testScheduledEmails[0];
            expect(email).toMatchObject({ fullName: 'Rohan Das', email: 'rohan@example.com', durationMinutes: 22 });
            expect(email.startsAt.toISOString()).toBe(new Date(res.body.schedule.startsAt).toISOString());
            expect(email.endsAt.toISOString()).toBe(new Date(res.body.schedule.endsAt).toISOString());
        });

        it('books an Advanced test as 12 minutes, in the record and in the email', async () => {
            const admin = await signIn(app, 'admin@example.com');
            const when = slot(30);

            const res = await admin
                .post(api('/test-schedules'))
                .send({ candidate: candidate(), level: 'ADVANCED', startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);

            expect(res.body.schedule).toMatchObject({ level: 'ADVANCED', durationMinutes: 12 });
            expect(fakeNotifications.testScheduledEmails[0].durationMinutes).toBe(12);
        });

        it('lets an advisor schedule, and records them as the inviter', async () => {
            const asha = await signIn(app, 'asha@example.com');
            const when = slot();
            const res = await asha
                .post(api('/test-schedules'))
                .send({ candidate: candidate(), level: 'ADVANCED', startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);
            expect(res.body.schedule.invitedBy.fullName).toBe('Asha Advisor');
        });

        it('keeps editors and signed-out visitors out', async () => {
            const eli = await signIn(app, 'eli@example.com');
            const when = slot();
            const body = { candidate: candidate(), level: 'ADVANCED', startsAt: when.startsAt, endsAt: when.endsAt };
            await eli.post(api('/test-schedules')).send(body).expect(403);
            await eli.get(api('/test-schedules')).expect(403);

            const anonymous = (await import('supertest')).default(app.getHttpServer());
            await anonymous.post(api('/test-schedules')).send(body).expect(401);
            expect(db._candidates).toHaveLength(0);
            expect(fakeNotifications.testScheduledEmails).toHaveLength(0);
        });

        it('books as many tests as asked for one email, even after an earlier one was submitted', async () => {
            const admin = await signIn(app, 'admin@example.com');
            const when = slot();
            const body = (email: string, level: 'INTERMEDIATE' | 'ADVANCED') => ({
                candidate: candidate({ email }),
                level,
                startsAt: when.startsAt,
                endsAt: when.endsAt,
            });
            const first = await admin.post(api('/test-schedules')).send(body('rohan@example.com', 'ADVANCED')).expect(201);

            // Finished: the candidate submitted it. A second test for the same person is still welcome.
            db._schedules[0].status = 'SUBMITTED';
            const second = await admin.post(api('/test-schedules')).send(body('Rohan@Example.COM', 'INTERMEDIATE')).expect(201);
            const third = await admin.post(api('/test-schedules')).send(body('rohan@example.com', 'ADVANCED')).expect(201);

            // One person, three separate tests.
            expect(db._candidates).toHaveLength(1);
            expect(db._schedules).toHaveLength(3);
            const ids = [first, second, third].map((res) => res.body.schedule.id);
            expect(new Set(ids).size).toBe(3);
            expect(second.body.schedule.candidate.id).toBe(first.body.schedule.candidate.id);

            // Each test has its own email and its own link, so one never opens or retires another.
            expect(fakeNotifications.testScheduledEmails).toHaveLength(3);
            const tokens = fakeNotifications.testScheduledEmails.map((email) => email.inviteToken);
            expect(new Set(tokens).size).toBe(3);

            // The earlier test is left exactly as it was.
            expect(db._schedules[0].status).toBe('SUBMITTED');
        });

        it('reuses a known candidate who has no test yet', async () => {
            const admin = await signIn(app, 'admin@example.com');
            await db.candidate.create({ data: { fullName: 'Rohan Existing', email: 'rohan@example.com' } });
            const when = slot();

            const res = await admin
                .post(api('/test-schedules'))
                .send({ candidate: candidate(), level: 'INTERMEDIATE', startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);

            expect(db._candidates).toHaveLength(1);
            expect(res.body.schedule.candidate.fullName).toBe('Rohan Existing');
            expect(res.body.schedule.candidate.phone).toBe('+91 70446 10338'); // they had none, so the new one is kept
        });

        it('keeps the phone a known candidate already has', async () => {
            const admin = await signIn(app, 'admin@example.com');
            await db.candidate.create({ data: { fullName: 'Rohan Existing', email: 'rohan@example.com', phone: '+91 11111 11111' } });
            const when = slot();
            const res = await admin
                .post(api('/test-schedules'))
                .send({ candidate: candidate(), level: 'INTERMEDIATE', startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);
            expect(res.body.schedule.candidate.phone).toBe('+91 11111 11111');
        });

        describe('rejects a request that does not make sense', () => {
            const when = () => slot(60);
            const post = async (body: object) => (await signIn(app, 'admin@example.com')).post(api('/test-schedules')).send(body);
            const valid = () => ({ candidate: candidate(), level: 'INTERMEDIATE', startsAt: when().startsAt, endsAt: when().endsAt });

            it.each([
                ['an unknown level', (b: any) => ({ ...b, level: 'EXPERT' })],
                ['no level', ({ level: _l, ...b }: any) => b],
                ['a time without an offset', (b: any) => ({ ...b, startsAt: '2026-12-01T10:00:00' })],
                ['a date that is not a time', (b: any) => ({ ...b, endsAt: 'tomorrow' })],
                ['a bad email', (b: any) => ({ ...b, candidate: candidate({ email: 'not-an-email' }) })],
                ['a one-letter name', (b: any) => ({ ...b, candidate: candidate({ fullName: 'R' }) })],
                ['a bad phone number', (b: any) => ({ ...b, candidate: candidate({ phone: 'call me' }) })],
                ['no phone number', (b: any) => ({ ...b, candidate: { fullName: 'Rohan Das', email: 'rohan@example.com' } })],
                ['an unknown field', (b: any) => ({ ...b, durationMinutes: 5 })],
                ['an unknown candidate field', (b: any) => ({ ...b, candidate: candidate({ role: 'ADMIN' }) })],
            ])('%s', async (_name, change) => {
                expect((await post(change(valid()))).status).toBe(400);
                expect(db._schedules).toHaveLength(0);
                expect(fakeNotifications.testScheduledEmails).toHaveLength(0);
            });

            it('an end before the start', async () => {
                const w = slot(60);
                expect((await post({ ...valid(), startsAt: w.endsAt, endsAt: w.startsAt })).status).toBe(400);
            });

            it('a window shorter than the test: 20 minutes is too short for Intermediate but fine for Advanced', async () => {
                const w = slot(20);
                const tooShort = await post({ candidate: candidate(), level: 'INTERMEDIATE', startsAt: w.startsAt, endsAt: w.endsAt });
                expect(tooShort.status).toBe(400);
                expect(JSON.stringify(tooShort.body)).toContain('at least 22 minutes');

                const fine = await post({ candidate: candidate(), level: 'ADVANCED', startsAt: w.startsAt, endsAt: w.endsAt });
                expect(fine.status).toBe(201);
            });

            it('a window longer than 7 days', async () => {
                const w = slot(8 * 24 * 60);
                expect((await post({ ...valid(), startsAt: w.startsAt, endsAt: w.endsAt })).status).toBe(400);
            });

            it('a start time that has already passed, even when the window is still open', async () => {
                // 4 PM today, asked for at 7:46 PM, closing at 10 PM: the window is open but the start is behind us.
                const res = await post({
                    candidate: candidate(),
                    level: 'INTERMEDIATE',
                    startsAt: ist(Date.now() - 3 * HOUR),
                    endsAt: ist(Date.now() + 3 * HOUR),
                });
                expect(res.status).toBe(400);
                expect(JSON.stringify(res.body)).toContain('startsAt');
                expect(JSON.stringify(res.body)).toContain('must not be in the past');
                expect(db._schedules).toHaveLength(0);
                expect(db._candidates).toHaveLength(0);
                expect(fakeNotifications.testScheduledEmails).toHaveLength(0);
            });

            it('a window that closed hours ago', async () => {
                const res = await post({
                    candidate: candidate(),
                    level: 'ADVANCED',
                    startsAt: ist(Date.now() - 5 * HOUR),
                    endsAt: ist(Date.now() - 4 * HOUR),
                });
                expect(res.status).toBe(400);
                expect(db._schedules).toHaveLength(0);
            });

            it('accepts a start of right now, allowing a little clock drift', async () => {
                const res = await post({
                    candidate: candidate(),
                    level: 'INTERMEDIATE',
                    startsAt: ist(Date.now() - 20_000),
                    endsAt: ist(Date.now() + 60 * 60_000),
                });
                expect(res.status).toBe(201);
            });
        });

        it('keeps the booking and says so when the email cannot be queued', async () => {
            const admin = await signIn(app, 'admin@example.com');
            fakeNotifications.queueIsUp = false;
            const when = slot();

            const res = await admin
                .post(api('/test-schedules'))
                .send({ candidate: candidate(), level: 'ADVANCED', startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);

            expect(res.body.emailQueued).toBe(false);
            expect(res.body.schedule.invitationQueuedAt).toBeNull();
            expect(db._schedules).toHaveLength(1);
        });
    });

    describe('resending the invitation', () => {
        async function bookAs(email: string, level = 'INTERMEDIATE') {
            const agent = await signIn(app, email);
            const when = slot();
            const res = await agent
                .post(api('/test-schedules'))
                .send({ candidate: candidate({ email: `c-${Math.random().toString(36).slice(2)}@example.com` }), level, startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);
            return { agent, id: res.body.schedule.id as number };
        }

        it('queues it again once the queue is back', async () => {
            fakeNotifications.queueIsUp = false;
            const { agent, id } = await bookAs('asha@example.com');
            expect(fakeNotifications.testScheduledEmails).toHaveLength(0);

            fakeNotifications.queueIsUp = true;
            const res = await agent.post(api(`/test-schedules/${id}/resend-email`)).expect(200);

            expect(res.body.emailQueued).toBe(true);
            expect(res.body.schedule.invitationQueuedAt).not.toBeNull();
            expect(fakeNotifications.testScheduledEmails).toHaveLength(1);
            expect(fakeNotifications.testScheduledEmails[0].durationMinutes).toBe(22);
        });

        it('reports false again if the queue is still down', async () => {
            const { agent, id } = await bookAs('asha@example.com');
            fakeNotifications.queueIsUp = false;
            const res = await agent.post(api(`/test-schedules/${id}/resend-email`)).expect(200);
            expect(res.body.emailQueued).toBe(false);
        });

        it('refuses once the test has started, been submitted or expired', async () => {
            const { agent, id } = await bookAs('asha@example.com');
            for (const status of ['IN_PROGRESS', 'SUBMITTED', 'EXPIRED']) {
                db._schedules.find((s) => s.id === id)!.status = status;
                await agent.post(api(`/test-schedules/${id}/resend-email`)).expect(409);
            }
            expect(fakeNotifications.testScheduledEmails).toHaveLength(1); // only the original
        });

        it('refuses when the slot has gone, because that test has now expired', async () => {
            const { agent, id } = await bookAs('asha@example.com');
            db._schedules.find((s) => s.id === id)!.endsAt = new Date(Date.now() - HOUR);
            const res = await agent.post(api(`/test-schedules/${id}/resend-email`)).expect(409);
            expect(res.body.message).toMatch(/expired/);
            expect(fakeNotifications.testScheduledEmails).toHaveLength(1); // only the original
        });

        it("hides other advisors' tests, but not from an admin", async () => {
            const { id } = await bookAs('asha@example.com');
            const ben = await signIn(app, 'ben@example.com');
            await ben.post(api(`/test-schedules/${id}/resend-email`)).expect(404);

            const admin = await signIn(app, 'admin@example.com');
            await admin.post(api(`/test-schedules/${id}/resend-email`)).expect(200);
            await admin.post(api('/test-schedules/9999/resend-email')).expect(404);
        });

        it('lets a manager resend any advisor’s invitation', async () => {
            const { id } = await bookAs('asha@example.com');
            const mia = await signIn(app, 'mia@example.com');
            await mia.post(api(`/test-schedules/${id}/resend-email`)).expect(200);
        });
    });

    describe('rescheduling', () => {
        async function book(email: string, level = 'INTERMEDIATE', windowMinutes = 60) {
            const agent = await signIn(app, email);
            const when = slot(windowMinutes);
            const res = await agent
                .post(api('/test-schedules'))
                .send({ candidate: candidate({ email: `c-${Math.random().toString(36).slice(2)}@example.com` }), level, startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);
            return { agent, id: res.body.schedule.id as number };
        }
        const later = (days = 3, windowMinutes = 60) => {
            const startsAtMs = Math.floor((Date.now() + days * DAY) / 1000) * 1000; // ISO strings carry whole seconds
            return { startsAt: ist(startsAtMs), endsAt: ist(startsAtMs + windowMinutes * 60_000), startsAtMs };
        };
        const row = (id: number) => db._schedules.find((s) => s.id === id)!;

        it('moves the window, keeps the level and duration, and emails the new time', async () => {
            const { agent, id } = await book('asha@example.com', 'ADVANCED');
            const to = later();
            const res = await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: to.startsAt, endsAt: to.endsAt }).expect(200);

            expect(res.body.emailQueued).toBe(true);
            expect(res.body.schedule).toMatchObject({ id, level: 'ADVANCED', durationMinutes: 12, status: 'INVITED' });
            expect(new Date(res.body.schedule.startsAt).getTime()).toBe(to.startsAtMs);
            expect(res.body.schedule.invitationQueuedAt).not.toBeNull();
            expect(fakeNotifications.testRescheduledEmails).toHaveLength(1);
            expect(fakeNotifications.testRescheduledEmails[0]).toMatchObject({ durationMinutes: 12, startsAt: new Date(to.startsAtMs) });
            // The first email stays the only "scheduled" one: moving a test never sends the original again.
            expect(fakeNotifications.testScheduledEmails).toHaveLength(1);
        });

        it('lets a candidate who missed their slot, or whose test expired, be given a new one', async () => {
            for (const status of ['INVITED', 'EXPIRED']) {
                const { agent, id } = await book('asha@example.com');
                const missed = row(id);
                missed.status = status;
                missed.startsAt = new Date(Date.now() - 3 * HOUR);
                missed.endsAt = new Date(Date.now() - 2 * HOUR);
                const to = later(1);
                const res = await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: to.startsAt, endsAt: to.endsAt }).expect(200);
                expect(res.body.schedule.status).toBe('INVITED');
            }
        });

        it('refuses once the candidate has started or submitted', async () => {
            const { agent, id } = await book('asha@example.com');
            const before = row(id).startsAt;
            for (const status of ['IN_PROGRESS', 'SUBMITTED']) {
                row(id).status = status;
                const to = later();
                await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: to.startsAt, endsAt: to.endsAt }).expect(409);
            }
            expect(row(id).startsAt).toBe(before);
            expect(fakeNotifications.testRescheduledEmails).toHaveLength(0);
        });

        describe('rejects a window that does not make sense', () => {
            it('an end before the start', async () => {
                const { agent, id } = await book('asha@example.com');
                const to = later();
                const res = await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: to.endsAt, endsAt: to.startsAt }).expect(400);
                expect(JSON.stringify(res.body)).toContain('endsAt');
            });

            it('a window shorter than this test: 20 minutes is too short for Intermediate, fine for Advanced', async () => {
                const intermediate = await book('asha@example.com', 'INTERMEDIATE');
                const short = later(3, 20);
                await intermediate.agent.post(api(`/test-schedules/${intermediate.id}/reschedule`)).send({ startsAt: short.startsAt, endsAt: short.endsAt }).expect(400);

                const advanced = await book('asha@example.com', 'ADVANCED');
                await advanced.agent.post(api(`/test-schedules/${advanced.id}/reschedule`)).send({ startsAt: short.startsAt, endsAt: short.endsAt }).expect(200);
            });

            it('a window longer than 7 days', async () => {
                const { agent, id } = await book('asha@example.com');
                const to = later(2, 8 * 24 * 60);
                await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: to.startsAt, endsAt: to.endsAt }).expect(400);
            });

            it('a start time that has already passed, even when the window is still open', async () => {
                const { agent, id } = await book('asha@example.com');
                const before = row(id).startsAt;
                const res = await agent
                    .post(api(`/test-schedules/${id}/reschedule`))
                    .send({ startsAt: ist(Date.now() - 3 * HOUR), endsAt: ist(Date.now() + 3 * HOUR) })
                    .expect(400);
                expect(JSON.stringify(res.body)).toContain('must not be in the past');
                expect(row(id).startsAt).toBe(before);
                expect(fakeNotifications.testRescheduledEmails).toHaveLength(0);
            });

            it('extra or missing fields', async () => {
                const { agent, id } = await book('asha@example.com');
                const to = later();
                await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: to.startsAt }).expect(400);
                await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ ...to, level: 'ADVANCED' }).expect(400);
            });

            it('leaves the test untouched every time', async () => {
                const { agent, id } = await book('asha@example.com');
                const before = { ...row(id) };
                await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: 'soon', endsAt: 'later' }).expect(400);
                expect(row(id).startsAt).toEqual(before.startsAt);
                expect(row(id).invitationQueuedAt).toEqual(before.invitationQueuedAt);
            });
        });

        it('keeps the new time and says so when the email cannot be queued, so it can be resent', async () => {
            const { agent, id } = await book('asha@example.com');
            fakeNotifications.queueIsUp = false;
            const to = later();
            const res = await agent.post(api(`/test-schedules/${id}/reschedule`)).send({ startsAt: to.startsAt, endsAt: to.endsAt }).expect(200);

            expect(res.body.emailQueued).toBe(false);
            expect(res.body.schedule.invitationQueuedAt).toBeNull();
            expect(new Date(res.body.schedule.startsAt).getTime()).toBe(to.startsAtMs);

            fakeNotifications.queueIsUp = true;
            const resent = await agent.post(api(`/test-schedules/${id}/resend-email`)).expect(200);
            expect(resent.body.emailQueued).toBe(true);
        });

        it("hides other advisors' tests, but not from an admin; editors and signed-out visitors are out", async () => {
            const { id } = await book('asha@example.com');
            const to = later();
            const body = { startsAt: to.startsAt, endsAt: to.endsAt };

            await (await signIn(app, 'ben@example.com')).post(api(`/test-schedules/${id}/reschedule`)).send(body).expect(404);
            expect(row(id).startsAt.getTime()).not.toBe(to.startsAtMs);

            await (await signIn(app, 'admin@example.com')).post(api(`/test-schedules/${id}/reschedule`)).send(body).expect(200);
            await (await signIn(app, 'admin@example.com')).post(api('/test-schedules/9999/reschedule')).send(body).expect(404);

            await (await signIn(app, 'eli@example.com')).post(api(`/test-schedules/${id}/reschedule`)).send(body).expect(403);
            await (await import('supertest')).default(app.getHttpServer()).post(api(`/test-schedules/${id}/reschedule`)).send(body).expect(401);
        });
    });

    describe('as a manager', () => {
        it('reschedules and schedules for any advisor, like an admin', async () => {
            const asha = await signIn(app, 'asha@example.com');
            const when = slot();
            const booked = await asha
                .post(api('/test-schedules'))
                .send({ candidate: candidate(), level: 'INTERMEDIATE', startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(201);
            const id = booked.body.schedule.id as number;

            const mia = await signIn(app, 'mia@example.com');
            const startsAtMs = Math.floor((Date.now() + 3 * DAY) / 1000) * 1000;
            await mia
                .post(api(`/test-schedules/${id}/reschedule`))
                .send({ startsAt: ist(startsAtMs), endsAt: ist(startsAtMs + HOUR) })
                .expect(200);
            expect(db._schedules.find((s) => s.id === id)!.startsAt.getTime()).toBe(startsAtMs);

            const own = slot();
            const res = await mia
                .post(api('/test-schedules'))
                .send({ candidate: candidate({ email: 'new@example.com' }), level: 'ADVANCED', startsAt: own.startsAt, endsAt: own.endsAt })
                .expect(201);
            expect(res.body.schedule.invitedBy.fullName).toBe('Mia Manager');
        });
    });

    describe('viewing', () => {
        async function book(email: string, who: string, level: string, name: string, startsInDays: number) {
            const agent = await signIn(app, who);
            const startsAtMs = Date.now() + startsInDays * DAY;
            await agent
                .post(api('/test-schedules'))
                .send({
                    candidate: { fullName: name, email, phone: '+91 98765 43210' },
                    level,
                    startsAt: ist(startsAtMs),
                    endsAt: ist(startsAtMs + HOUR),
                })
                .expect(201);
        }

        beforeEach(async () => {
            await book('a1@example.com', 'asha@example.com', 'INTERMEDIATE', 'Anil Kumar', 1);
            await book('a2@example.com', 'asha@example.com', 'ADVANCED', 'Bina Rao', 2);
            await book('b1@example.com', 'ben@example.com', 'ADVANCED', 'Chitra Sen', 3);
        });

        it('shows an advisor only their own tests, newest slot first', async () => {
            const asha = await signIn(app, 'asha@example.com');
            const res = await asha.get(api('/test-schedules')).expect(200);
            expect(res.body.total).toBe(2);
            expect(res.body.items.map((i: any) => i.candidate.fullName)).toEqual(['Bina Rao', 'Anil Kumar']);
        });

        it('ignores an advisor asking for someone else’s tests', async () => {
            const asha = await signIn(app, 'asha@example.com');
            const ben = db._users.find((u) => u.email === 'ben@example.com')!;
            const res = await asha.get(api(`/test-schedules?invitedById=${ben.id}`)).expect(200);
            expect(res.body.items.map((i: any) => i.candidate.fullName)).toEqual(['Bina Rao', 'Anil Kumar']);
        });

        it('shows an admin everything, and lets them narrow it', async () => {
            const admin = await signIn(app, 'admin@example.com');
            expect((await admin.get(api('/test-schedules')).expect(200)).body.total).toBe(3);

            const ben = db._users.find((u) => u.email === 'ben@example.com')!;
            const byBen = await admin.get(api(`/test-schedules?invitedById=${ben.id}`)).expect(200);
            expect(byBen.body.items.map((i: any) => i.candidate.fullName)).toEqual(['Chitra Sen']);

            const advanced = await admin.get(api('/test-schedules?level=ADVANCED')).expect(200);
            expect(advanced.body.total).toBe(2);

            const search = await admin.get(api('/test-schedules?q=bina')).expect(200);
            expect(search.body.items.map((i: any) => i.candidate.email)).toEqual(['a2@example.com']);

            const invited = await admin.get(api('/test-schedules?status=SUBMITTED')).expect(200);
            expect(invited.body.total).toBe(0);
        });

        it('shows a manager everything, lets them narrow it, and opens any test', async () => {
            const mia = await signIn(app, 'mia@example.com');
            expect((await mia.get(api('/test-schedules')).expect(200)).body.total).toBe(3);

            const ben = db._users.find((u) => u.email === 'ben@example.com')!;
            const byBen = await mia.get(api(`/test-schedules?invitedById=${ben.id}`)).expect(200);
            expect(byBen.body.items.map((i: any) => i.candidate.fullName)).toEqual(['Chitra Sen']);

            const any = db._schedules[0]!;
            await mia.get(api(`/test-schedules/${any.id}`)).expect(200);
        });

        it('pages the results', async () => {
            const admin = await signIn(app, 'admin@example.com');
            const page2 = await admin.get(api('/test-schedules?page=2&pageSize=2')).expect(200);
            expect(page2.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
            expect(page2.body.items).toHaveLength(1);
            await admin.get(api('/test-schedules?pageSize=1000')).expect(400);
        });

        it('filters by when the window opens', async () => {
            const admin = await signIn(app, 'admin@example.com');
            const from = encodeURIComponent(ist(Date.now() + 2.5 * DAY));
            const res = await admin.get(api(`/test-schedules?startsFrom=${from}`)).expect(200);
            expect(res.body.items.map((i: any) => i.candidate.fullName)).toEqual(['Chitra Sen']);
        });

        it('fetches one test: an advisor’s own, never another’s', async () => {
            const asha = await signIn(app, 'asha@example.com');
            const own = await asha.get(api('/test-schedules')).expect(200);
            const ownId = own.body.items[0].id;
            const got = await asha.get(api(`/test-schedules/${ownId}`)).expect(200);
            expect(got.body.latestStartAt).toBeDefined();

            const bens = db._schedules.find((s) => s.invitedById === db._users.find((u) => u.email === 'ben@example.com')!.id)!;
            await asha.get(api(`/test-schedules/${bens.id}`)).expect(404);
            await (await signIn(app, 'admin@example.com')).get(api(`/test-schedules/${bens.id}`)).expect(200);
            await asha.get(api('/test-schedules/abc')).expect(400);
        });
    });

    describe('expiry', () => {
        /** A test with the window placed relative to now: it closes `closesInMinutes` from now (negative: already closed). */
        async function seed(email: string, level: 'INTERMEDIATE' | 'ADVANCED', closesInMinutes: number, status = 'INVITED') {
            const asha = db._users.find((u) => u.email === 'asha@example.com')!;
            const person = await db.candidate.create({ data: { fullName: email, email } });
            const endsAt = new Date(Date.now() + closesInMinutes * 60_000);
            return db.testSchedule.create({
                data: {
                    candidateId: person.id,
                    invitedById: asha.id,
                    level,
                    durationMinutes: level === 'ADVANCED' ? 12 : 22,
                    startsAt: new Date(endsAt.getTime() - 60 * 60_000),
                    endsAt,
                    status,
                },
            });
        }
        const statusOf = (id: number) => db._schedules.find((row) => row.id === id)!.status;

        it('shows a test nobody started before its last start as expired, and finds it under that filter', async () => {
            const missed = await seed('missed@example.com', 'INTERMEDIATE', -5);
            const asha = await signIn(app, 'asha@example.com');

            const all = await asha.get(api('/test-schedules')).expect(200);
            expect(all.body.items.map((i: any) => i.status)).toEqual(['EXPIRED']);
            expect(statusOf(missed.id)).toBe('EXPIRED');

            const filtered = await asha.get(api('/test-schedules?status=EXPIRED')).expect(200);
            expect(filtered.body.total).toBe(1);
            expect((await asha.get(api('/test-schedules?status=INVITED')).expect(200)).body.total).toBe(0);
        });

        it('counts the test length: a 22-minute test closing in 15 minutes can no longer be started, a 12-minute one still can', async () => {
            const tooLate = await seed('late@example.com', 'INTERMEDIATE', 15); // needs 22 minutes
            const stillFine = await seed('fine@example.com', 'ADVANCED', 15); // needs 12
            await (await signIn(app, 'asha@example.com')).get(api('/test-schedules')).expect(200);
            expect(statusOf(tooLate.id)).toBe('EXPIRED');
            expect(statusOf(stillFine.id)).toBe('INVITED');
        });

        it('leaves tests that are open, started or finished alone', async () => {
            const open = await seed('open@example.com', 'INTERMEDIATE', 45);
            const started = await seed('started@example.com', 'INTERMEDIATE', -5, 'IN_PROGRESS');
            const done = await seed('done@example.com', 'ADVANCED', -5, 'SUBMITTED');
            await (await signIn(app, 'asha@example.com')).get(api(`/test-schedules/${open.id}`)).expect(200);
            expect([statusOf(open.id), statusOf(started.id), statusOf(done.id)]).toEqual(['INVITED', 'IN_PROGRESS', 'SUBMITTED']);
        });

        it('lets an expired test be rescheduled back to invited', async () => {
            const missed = await seed('again@example.com', 'ADVANCED', -5);
            const asha = await signIn(app, 'asha@example.com');
            await asha.get(api(`/test-schedules/${missed.id}`)).expect(200);
            expect(statusOf(missed.id)).toBe('EXPIRED');
            const when = slot(60);
            const res = await asha
                .post(api(`/test-schedules/${missed.id}/reschedule`))
                .send({ startsAt: when.startsAt, endsAt: when.endsAt })
                .expect(200);
            expect(res.body.schedule.status).toBe('INVITED');
        });

        it('is what the worker does every minute, and doing it twice changes nothing', async () => {
            const missed = await seed('worker@example.com', 'INTERMEDIATE', -5);
            const worker = new ExpiryService(db as never);
            expect(await worker.sweep()).toBe(1);
            expect(statusOf(missed.id)).toBe('EXPIRED');
            expect(await worker.sweep()).toBe(0);
        });
    });
});
