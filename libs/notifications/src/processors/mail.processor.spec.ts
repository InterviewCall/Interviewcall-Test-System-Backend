import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { NotificationDeliveryError } from '../errors/notification-delivery.error.js';
import { PayloadCipher } from '../security/payload-cipher.js';
import { TemplateService } from '../templates/template.service.js';
import type { MailJobData } from '../types/notification.types.js';
import { testConfig } from '../../test/support/test-config.js';
import { MailProcessor } from './mail.processor.js';

const config = testConfig({ STAFF_CONSOLE_URL: 'https://console.example.com', TEST_PORTAL_URL: 'https://www.test-portal.interviewcall.club' });
const cipher = new PayloadCipher(config);
const templates = new TemplateService();
templates.onModuleInit();

function jobData(overrides: Partial<MailJobData> = {}): MailJobData {
    return {
        template: 'staff-account-ready',
        to: 'priya@example.com',
        params: { fullName: 'Priya Nair', email: 'priya@example.com', roleLabel: 'Advisor', reason: 'created' },
        secure: cipher.encrypt({ temporaryPassword: 'Xk7mPq2RtV9wHn4Z' }),
        ...overrides,
    };
}

function fakeJob(data: MailJobData, extra: Record<string, unknown> = {}) {
    const job = {
        id: '1',
        name: 'send-mail',
        data,
        opts: { attempts: 5 },
        attemptsMade: 1,
        updateData: vi.fn(async (next: MailJobData) => {
            job.data = next;
        }),
        ...extra,
    };
    return job as typeof job & Job<MailJobData>;
}

function setup(send = vi.fn().mockResolvedValue(undefined)) {
    const processor = new MailProcessor(config, { send }, templates, cipher);
    return { processor, send };
}

