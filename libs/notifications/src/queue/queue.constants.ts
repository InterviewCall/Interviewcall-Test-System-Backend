import type { JobsOptions } from 'bullmq';

// BullMQ queue names can't contain ":".
export const MAIL_QUEUE = 'notifications-mail';
export const WHATSAPP_QUEUE = 'notifications-whatsapp';

export const SEND_MAIL_JOB = 'send-mail';
export const SEND_WHATSAPP_JOB = 'send-whatsapp';

/**
 * Retries ride out SES/AiSensy throttling and short outages: 15 s, 30 s, 60 s, 2 min.
 * Finished jobs are kept for a day, failed ones for a week, so a support question
 * ("did she get the email?") can still be answered from the queue.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
};
