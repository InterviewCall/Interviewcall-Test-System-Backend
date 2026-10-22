import { z } from 'zod';
import { UserRole, UserStatus } from '@app/prisma';
import { pageOf, paginationShape } from '../common/pagination.js';

const roleSchema = z.enum(UserRole);
const statusSchema = z.enum(UserStatus);
const fullName = z.string().trim().min(2).max(150);
const phone = z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s()-]{5,48}$/, 'must be a valid phone number');
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(191));

export const createUserSchema = z
    .object({ fullName, email: emailSchema, phone, role: roleSchema })
    .strict();

export const updateUserSchema = z
    .object({ fullName: fullName.optional(), phone: phone.optional(), role: roleSchema.optional() })
    .strict();

export const listUsersQuerySchema = z
    .object({
        ...paginationShape,
        role: roleSchema.optional(),
        status: statusSchema.optional(),
        q: z.string().trim().max(100).optional().describe('Matches name or email'),
    })
    .strict();

// --- Response shapes. These document the API; they are not run against responses. ---

const dateTime = z.string().meta({ format: 'date-time' });

export const userResponseSchema = z.object({
    id: z.number().int(),
    fullName: z.string(),
    email: z.string(),
    phone: z.string(),
    role: roleSchema,
    status: statusSchema,
    lastLoginAt: dateTime.nullable(),
    createdAt: dateTime,
});

export const userPageResponseSchema = pageOf(userResponseSchema);

export const userWithTemporaryPasswordResponseSchema = z.object({
    user: userResponseSchema,
    temporaryPassword: z
        .string()
        .describe('Shown once. The user must change it at first sign-in. Share it over a private channel.'),
    emailQueued: z
        .boolean()
        .describe('True when the sign-in details were queued to the user by email. False: pass the password on yourself.'),
});
