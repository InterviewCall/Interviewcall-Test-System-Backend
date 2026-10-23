import { TestStatus } from '@app/prisma';
import { ANSWER_GRACE_MS } from '@app/model';
import { latestStartAt } from '../test-schedules/test-levels.js';

/** How long after submitting a candidate can still send feedback. */
export const FEEDBACK_WINDOW_MS = 60 * 60_000;

interface WindowFacts {
    status: TestStatus;
    durationMinutes: number;
    endsAt: Date;
    attempt: { submittedAt: Date | null } | null;
}

/**
 * Whether a candidate may be in the test portal at all right now. The rule is simple: their link is good
 * while the slot is. Once the window has closed, or the test has expired, nobody gets back in until an
 * advisor or admin reschedules it (which gives a new link).
 */
export function portalIsOpen(schedule: WindowFacts, now: Date): boolean {
    switch (schedule.status) {
        case TestStatus.INVITED:
            // Too late to start means the slot is over for them, even if the window has a few minutes left.
            return now.getTime() <= latestStartAt(schedule.endsAt, schedule.durationMinutes).getTime();
        case TestStatus.IN_PROGRESS:
            return now.getTime() <= schedule.endsAt.getTime() + ANSWER_GRACE_MS;
        case TestStatus.SUBMITTED: {
            const submittedAt = schedule.attempt?.submittedAt;
            return !!submittedAt && now.getTime() <= submittedAt.getTime() + FEEDBACK_WINDOW_MS;
        }
        default:
            return false;
    }
}

/** A session never outlives the slot. */
export function sessionExpiry(endsAt: Date): Date {
    return new Date(endsAt.getTime() + ANSWER_GRACE_MS);
}
