import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ModelService, submitOverdueAttempts } from '@app/model';

export const AUTO_SUBMIT_INTERVAL_MS = 15_000;

/**
 * Submits tests whose time ran out. A candidate who closes the laptop at minute five still gets a
 * score, from whatever was saved. Runs once on start (to catch up) and every 15 seconds. Several
 * workers can run it together: the first to claim an attempt wins, the rest skip it.
 */
@Injectable()
export class AutoSubmitService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(AutoSubmitService.name);
    private timer?: NodeJS.Timeout;
    private running = false;

    constructor(private readonly db: ModelService) {}

    onApplicationBootstrap(): void {
        void this.sweep();
        this.timer = setInterval(() => void this.sweep(), AUTO_SUBMIT_INTERVAL_MS);
    }

    onApplicationShutdown(): void {
        clearInterval(this.timer);
    }

    /** Public so a test can run one pass. Never throws. */
    async sweep(now: Date = new Date()): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        try {
            const count = await submitOverdueAttempts(this.db, now);
            if (count > 0) this.logger.log(`Auto-submitted ${count} timed-out attempt${count === 1 ? '' : 's'}`);
            return count;
        } catch (error) {
            this.logger.error(`Could not auto-submit overdue attempts: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
        } finally {
            this.running = false;
        }
    }
}
