import { z } from 'zod';
import { TestLevel, TestStatus } from '@app/prisma';
import { pageOf, paginationShape } from '../common/pagination.js';
import { emailSchema } from '../users/users.schemas.js';
import { MAX_WINDOW_MINUTES, MINUTE_MS, START_GRACE_MS, TEST_DURATION_MINUTES } from './test-levels.js';

const levelSchema = z.enum(TestLevel);
const statusSchema = z.enum(TestStatus);

/** An ISO 8601 moment with its offset, e.g. 2026-10-24T11:00:00+05:30. Always converted to a Date. */
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const candidate = z
    .object({
        fullName: z.string().trim().min(2).max(150),
        email: emailSchema,
        phone: z
            .string()
            .trim()
            .regex(/^\+?[0-9][0-9\s()-]{5,48}$/, 'must be a valid phone number')
            .optional(),
    })
    .strict();

/**
 * The rules every start window follows. `minimumMinutes` is the test length when it is known
 * (it is, when scheduling; when rescheduling the service checks it against the stored level).
 */
function addWindowIssues(ctx: z.RefinementCtx, startsAt: unknown, endsAt: unknown, minimum?: { minutes: number; name: string }): void {
    // Zod still runs this when a time failed its own check, leaving a raw string here. That field already has its error.
    if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) return;
    if (startsAt.getTime() < Date.now() - START_GRACE_MS) {
        ctx.addIssue({ code: 'custom', path: ['startsAt'], message: 'must not be in the past' });
        return;
    }
    const windowMinutes = (endsAt.getTime() - startsAt.getTime()) / MINUTE_MS;
    if (windowMinutes <= 0) {
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'must be after startsAt' });
    } else if (minimum && windowMinutes < minimum.minutes) {
        ctx.addIssue({
            code: 'custom',
            path: ['endsAt'],
            message: `the window must be at least ${minimum.minutes} minutes for the ${minimum.name} test`,
        });
    } else if (windowMinutes > MAX_WINDOW_MINUTES) {
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'the window cannot be longer than 7 days' });
    }
}

export const scheduleTestSchema = z
    .object({
        candidate,
        level: levelSchema,
        startsAt: instant.describe('When the candidate may first start the test'),
        endsAt: instant.describe('When the start window closes'),
    })
    .strict()
    .superRefine((value, ctx) => {
        addWindowIssues(ctx, value.startsAt, value.endsAt, {
            minutes: TEST_DURATION_MINUTES[value.level],
            name: value.level.toLowerCase(),
        });
    });

/** Only the window moves. The level, and so the test length, stays as it was booked. */
export const rescheduleTestSchema = z
    .object({
        startsAt: instant.describe('The new time the candidate may first start the test'),
        endsAt: instant.describe('The new time the start window closes'),
    })
    .strict()
    .superRefine((value, ctx) => {
        addWindowIssues(ctx, value.startsAt, value.endsAt);
    });

export const listSchedulesQuerySchema = z
    .object({
        ...paginationShape,
        status: statusSchema.optional(),
        level: levelSchema.optional(),
        q: z.string().trim().max(100).optional().describe("Matches the candidate's name or email"),
        invitedById: z.coerce
            .number()
            .int()
            .positive()
            .optional()
            .describe('Admins only: show one staff member’s tests. Advisors always see only their own.'),
        startsFrom: instant.optional(),
        startsTo: instant.optional(),
    })
    .strict();

// --- Response shapes. These document the API; they are not run against responses. ---

const dateTime = z.string().meta({ format: 'date-time' });

export const scheduleResponseSchema = z.object({
    id: z.number().int(),
    level: levelSchema,
    durationMinutes: z.number().int().describe('Fixed by the level when scheduled: Intermediate 22, Advanced 12'),
    startsAt: dateTime,
    endsAt: dateTime,
    latestStartAt: dateTime.describe('The last moment the candidate can start and still get the full duration'),
    status: statusSchema,
    invitationQueuedAt: dateTime.nullable().describe('Null until the invitation email has been queued'),
    createdAt: dateTime,
    candidate: z.object({
        id: z.number().int(),
        fullName: z.string(),
        email: z.string(),
        phone: z.string().nullable(),
    }),
    invitedBy: z.object({ id: z.number().int(), fullName: z.string() }),
});

export const schedulePageResponseSchema = pageOf(scheduleResponseSchema);

export const scheduleWithEmailStatusResponseSchema = z.object({
    schedule: scheduleResponseSchema,
    emailQueued: z
        .boolean()
        .describe('True when the invitation email was queued. False: use resend-email once the problem is fixed.'),
});
