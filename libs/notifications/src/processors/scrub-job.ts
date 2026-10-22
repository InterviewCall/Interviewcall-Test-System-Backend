import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

const logger = new Logger('NotificationJobs');

/**
 * Removes the sealed secrets from a job once it has been delivered or given up on, so
 * nothing sensitive lingers in Redis for the days the job is kept. Best effort: the job
 * may already be gone.
 */
export async function scrubSecrets(job: Job<{ secure?: string }>): Promise<void> {
    if (!job.data.secure) return;
    try {
        await job.updateData({ ...job.data, secure: undefined });
    } catch (error) {
        logger.warn(`Could not scrub job ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
