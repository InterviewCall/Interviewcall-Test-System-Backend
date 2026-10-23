import { z } from 'zod';
import { emailSchema } from '../users/users.schemas.js';

export const createSessionSchema = z
    .object({
        token: z.string().trim().min(20).max(100),
        email: emailSchema,
    })
    .strict();

export const startAttemptSchema = z
    .object({
        workExperienceYears: z.number().min(0).max(60),
        /** Both statements must be accepted; the time is recorded by the server. */
        declarations: z.object({ ownWork: z.literal(true), accurateDetails: z.literal(true) }).strict(),
    })
    .strict();

export const saveAnswerSchema = z.object({ optionId: z.number().int().positive().nullable() }).strict();

export const feedbackSchema = z
    .object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(1000).optional(),
    })
    .strict();

export const questionIdParamSchema = z.coerce.number().int().positive();

export type CreateSessionInput = z.output<typeof createSessionSchema>;
export type StartAttemptInput = z.output<typeof startAttemptSchema>;
export type SaveAnswerInput = z.output<typeof saveAnswerSchema>;
export type FeedbackInput = z.output<typeof feedbackSchema>;