describe('MailProcessor', () => {
    it('decrypts, renders and sends, then scrubs the secret from the job', async () => {
        const { processor, send } = setup();
        const job = fakeJob(jobData());

        await processor.process(job);

        expect(send).toHaveBeenCalledOnce();
        const mail = send.mock.calls[0][0];
        expect(mail.sender).toBe('accounts');
        expect(mail.to).toBe('priya@example.com');
        expect(mail.subject).toBe('Your InterviewCall console account is ready');
        expect(mail.html).toContain('Xk7mPq2RtV9wHn4Z');
        expect(mail.text).toContain('Temporary password: Xk7mPq2RtV9wHn4Z');
        expect(mail.text).toContain('https://console.example.com/login');
        expect(job.updateData).toHaveBeenCalledOnce();
        expect(job.data.secure).toBeUndefined();
    });

    it('passes the delivery reference on to the provider, and refuses one SES would not accept', async () => {
        const { processor, send } = setup();
        const data = (ref: string) =>
            fakeJob({
                template: 'candidate-test-scheduled',
                to: 'rohan@example.com',
                params: { fullName: 'Rohan Das', startsAt: '2026-10-24T05:30:00.000Z', endsAt: '2026-10-24T06:30:00.000Z', durationMinutes: '22' },
                ref,
                secure: cipher.encrypt({ inviteToken: 'Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro' }),
            });

        await processor.process(data('b1a7c1de-0f43-4d1a-9a52-2f1f0e6c9d11'));
        expect(send.mock.calls[0][0].ref).toBe('b1a7c1de-0f43-4d1a-9a52-2f1f0e6c9d11');

        await expect(processor.process(data('not valid!'))).rejects.toThrow(/Invalid mail job/);
        expect(send).toHaveBeenCalledOnce();
    });

    it('sends a candidate email with the sealed start link, from the candidates sender', async () => {
        const { processor, send } = setup();
        const job = fakeJob({
            template: 'candidate-test-scheduled',
            to: 'rohan@example.com',
            params: {
                fullName: 'Rohan Das',
                startsAt: '2026-10-24T05:30:00.000Z',
                endsAt: '2026-10-24T06:30:00.000Z',
                durationMinutes: '22',
            },
            secure: cipher.encrypt({ inviteToken: 'Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro' }),
        });

        await processor.process(job);

        const mail = send.mock.calls[0][0];
        expect(mail.sender).toBe('candidates');
        expect(mail.to).toBe('rohan@example.com');
        expect(mail.text).toContain('approximately 22 minutes');
        expect(mail.text).toContain('Scheduled: 24 October 2026, 11:00 AM – 12:00 PM IST');
        expect(mail.text).toContain('https://www.test-portal.interviewcall.club/t/Xq3v9Lm2Zr7Tp5Wc8Nb4Hd6Ja1Ks0Ye3Uf2Gi9Ro');
    });

    it('lets a retryable provider failure through so BullMQ tries again', async () => {
        const failure = new NotificationDeliveryError('throttled', true);
        const { processor } = setup(vi.fn().mockRejectedValue(failure));
        const job = fakeJob(jobData());

        await expect(processor.process(job)).rejects.toBe(failure);
        expect(job.updateData).not.toHaveBeenCalled(); // still needs the secret for the next attempt
    });

    it('gives up at once on a permanent provider failure', async () => {
        const { processor } = setup(vi.fn().mockRejectedValue(new NotificationDeliveryError('rejected', false)));
        await expect(processor.process(fakeJob(jobData()))).rejects.toBeInstanceOf(UnrecoverableError);
    });

    it.each([
        ['an unknown template', jobData({ template: 'nope' as never })],
        ['a missing secret', jobData({ secure: undefined })],
        ['a secret sealed under another key', jobData({ secure: 'v1.AAAA.AAAA.AAAA' })],
        ['missing params', jobData({ params: {} })],
        ['a wrong reason', jobData({ params: { fullName: 'P', email: 'p@x.com', roleLabel: 'A', reason: 'whenever' } })],
    ])('gives up at once on %s, without sending', async (_name, data) => {
        const { processor, send } = setup();
        await expect(processor.process(fakeJob(data))).rejects.toBeInstanceOf(UnrecoverableError);
        expect(send).not.toHaveBeenCalled();
    });

    it('does not leak the password into error messages', async () => {
        const { processor } = setup();
        const error = await processor.process(fakeJob(jobData({ params: {} }))).catch((e) => e);
        expect(String(error.message)).not.toContain('Xk7mPq2RtV9wHn4Z');
    });

    it('refuses jobs it was not built to run', async () => {
        const { processor } = setup();
        await expect(processor.process(fakeJob(jobData(), { name: 'something-else' }))).rejects.toBeInstanceOf(
            UnrecoverableError,
        );
    });

    describe('when a job fails', () => {
        it('keeps the secret while attempts remain', async () => {
            const { processor } = setup();
            const job = fakeJob(jobData(), { attemptsMade: 2 });
            await processor.onFailed(job, new Error('throttled'));
            expect(job.updateData).not.toHaveBeenCalled();
        });

        it('scrubs it on the last attempt', async () => {
            const { processor } = setup();
            const job = fakeJob(jobData(), { attemptsMade: 5 });
            await processor.onFailed(job, new Error('still throttled'));
            expect(job.data.secure).toBeUndefined();
        });

        it('scrubs it straight away when the failure is permanent', async () => {
            const { processor } = setup();
            const job = fakeJob(jobData(), { attemptsMade: 1 });
            await processor.onFailed(job, new UnrecoverableError('rejected'));
            expect(job.data.secure).toBeUndefined();
        });

        it('tolerates a job that has already been removed', async () => {
            const { processor } = setup();
            await expect(processor.onFailed(undefined, new Error('x'))).resolves.toBeUndefined();
            const job = fakeJob(jobData(), { attemptsMade: 5, updateData: vi.fn().mockRejectedValue(new Error('Missing key')) });
            await expect(processor.onFailed(job, new Error('x'))).resolves.toBeUndefined();
        });
    });
});
