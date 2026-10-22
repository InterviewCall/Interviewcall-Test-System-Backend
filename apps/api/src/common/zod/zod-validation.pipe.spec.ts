import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
    const pipe = new ZodValidationPipe(
        z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), page: z.coerce.number().int().default(1) }).strict(),
    );

    it('returns the parsed value: trimmed, lower-cased, coerced, defaulted', () => {
        expect(pipe.transform({ email: '  A@B.COM ' })).toEqual({ email: 'a@b.com', page: 1 });
        expect(pipe.transform({ email: 'a@b.com', page: '3' })).toEqual({ email: 'a@b.com', page: 3 });
    });

    it('throws 400 with a field-by-field error list', () => {
        try {
            pipe.transform({ email: 'nope', extra: true });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(BadRequestException);
            const body = (error as BadRequestException).getResponse() as { code: string; errors: { path: string }[] };
            expect(body.code).toBe('VALIDATION_FAILED');
            expect(body.errors.length).toBeGreaterThanOrEqual(2);
            expect(body.errors.some((e) => e.path === 'email')).toBe(true);
        }
    });

    it('rejects a missing body', () => {
        expect(() => pipe.transform(undefined)).toThrow(BadRequestException);
    });
});
