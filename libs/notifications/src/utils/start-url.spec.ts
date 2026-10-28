import { testStartUrl } from './start-url.js';

describe('testStartUrl', () => {
    it('puts the secret after /t/ on the portal address', () => {
        expect(testStartUrl('https://test.example.com', 'Xq3v9-_Lm')).toBe('https://test.example.com/t/Xq3v9-_Lm');
    });

    it('does not double the slash when the portal address ends with one', () => {
        expect(testStartUrl('https://test.example.com/', 'abc')).toBe('https://test.example.com/t/abc');
    });

    it('escapes anything that is not safe in an address', () => {
        expect(testStartUrl('https://test.example.com', 'a b/c?d')).toBe('https://test.example.com/t/a%20b%2Fc%3Fd');
    });
});
