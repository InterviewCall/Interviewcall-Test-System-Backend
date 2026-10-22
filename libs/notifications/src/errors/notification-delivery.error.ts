import { UnrecoverableError } from 'bullmq';

/** A provider refused or failed to send. `retryable` says whether trying again could help. */
export class NotificationDeliveryError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = 'NotificationDeliveryError';
    }
}

/**
 * Lets BullMQ know whether to schedule another attempt: an UnrecoverableError goes
 * straight to "failed" (a rejected address will still be rejected in a minute).
 */
export function toJobError(error: unknown): Error {
    if (error instanceof NotificationDeliveryError && !error.retryable) {
        return new UnrecoverableError(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
}
