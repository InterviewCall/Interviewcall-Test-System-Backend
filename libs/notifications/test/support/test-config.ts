import { randomBytes } from 'node:crypto';
import { loadNotificationsConfig } from '../../src/config/notifications.config.js';

export const TEST_KEY = randomBytes(32).toString('base64');

/** A valid development config, with any setting overridden. */
export function testConfig(overrides: Record<string, string> = {}) {
    return loadNotificationsConfig({ NOTIFICATIONS_PAYLOAD_KEY: TEST_KEY, ...overrides });
}
