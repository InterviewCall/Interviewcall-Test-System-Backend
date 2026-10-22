import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ModelService, expireOverdueTests } from '@app/model';

export const EXPIRY_INTERVAL_MS = 60_000;

/**
 * Moves tests nobody started in time from Invited to Expired. It runs once on start, to catch up
 * on anything that closed while the worker was off, and then every minute. Several workers can
 * run it at once: the update is safe to repeat.
 */
@Injectable()
export class ExpiryService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(ExpiryService.name);
    private timer?: NodeJS.Timeout;
    private running = false;

    constructor(private readonly db: ModelService) {}

    onApplicationBootstrap(): void {
        void this.sweep();
        this.timer = setInterval(() => void this.sweep(), EXPIRY_INTERVAL_MS);
    }

    onApplicationShutdown(): void {
        clearInterval(this.timer);
    }

    /** Public so a test can run one pass. Never throws: a database blip should not stop the next minute's pass. */
    async sweep(now: Date = new Date()): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        try {
            const count = await expireOverdueTests(this.db, now);
            if (count > 0) this.logger.log(`Marked ${count} test${count === 1 ? '' : 's'} as expired`);
            return count;
        } catch (error) {
            this.logger.error(`Could not expire overdue tests: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
        } finally {
            this.running = false;
        }
    }
}
