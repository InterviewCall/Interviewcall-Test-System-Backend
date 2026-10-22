import { randomBytes } from 'node:crypto';
import { testConfig } from '../../test/support/test-config.js';
import { PayloadCipher } from './payload-cipher.js';

const cipher = () => new PayloadCipher(testConfig());

describe('PayloadCipher', () => {
    it('round-trips values, including awkward characters', () => {
        const values = { temporaryPassword: `Aa1&<>"'=%/\\ünïcödé` };
        const token = cipher().encrypt(values);
        expect(cipher().decrypt(token)).toEqual(values);
    });

    it('never contains the plain text', () => {
        const token = cipher().encrypt({ temporaryPassword: 'Hunter2Hunter2' });
        expect(token).not.toContain('Hunter2');
        expect(Buffer.from(token.split('.')[3], 'base64url').toString('utf8')).not.toContain('Hunter2');
    });

    it('uses a fresh IV every time', () => {
        const a = cipher().encrypt({ x: '1' });
        const b = cipher().encrypt({ x: '1' });
        expect(a).not.toBe(b);
    });

    it('rejects a tampered token', () => {
        const [v, iv, tag, body] = cipher().encrypt({ x: 'secret' }).split('.');
        const flipped = Buffer.from(body, 'base64url');
        flipped[0] ^= 1;
        expect(() => cipher().decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    });

    it('rejects a token sealed under another key', () => {
        const other = new PayloadCipher(testConfig({ NOTIFICATIONS_PAYLOAD_KEY: randomBytes(32).toString('base64') }));
        expect(() => cipher().decrypt(other.encrypt({ x: 'secret' }))).toThrow();
    });

    it('rejects garbage and other versions', () => {
        expect(() => cipher().decrypt('nope')).toThrow('Unreadable');
        expect(() => cipher().decrypt('v2.a.b.c')).toThrow('Unreadable');
    });
});
