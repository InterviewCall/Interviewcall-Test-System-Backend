import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
    const service = new PasswordService();

    beforeAll(() => service.onModuleInit());

    it('hashes with argon2id and verifies', async () => {
        const hash = await service.hash('a long enough password');
        expect(hash.startsWith('$argon2id$')).toBe(true);
        expect(await service.verify(hash, 'a long enough password')).toBe(true);
        expect(await service.verify(hash, 'another password')).toBe(false);
    });

    it('treats a malformed stored hash as a mismatch, not an error', async () => {
        expect(await service.verify('not-a-hash', 'whatever')).toBe(false);
    });

    it('dummy verification always fails', async () => {
        expect(await service.verifyDummy('anything')).toBe(false);
    });

    it('generates 16-character passwords without look-alike characters', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) {
            const pw = service.generateTemporaryPassword();
            expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
            seen.add(pw);
        }
        expect(seen.size).toBe(200);
    });
});
