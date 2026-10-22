import { randomBytes } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { NotificationsModule } from '../src/notifications.module.js';
import { ENQUEUE_TIMEOUT_MS, NotificationsService } from '../src/notifications.service.js';
import { NotificationsWorkerModule } from '../src/notifications-worker.module.js';
import { DEFAULT_JOB_OPTIONS, MAIL_QUEUE, WHATSAPP_QUEUE } from '../src/queue/queue.constants.js';
import { NotificationDeliveryError } from '../src/errors/notification-delivery.error.js';
import { MAIL_PROVIDER } from '../src/types/mail.types.js';
import { WHATSAPP_PROVIDER } from '../src/types/whatsapp.types.js';

// Talks to a real Redis (REDIS_HOST / REDIS_PORT, default localhost:6379) and skips when there is none.
const host = process.env.REDIS_HOST ?? 'localhost';
const port = Number(process.env.REDIS_PORT ?? 6379);

async function redisIsUp() {
    const probe = new Redis({ host, port, lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
    probe.on('error', () => undefined);
    try {
        await probe.connect();
        return true;
    } catch {
        return false;
    } finally {
        probe.disconnect();
    }
}

const up = await redisIsUp();
const prefix = `ic-test-${randomBytes(4).toString('hex')}`;

async function until<T>(read: () => T | undefined, ms = 8000): Promise<T> {
    const stop = Date.now() + ms;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > stop) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 25));
    }
}

