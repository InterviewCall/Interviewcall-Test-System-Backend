import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { UserRole } from '@app/prisma';
import { api, buildApp, createFakeModel, seedStaff, signIn } from './support/harness.js';
import type { FakeModel } from './support/harness.js';
import { fakeNotifications } from './support/fake-notifications.js';
import { sesEvent, signedSnsMessage, TEST_CERTIFICATE, TOPIC_ARN } from './support/sns-fixture.js';

const DAY = 86_400_000;
const ist = (ms: number) => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

describe('mail delivery reports', () => {
    let app: NestExpressApplication;
    let db: FakeModel;
    let fetched: string[];

    beforeEach(async () => {
        fakeNotifications.testScheduledEmails = [];
        fakeNotifications.testRescheduledEmails = [];
        fakeNotifications.queueIsUp = true;
        fetched = [];
        db = createFakeModel();
        await seedStaff(db, { email: 'admin@example.com', role: UserRole.ADMIN });
        app = await buildApp(db, {
            mailEventsTopicArn: TOPIC_ARN,
            fetchText: async (url) => {
                fetched.push(url);
                return TEST_CERTIFICATE;
            },
        });
    });
    afterEach(() => app.close());

    /** Books a test and returns its id and the reference the email carried. */
    async function bookTest() {
        const admin = await signIn(app, 'admin@example.com');
        const start = Date.now() + DAY;
        const res = await admin
            .post(api('/test-schedules'))
            .send({
                candidate: { fullName: 'Rohan Das', email: 'rohan@example.com', phone: '+91 70446 10338' },
                level: 'INTERMEDIATE',
                startsAt: ist(start),
                endsAt: ist(start + 3_600_000),
            })
            .expect(201);
        const ref = fakeNotifications.testScheduledEmails.at(-1)!.mailRef!;
        return { admin, id: res.body.schedule.id as number, ref, created: res.body.schedule };
    }

    /** Posts a signed notification the way SNS does: as text/plain. */
    const deliver = (message: Record<string, string>) =>
        request(app.getHttpServer()).post(api('/mail-events/ses')).set('Content-Type', 'text/plain; charset=UTF-8').send(JSON.stringify(message));

    const report = (kind: string, ref: string, extra: Record<string, unknown> = {}) =>
        deliver(signedSnsMessage({ Message: sesEvent(kind, ref, extra) }));

    const statusOf = async (admin: Awaited<ReturnType<typeof bookTest>>['admin'], id: number) =>
        (await admin.get(api(`/test-schedules/${id}`)).expect(200)).body.invitationMail;

    it('marks a new invitation as queued, with the reference the email carries', async () => {
        const { ref, created } = await bookTest();
        expect(ref).toMatch(/^[0-9a-f-]{36}$/);
        expect(created.invitationMail).toMatchObject({ status: 'QUEUED', detail: null });
        expect(db._schedules[0]).toMatchObject({ invitationMailRef: ref });
    });

    it('moves through sent and delivered', async () => {
        const { admin, id, ref } = await bookTest();

        await report('Send', ref).expect(200);
        expect(await statusOf(admin, id)).toMatchObject({ status: 'SENT' });

        await report('Delivery', ref).expect(200);
        expect(await statusOf(admin, id)).toMatchObject({ status: 'DELIVERED', detail: null });
    });

    it('records a bounce with the reason', async () => {
        const { admin, id, ref } = await bookTest();
        await report('Bounce', ref, {
            bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ diagnosticCode: '550 5.1.1 user unknown' }] },
        }).expect(200);
        expect(await statusOf(admin, id)).toMatchObject({
            status: 'BOUNCED',
            detail: 'Permanent bounce (General): 550 5.1.1 user unknown',
        });
    });

    it('does not let a late "sent" undo a delivery or a bounce', async () => {
        const { admin, id, ref } = await bookTest();
        await report('Delivery', ref).expect(200);
        await report('Send', ref).expect(200);
        expect(await statusOf(admin, id)).toMatchObject({ status: 'DELIVERED' });

        await report('Bounce', ref, { bounce: { bounceType: 'Permanent' } }).expect(200);
        await report('Delivery', ref).expect(200);
        expect(await statusOf(admin, id)).toMatchObject({ status: 'BOUNCED' });
    });

    it('lets a complaint follow a delivery', async () => {
        const { admin, id, ref } = await bookTest();
        await report('Delivery', ref).expect(200);
        await report('Complaint', ref, { complaint: { complaintFeedbackType: 'abuse' } }).expect(200);
        expect(await statusOf(admin, id)).toMatchObject({ status: 'COMPLAINED' });
    });

    it('accepts a report that arrives before the booking response is seen', async () => {
        // The reference is saved before the email is queued, so even an instant report finds its test.
        const { admin, id, ref } = await bookTest();
        await report('Delivery', ref).expect(200);
        expect((await statusOf(admin, id)).status).toBe('DELIVERED');
    });

    it('forgets the old result when the test is rescheduled', async () => {
        const { admin, id, ref } = await bookTest();
        await report('Bounce', ref, { bounce: { bounceType: 'Permanent' } }).expect(200);

        const start = Date.now() + 2 * DAY;
        const res = await admin
            .post(api(`/test-schedules/${id}/reschedule`))
            .send({ startsAt: ist(start), endsAt: ist(start + 3_600_000) })
            .expect(200);
        expect(res.body.schedule.invitationMail).toMatchObject({ status: 'QUEUED' });

        // A late report about the first email no longer matches anything.
        await report('Delivery', ref).expect(200);
        expect((await statusOf(admin, id)).status).toBe('QUEUED');
    });

    it('ignores a report about an email it does not know', async () => {
        const { admin, id } = await bookTest();
        await report('Delivery', 'ffffffff-ffff-ffff-ffff-ffffffffffff').expect(200);
        expect((await statusOf(admin, id)).status).toBe('QUEUED');
    });

    it('ignores opens and clicks', async () => {
        const { admin, id, ref } = await bookTest();
        await report('Open', ref).expect(200);
        expect((await statusOf(admin, id)).status).toBe('QUEUED');
    });

    it('refuses a message with a bad signature and changes nothing', async () => {
        const { admin, id, ref } = await bookTest();
        const forged = { ...signedSnsMessage({ Message: sesEvent('Send', ref) }), Message: sesEvent('Delivery', ref) };
        await deliver(forged).expect(403);
        expect((await statusOf(admin, id)).status).toBe('QUEUED');
    });

    it('refuses a message from another topic without fetching its certificate', async () => {
        const { ref } = await bookTest();
        await deliver(signedSnsMessage({ TopicArn: 'arn:aws:sns:ap-south-1:999999999999:other', Message: sesEvent('Delivery', ref) })).expect(403);
        expect(fetched).toEqual([]);
    });

    it('refuses a certificate that is not on an SNS address', async () => {
        await deliver(signedSnsMessage({ SigningCertURL: 'https://evil.example.com/cert.pem' })).expect(403);
        expect(fetched).toEqual([]);
    });

    it('rejects a body that is not an SNS message', async () => {
        await request(app.getHttpServer()).post(api('/mail-events/ses')).set('Content-Type', 'text/plain').send('hello').expect(400);
        await request(app.getHttpServer()).post(api('/mail-events/ses')).send({ Type: 'Notification' }).expect(400);
    });

    it('confirms the subscription when SNS asks', async () => {
        const subscribeUrl = 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc';
        await deliver(
            signedSnsMessage({ Type: 'SubscriptionConfirmation', Token: 'abc', SubscribeURL: subscribeUrl, Message: 'You have chosen to subscribe' }),
        ).expect(200);
        expect(fetched).toContain(subscribeUrl);
    });

    it('will not follow a confirmation address that is not SNS', async () => {
        await deliver(
            signedSnsMessage({ Type: 'SubscriptionConfirmation', Token: 'abc', SubscribeURL: 'https://evil.example.com/steal', Message: 'x' }),
        ).expect(403);
        expect(fetched).not.toContain('https://evil.example.com/steal');
    });

    it('is switched off when no topic is configured', async () => {
        await app.close();
        app = await buildApp(db);
        await deliver(signedSnsMessage()).expect(404);
    });

    it('does not need a sign-in (SNS has none)', async () => {
        const { ref } = await bookTest();
        await request(app.getHttpServer())
            .post(api('/mail-events/ses'))
            .set('Content-Type', 'text/plain')
            .send(JSON.stringify(signedSnsMessage({ Message: sesEvent('Send', ref) })))
            .expect(200);
    });
});
