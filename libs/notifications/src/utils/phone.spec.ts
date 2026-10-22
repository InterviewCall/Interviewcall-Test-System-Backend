import { maskEmail, maskPhone, normalizePhone } from './phone.js';

describe('normalizePhone', () => {
    it.each([
        ['7044610338', '+917044610338'],
        ['70446 10338', '+917044610338'],
        ['+91 70446-10338', '+917044610338'],
        ['(704) 461 0338', '+917044610338'],
        ['917044610338', '+917044610338'],
        ['0091 7044610338', '+917044610338'],
        ['+1 415 555 0132', '+14155550132'],
        ['+44 7911 123456', '+447911123456'],
    ])('%s -> %s', (raw, expected) => {
        expect(normalizePhone(raw, '91')).toBe(expected);
    });

    it.each(['', '   ', 'abc', '12345', '+1234567', '+0123456789', '+1234567890123456', '0044', '99999'])(
        'rejects %j',
        (raw) => {
            expect(normalizePhone(raw, '91')).toBeNull();
        },
    );

    it('uses the configured default country code', () => {
        expect(normalizePhone('4155550132', '1')).toBe('+14155550132');
    });
});

describe('masking', () => {
    it('hides most of an email and a phone number', () => {
        expect(maskEmail('arijit@interviewcall.club')).toBe('a***@interviewcall.club');
        expect(maskEmail('nonsense')).toBe('***');
        expect(maskPhone('+917044610338')).toBe('+91******0338');
        expect(maskPhone('+12345')).toBe('***');
    });
});
