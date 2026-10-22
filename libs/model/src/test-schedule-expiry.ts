import { TestStatus } from '@app/prisma';
import type { ModelService } from './model.service.js';

const MINUTE_MS = 60_000;

/**
 * No test is longer than this, so a window that closes further away than this cannot be past
 * its last start yet. It only narrows the query; the exact check is done on each row below.
 */
const LONGEST_TEST_MINUTES = 120;

/**
 * Marks every invited test whose last possible start has passed as EXPIRED, and returns how many.
 *
 * A candidate can press start until the window closes minus the test length, so that moment, not
 * the close time, is when an unstarted test is over. Running it twice does no harm: it only ever
 * moves INVITED to EXPIRED, and the update re-checks the status so a test that has just been
 * started is never touched. The worker runs it every minute, and the API runs it before it reads
 * tests, so what people see never lags behind the clock.
 */
export async function expireOverdueTests(db: Pick<ModelService, 'testSchedule'>, now: Date = new Date()): Promise<number> {
    const candidates = await db.testSchedule.findMany({
        where: { status: TestStatus.INVITED, endsAt: { lte: new Date(now.getTime() + LONGEST_TEST_MINUTES * MINUTE_MS) } },
        select: { id: true, endsAt: true, durationMinutes: true },
    });

    const overdue = candidates
        .filter((test) => test.endsAt.getTime() - test.durationMinutes * MINUTE_MS <= now.getTime())
        .map((test) => test.id);
    if (overdue.length === 0) return 0;

    const result = await db.testSchedule.updateMany({
        where: { id: { in: overdue }, status: TestStatus.INVITED },
        data: { status: TestStatus.EXPIRED },
    });
    return result.count;
}