describe.skipIf(!up)('notification queues (real Redis)', () => {
    const sentMail: Array<{ to: string; subject: string; html: string; text: string }> = [];
    const sentWhatsApp: unknown[] = [];
    let mailFailures: Error[] = [];
    let producer: INestApplicationContext;
    let worker: INestApplicationContext;
    let service: NotificationsService;
    let mailQueue: Queue;

    beforeAll(async () => {
        Object.assign(process.env, {
            REDIS_HOST: host,
            REDIS_PORT: String(port),
            NOTIFICATIONS_QUEUE_PREFIX: prefix,
            NOTIFICATIONS_PAYLOAD_KEY: randomBytes(32).toString('base64'),
            MAIL_DRIVER: 'console',
            WHATSAPP_DRIVER: 'console',
            STAFF_CONSOLE_URL: 'https://console.example.com',
        });

        producer = await (await Test.createTestingModule({ imports: [NotificationsModule] }).compile())
            .createNestApplication()
            .init();
        service = producer.get(NotificationsService);
        mailQueue = producer.get<Queue>(getQueueToken(MAIL_QUEUE));

        worker = await (
            await Test.createTestingModule({ imports: [NotificationsWorkerModule] })
                .overrideProvider(MAIL_PROVIDER)
                .useValue({
                    send: async (mail: (typeof sentMail)[number]) => {
                        const failure = mailFailures.shift();
                        if (failure) throw failure;
                        sentMail.push(mail);
                    },
                })
                .overrideProvider(WHATSAPP_PROVIDER)
                .useValue({ send: async (m: unknown) => void sentWhatsApp.push(m) })
                .compile()
        )
            .createNestApplication()
            .init();
    });

    afterAll(async () => {
        const cleaner = new Redis({ host, port });
        const keys = await cleaner.keys(`${prefix}:*`);
        if (keys.length) await cleaner.del(keys);
        cleaner.disconnect();
        await worker?.close();
        await producer?.close();
    });

    const staff = {
        fullName: 'Priya Nair',
        email: 'priya@example.com',
        role: 'ADVISOR',
        temporaryPassword: 'Xk7mPq2RtV9wHn4Z',
        reason: 'created' as const,
    };

    it('delivers a staff email end to end, and leaves no plaintext password in Redis', async () => {
        const before = sentMail.length;
        const raw = new Redis({ host, port });
        try {
            mailFailures = [];
            await expect(service.sendStaffAccountReady(staff)).resolves.toBe(true);

            // Inspect what is actually stored in Redis while the job may still be queued or just done.
            const mail = await until(() => sentMail[before]);
            expect(mail.to).toBe('priya@example.com');
            expect(mail.subject).toBe('Your InterviewCall console account is ready');
            expect(mail.text).toContain('Xk7mPq2RtV9wHn4Z');
            expect(mail.html).toContain('https://console.example.com/login');

            const keys = await raw.keys(`${prefix}:*`);
            for (const key of keys) {
                const type = await raw.type(key);
                const dump = type === 'hash' ? JSON.stringify(await raw.hgetall(key)) : '';
                expect(dump).not.toContain('Xk7mPq2RtV9wHn4Z');
            }
        } finally {
            raw.disconnect();
        }
    });

    it('scrubs the encrypted secret once the email has gone', async () => {
        const before = sentMail.length;
        await service.sendStaffAccountReady({ ...staff, email: 'scrub@example.com' });
        await until(() => sentMail[before]);
        await new Promise((r) => setTimeout(r, 200));
        const jobs = await mailQueue.getJobs(['completed']);
        const job = jobs.find((j) => j.data.to === 'scrub@example.com');
        expect(job).toBeDefined();
        expect(job!.data.secure).toBeUndefined();
    });

    it('retries a throttled send and succeeds on the next attempt', async () => {
        const before = sentMail.length;
        mailFailures = [new NotificationDeliveryError('SES throttled', true)];
        await service.sendStaffAccountReady({ ...staff, email: 'retry@example.com' });
        const mail = await until(() => sentMail[before], 25000);
        expect(mail.to).toBe('retry@example.com');
        expect(mailFailures).toHaveLength(0);
    }, 30000);

    it('gives up at once on a permanent failure and scrubs the secret', async () => {
        mailFailures = [new NotificationDeliveryError('MessageRejected', false)];
        await service.sendStaffAccountReady({ ...staff, email: 'bounce@example.com' });
        const stop = Date.now() + 8000;
        let job: Awaited<ReturnType<Queue['getJobs']>>[number] | undefined;
        while (!job && Date.now() < stop) {
            const failed = (await mailQueue.getJobs(['failed'])).find((j) => j.data.to === 'bounce@example.com');
            if (failed && failed.data.secure === undefined) job = failed;
            else await new Promise((r) => setTimeout(r, 50));
        }
        if (!job) throw new Error('job never failed and got scrubbed');
        expect(job.attemptsMade).toBe(1);
        expect(job.failedReason).toContain('MessageRejected');
    });

    it('delivers WhatsApp messages, and drops a duplicate event with the same dedupe key', async () => {
        const input = {
            campaignName: 'test_scheduled',
            phone: '70446 10338',
            userName: 'Priya',
            templateParams: ['Priya', '24 Oct'],
            dedupeKey: `sched-${randomBytes(3).toString('hex')}`,
        };
        await service.sendWhatsApp(input);
        await service.sendWhatsApp(input);
        await until(() => (sentWhatsApp.length ? true : undefined));
        await new Promise((r) => setTimeout(r, 300));
        expect(sentWhatsApp).toEqual([
            { campaignName: 'test_scheduled', destination: '+917044610338', userName: 'Priya', templateParams: ['Priya', '24 Oct'] },
        ]);
    });

    it('uses the documented retry policy', () => {
        expect(DEFAULT_JOB_OPTIONS).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 15000 } });
        expect(WHATSAPP_QUEUE).not.toBe(MAIL_QUEUE);
    });
});

describe('producer with Redis unreachable', () => {
    it('answers false quickly instead of hanging the request', async () => {
        Object.assign(process.env, {
            REDIS_HOST: '127.0.0.1',
            REDIS_PORT: '1', // nothing listens here
            NOTIFICATIONS_QUEUE_PREFIX: `${prefix}-down`,
            NOTIFICATIONS_PAYLOAD_KEY: randomBytes(32).toString('base64'),
            MAIL_DRIVER: 'console',
            WHATSAPP_DRIVER: 'console',
        });
        const app = await (await Test.createTestingModule({ imports: [NotificationsModule] }).compile())
            .createNestApplication()
            .init();
        try {
            const started = Date.now();
            const ok = await app.get(NotificationsService).sendStaffAccountReady({
                fullName: 'A B',
                email: 'a@b.com',
                role: 'ADMIN',
                temporaryPassword: 'x'.repeat(16),
                reason: 'created',
            });
            expect(ok).toBe(false);
            expect(Date.now() - started).toBeLessThan(ENQUEUE_TIMEOUT_MS + 1500);
        } finally {
            await app.close();
        }
    }, 20000);
});
