import { NotificationDeliveryError } from '../../errors/notification-delivery.error.js';
import { testConfig } from '../../../test/support/test-config.js';
import { AiSensyProvider } from './aisensy.provider.js';

const settings = testConfig({ WHATSAPP_DRIVER: 'aisensy', AISENSY_API_KEY: 'secret-key-123' }).whatsapp;
const message = {
    campaignName: 'test_scheduled',
    destination: '+917044610338',
    userName: 'Priya Nair',
    templateParams: ['Priya', '24 Oct, 11:00 AM'],
};

const reply = (status: number, body = '') => vi.fn().mockResolvedValue(new Response(body, { status }));

describe('AiSensyProvider', () => {
    it('posts the campaign request AiSensy documents', async () => {
        const fetchImpl = reply(200, '{"success":"true"}');
        await new AiSensyProvider(settings, fetchImpl).send(message);

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://backend.aisensy.com/campaign/t1/api');
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(init.body)).toEqual({
            apiKey: 'secret-key-123',
            campaignName: 'test_scheduled',
            destination: '+917044610338',
            userName: 'Priya Nair',
            source: 'InterviewCall entrance test',
            templateParams: ['Priya', '24 Oct, 11:00 AM'],
        });
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it.each([400, 401, 404])('does not retry a %i', async (status) => {
        const error = await new AiSensyProvider(settings, reply(status, 'campaign not live')).send(message).catch((e) => e);
        expect(error).toBeInstanceOf(NotificationDeliveryError);
        expect(error.retryable).toBe(false);
        expect(error.message).toBe(`AiSensy responded ${status}: campaign not live`);
    });

    it.each([429, 500, 503])('retries a %i', async (status) => {
        const error = await new AiSensyProvider(settings, reply(status)).send(message).catch((e) => e);
        expect(error.retryable).toBe(true);
    });

    it('retries a network failure, and never puts the API key in the error', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
        const error = await new AiSensyProvider(settings, fetchImpl).send(message).catch((e) => e);
        expect(error.retryable).toBe(true);
        expect(error.message).not.toContain('secret-key-123');
    });

    it('truncates a long error body', async () => {
        const error = await new AiSensyProvider(settings, reply(400, 'x'.repeat(5000))).send(message).catch((e) => e);
        expect(error.message.length).toBeLessThan(400);
    });
});
