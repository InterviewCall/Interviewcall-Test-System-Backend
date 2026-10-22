import type { Queue } from 'bullmq';
import { testConfig } from '../test/support/test-config.js';
import { ENQUEUE_TIMEOUT_MS, NotificationsService } from './notifications.service.js';
import { PayloadCipher } from './security/payload-cipher.js';
import type { MailJobData, WhatsAppJobData } from './types/notification.types.js';

const config = testConfig();
const cipher = new PayloadCipher(config);

function setup() {
    const mailAdd = vi.fn().mockResolvedValue({ id: '1' });
    const waAdd = vi.fn().mockResolvedValue({ id: '2' });
    const service = new NotificationsService(
        { add: mailAdd } as unknown as Queue<MailJobData>,
        { add: waAdd } as unknown as Queue<WhatsAppJobData>,
        cipher,
        config,
    );
    return { service, mailAdd, waAdd };
}

const staff = {
    fullName: 'Priya Nair',
    email: 'priya@example.com',
    role: 'ADVISOR',
    temporaryPassword: 'Xk7mPq2RtV9wHn4Z',
    reason: 'created' as const,
};

describe('NotificationsService.sendStaffAccountReady', () => {
    it('queues the email with the password sealed, not in plain text', async () => {
        const { service, mailAdd } = setup();

        await expect(service.sendStaffAccountReady(staff)).resolves.toBe(true);

        const [name, job] = mailAdd.mock.calls[0] as [string, MailJobData];
        expect(name).toBe('send-mail');
        expect(job).toMatchObject({
            template: 'staff-account-ready',
            to: 'priya@example.com',
            params: { fullName: 'Priya Nair', email: 'priya@example.com', roleLabel: 'Advisor', reason: 'created' },
        });
        expect(JSON.stringify(job)).not.toContain('Xk7mPq2RtV9wHn4Z');
        expect(cipher.decrypt(job.secure!)).toEqual({ temporaryPassword: 'Xk7mPq2RtV9wHn4Z' });
    });

    it('reports false instead of throwing when the queue is down', async () => {
        const { service, mailAdd } = setup();
        mailAdd.mockRejectedValue(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
        await expect(service.sendStaffAccountReady(staff)).resolves.toBe(false);
    });
});

describe('NotificationsService.sendTestScheduled', () => {
    const slot = {
        fullName: 'Rohan Das',
        email: 'rohan@example.com',
        startsAt: new Date('2026-10-24T05:30:00Z'),
        endsAt: new Date('2026-10-24T06:30:00Z'),
        durationMinutes: 12,
    };

    it('queues a plain job: params as strings, nothing sealed', async () => {
        const { service, mailAdd } = setup();
        await expect(service.sendTestScheduled(slot)).resolves.toBe(true);
        expect(mailAdd).toHaveBeenCalledWith('send-mail', {
            template: 'candidate-test-scheduled',
            to: 'rohan@example.com',
            params: {
                fullName: 'Rohan Das',
                startsAt: '2026-10-24T05:30:00.000Z',
                endsAt: '2026-10-24T06:30:00.000Z',
                durationMinutes: '12',
            },
        });
    });

    it('reports false when the queue is down', async () => {
        const { service, mailAdd } = setup();
        mailAdd.mockRejectedValue(new Error('down'));
        await expect(service.sendTestScheduled(slot)).resolves.toBe(false);
    });
});

describe('NotificationsService.sendTestRescheduled', () => {
    const slot = {
        fullName: 'Rohan Das',
        email: 'rohan@example.com',
        startsAt: new Date('2026-10-26T04:30:00Z'),
        endsAt: new Date('2026-10-26T05:30:00Z'),
        durationMinutes: 22,
    };

    it('queues the rescheduled template with the same plain params', async () => {
        const { service, mailAdd } = setup();
        await expect(service.sendTestRescheduled(slot)).resolves.toBe(true);
        expect(mailAdd).toHaveBeenCalledWith('send-mail', {
            template: 'candidate-test-rescheduled',
            to: 'rohan@example.com',
            params: {
                fullName: 'Rohan Das',
                startsAt: '2026-10-26T04:30:00.000Z',
                endsAt: '2026-10-26T05:30:00.000Z',
                durationMinutes: '22',
            },
        });
    });

    it('reports false when the queue is down', async () => {
        const { service, mailAdd } = setup();
        mailAdd.mockRejectedValue(new Error('down'));
        await expect(service.sendTestRescheduled(slot)).resolves.toBe(false);
    });
});

describe('when Redis never answers', () => {
    afterEach(() => vi.useRealTimers());

    it('gives up after the timeout and reports false', async () => {
        vi.useFakeTimers();
        const { service, mailAdd } = setup();
        mailAdd.mockReturnValue(new Promise(() => undefined));
        const result = service.sendStaffAccountReady(staff);
        await vi.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS + 1);
        await expect(result).resolves.toBe(false);
    });
});

describe('NotificationsService.sendWhatsApp', () => {
    const input = { campaignName: 'test_scheduled', phone: '+91 70446 10338', userName: 'Priya', templateParams: ['Priya', '24 Oct'] };

    it('normalises the number and queues the message', async () => {
        const { service, waAdd } = setup();
        await expect(service.sendWhatsApp(input)).resolves.toBe(true);
        expect(waAdd).toHaveBeenCalledWith(
            'send-whatsapp',
            { campaignName: 'test_scheduled', destination: '+917044610338', userName: 'Priya', templateParams: ['Priya', '24 Oct'] },
            undefined,
        );
    });

    it('uses the dedupe key as the job id, so the same event sends once', async () => {
        const { service, waAdd } = setup();
        await service.sendWhatsApp({ ...input, dedupeKey: 'test-scheduled-42' });
        expect(waAdd.mock.calls[0][2]).toEqual({ jobId: 'test-scheduled-42' });
    });

    it('refuses a number that cannot be real, and a bad dedupe key, without queueing', async () => {
        const { service, waAdd } = setup();
        await expect(service.sendWhatsApp({ ...input, phone: '12345' })).resolves.toBe(false);
        await expect(service.sendWhatsApp({ ...input, dedupeKey: 'has:colon' })).resolves.toBe(false);
        expect(waAdd).not.toHaveBeenCalled();
    });

    it('reports false when the queue is down', async () => {
        const { service, waAdd } = setup();
        waAdd.mockRejectedValue(new Error('down'));
        await expect(service.sendWhatsApp(input)).resolves.toBe(false);
    });
});
