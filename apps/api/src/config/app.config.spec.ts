import { loadConfig } from './app.config.js';

describe('loadConfig', () => {
    it('defaults to safe development values', () => {
        const config = loadConfig({});
        expect(config.isProduction).toBe(false);
        expect(config.cookie).toMatchObject({ name: 'ic_staff_session', secure: false, sameSite: 'lax' });
        expect(config.session).toEqual({ idleMinutes: 480, absoluteDays: 7, touchIntervalMinutes: 5 });
        expect(config.swaggerEnabled).toBe(true);
    });

    it('turns on secure cookies and turns off swagger in production', () => {
        const config = loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.example/, https://b.example' });
        expect(config.cookie.secure).toBe(true);
        expect(config.swaggerEnabled).toBe(false);
        expect(config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    });

    it('refuses to start in production without allowed origins', () => {
        expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ALLOWED_ORIGINS/);
    });

    it('rejects bad numbers and flags instead of guessing', () => {
        expect(() => loadConfig({ SESSION_IDLE_MINUTES: 'soon' })).toThrow(/SESSION_IDLE_MINUTES/);
        expect(() => loadConfig({ COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
        expect(() => loadConfig({ COOKIE_SAMESITE: 'none' })).toThrow(/COOKIE_SAMESITE/);
    });
});
