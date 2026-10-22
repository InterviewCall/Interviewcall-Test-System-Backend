import { z } from 'zod';
import { emailSchema } from '../users/users.schemas.js';

export const loginSchema = z
    .object({
        email: emailSchema,
        // No minimum: login only checks a password, it never sets one. The policy applies on change.
        password: z.string().min(1).max(128),
    })
    .strict();

export const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(10).max(128),
    })
    .strict();

export const sessionResponseSchema = z.object({
    id: z.number().int(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string().meta({ format: 'date-time' }),
    lastSeenAt: z.string().meta({ format: 'date-time' }),
    current: z.boolean().describe('True for the session making this request'),
});
