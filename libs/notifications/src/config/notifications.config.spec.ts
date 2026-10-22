import { randomBytes } from 'node:crypto';
import { loadNotificationsConfig } from './notifications.config.js';

const KEY = randomBytes(32).toString('base64');
const SES = {
    MAIL_FROM_ACCOUNTS: 'InterviewCall <accounts@notification.interviewcall.club>',
    MAIL_FROM_CANDIDATES: 'InterviewCall Tests <tests@notification.interviewcall.club>',
    AWS_REGION: 'ap-south-1',
};

describe('loadNotificationsConfig', () => {
    it('needs only the payload key in development, and prints instead of sending', () => {
        const config = loadNotificationsConfig({ NOTIFICATIONS_PAYLOAD_KEY: KEY });
        expect(config.mail.driver).toBe('console');
        expect(config.whatsapp.driver).toBe('console');
        expect(config.redis).toMatchObject({ host: 'localhost', port: 6379, db: 0, tls: false });
        expect(config.queuePrefix).toBe('ic-entrance');
        expect(config.payloadKey).toHaveLength(32);
        expect(config.whatsapp.apiUrl).toBe('https://backend.aisensy.com/campaign/t1/api');
    });

    it('treats empty values as unset', () => {
        const config = loadNotificationsConfig({ NOTIFICATIONS_PAYLOAD_KEY: KEY, REDIS_PORT: '', MAIL_DRIVER: '' });
        expect(config.redis.port).toBe(6379);
        expect(config.mail.driver).toBe('console');
    });

    it('explains how to make a missing or short key', () => {
        expect(() => loadNotificationsConfig({})).toThrow(/NOTIFICATIONS_PAYLOAD_KEY: .*openssl rand -base64 32/);
        expect(() => loadNotificationsConfig({ NOTIFICATIONS_PAYLOAD_KEY: 'c2hvcnQ=' })).toThrow(/32 random bytes/);
    });

    it('defaults to the real providers in production and demands their settings', () => {
        const base = { NODE_ENV: 'production', NOTIFICATIONS_PAYLOAD_KEY: KEY };
        expect(() => loadNotificationsConfig(base)).toThrow(/MAIL_FROM_ACCOUNTS[\s\S]*MAIL_FROM_CANDIDATES[\s\S]*AWS_REGION[\s\S]*AISENSY_API_KEY/);

        const config = loadNotificationsConfig({ ...base, ...SES, AISENSY_API_KEY: 'k' });
        expect(config.mail.driver).toBe('ses');
        expect(config.mail.from).toEqual({
            accounts: SES.MAIL_FROM_ACCOUNTS,
            candidates: SES.MAIL_FROM_CANDIDATES,
        });
        expect(config.whatsapp.driver).toBe('aisensy');
    });

    it('refuses the console drivers in production, since they print temporary passwords', () => {
        const env = { NODE_ENV: 'production', NOTIFICATIONS_PAYLOAD_KEY: KEY, MAIL_DRIVER: 'console', WHATSAPP_DRIVER: 'console' };
        expect(() => loadNotificationsConfig(env)).toThrow(/MAIL_DRIVER: cannot be "console"[\s\S]*WHATSAPP_DRIVER/);
    });

    it('checks the shape of other values', () => {
        const env = { NOTIFICATIONS_PAYLOAD_KEY: KEY };
        expect(() => loadNotificationsConfig({ ...env, REDIS_PORT: '99999' })).toThrow(/REDIS_PORT/);
        expect(() => loadNotificationsConfig({ ...env, REDIS_TLS: 'yes' })).toThrow(/REDIS_TLS/);
        expect(() => loadNotificationsConfig({ ...env, STAFF_CONSOLE_URL: 'not a url' })).toThrow(/STAFF_CONSOLE_URL/);
        expect(() => loadNotificationsConfig({ ...env, DEFAULT_PHONE_COUNTRY_CODE: '+91' })).toThrow(/DEFAULT_PHONE_COUNTRY_CODE/);
        expect(loadNotificationsConfig({ ...env, STAFF_CONSOLE_URL: 'https://console.example.com/' }).staffConsoleUrl).toBe(
            'https://console.example.com',
        );
    });

    it('defaults the test portal link, and drops a trailing slash from a custom one', () => {
        const env = { NOTIFICATIONS_PAYLOAD_KEY: KEY };
        expect(loadNotificationsConfig(env).testPortalUrl).toBe('https://www.test-portal.interviewcall.club');
        expect(loadNotificationsConfig({ ...env, TEST_PORTAL_URL: 'https://t.example.com/' }).testPortalUrl).toBe(
            'https://t.example.com',
        );
        expect(() => loadNotificationsConfig({ ...env, TEST_PORTAL_URL: 'nope' })).toThrow(/TEST_PORTAL_URL/);
    });
});
