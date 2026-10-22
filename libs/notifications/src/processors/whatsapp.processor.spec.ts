import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { NotificationDeliveryError } from '../errors/notification-delivery.error.js';
import type { WhatsAppJobData } from '../types/notification.types.js';
import { WhatsAppProcessor } from './whatsapp.processor.js';

const data: WhatsAppJobData = {
    campaignName: 'test_scheduled',
    destination: '+917044610338',
    userName: 'Priya Nair',
    templateParams: ['Priya', '24 Oct'],
};

const fakeJob = (jobData: unknown, name = 'send-whatsapp') => ({ id: '9', name, data: jobData }) as Job<WhatsAppJobData>;

describe('WhatsAppProcessor', () => {
    it('sends the message', async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        await new WhatsAppProcessor({ send }).process(fakeJob(data));
        expect(send).toHaveBeenCalledWith(data);
    });

    it('retries retryable failures and abandons permanent ones', async () => {
        const retryable = new NotificationDeliveryError('503', true);
        await expect(new WhatsAppProcessor({ send: vi.fn().mockRejectedValue(retryable) }).process(fakeJob(data))).rejects.toBe(
            retryable,
        );
        await expect(
            new WhatsAppProcessor({ send: vi.fn().mockRejectedValue(new NotificationDeliveryError('400', false)) }).process(
                fakeJob(data),
            ),
        ).rejects.toBeInstanceOf(UnrecoverableError);
    });

    it.each([
        ['a bad number', { ...data, destination: '7044610338' }],
        ['no campaign', { ...data, campaignName: '' }],
        ['params that are not strings', { ...data, templateParams: [1, 2] }],
    ])('gives up on %s without calling AiSensy', async (_name, bad) => {
        const send = vi.fn();
        await expect(new WhatsAppProcessor({ send }).process(fakeJob(bad))).rejects.toBeInstanceOf(UnrecoverableError);
        expect(send).not.toHaveBeenCalled();
    });

    it('refuses other job names', async () => {
        await expect(new WhatsAppProcessor({ send: vi.fn() }).process(fakeJob(data, 'x'))).rejects.toBeInstanceOf(
            UnrecoverableError,
        );
    });
});
