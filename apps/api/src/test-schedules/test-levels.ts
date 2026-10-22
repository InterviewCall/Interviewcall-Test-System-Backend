import type { TestLevel } from '@app/prisma';

/** How long the test takes once the candidate starts it. The only place these numbers live. */
export const TEST_DURATION_MINUTES = {
    INTERMEDIATE: 22,
    ADVANCED: 12,
} as const satisfies Record<TestLevel, number>;

/** A start window longer than this is almost certainly a typo, such as the wrong year. */
export const MAX_WINDOW_MINUTES = 7 * 24 * 60;

export const MINUTE_MS = 60_000;

/** A start time this far behind the clock still counts as "now", so a request that was typed a moment ago isn't refused. */
export const START_GRACE_MS = MINUTE_MS;

/** The last moment a candidate can start and still get the whole test before the window closes. */
export function latestStartAt(endsAt: Date, durationMinutes: number): Date {
    return new Date(endsAt.getTime() - durationMinutes * MINUTE_MS);
}
