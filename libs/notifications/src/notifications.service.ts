import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { NOTIFICATIONS_CONFIG } from './config/notifications.config.js';
import { MAIL_QUEUE, SEND_MAIL_JOB, SEND_WHATSAPP_JOB, WHATSAPP_QUEUE } from './queue/queue.constants.js';
import { PayloadCipher } from './security/payload-cipher.js';
import type {
    MailJobData,
    SendWhatsAppInput,
    StaffAccountReadyInput,
    TestScheduledInput,
    WhatsAppJobData,
} from './types/notification.types.js';
import type { NotificationsConfig } from './types/notifications-config.types.js';
import { maskEmail, maskPhone, normalizePhone } from './utils/phone.js';
import { testStartUrl } from './utils/start-url.js';

const DEDUPE_KEY = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * BullMQ waits for Redis to come back before it adds a job, so with Redis down a plain
 * `queue.add` never settles. Give up after this long and report the job as not queued.
 */
export const ENQUEUE_TIMEOUT_MS = 3000;

function withinTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ENQUEUE_TIMEOUT_MS} ms`)), ENQUEUE_TIMEOUT_MS);
    });
    // If the timeout wins, the add may still land later; that is harmless, so don't let it become an unhandled rejection.
    work.catch(() => undefined);
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The only thing the rest of the API talks to. Each method queues a job and returns at once;
 * the worker app does the sending.
 *
 * Methods return whether the job was queued and never throw: a failed email must not undo
 * the account change that triggered it. Callers decide what to tell the user.
 */
@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue<MailJobData>,
        @InjectQueue(WHATSAPP_QUEUE) private readonly whatsappQueue: Queue<WhatsAppJobData>,
        private readonly cipher: PayloadCipher,
        @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
    ) {}

    /** Emails a staff member their sign-in details. The temporary password travels encrypted. */
    async sendStaffAccountReady(input: StaffAccountReadyInput): Promise<boolean> {
        const job: MailJobData = {
            template: 'staff-account-ready',
            to: input.email,
            params: {
                fullName: input.fullName,
                email: input.email,
                roleLabel: input.role.charAt(0) + input.role.slice(1).toLowerCase(),
                reason: input.reason,
            },
            secure: this.cipher.encrypt({ temporaryPassword: input.temporaryPassword }),
        };

        try {
            await withinTimeout(this.mailQueue.add(SEND_MAIL_JOB, job));
            this.logger.log(`Queued "staff-account-ready" (${input.reason}) for ${maskEmail(input.email)}`);
            return true;
        } catch (error) {
            this.logger.error(
                `Could not queue "staff-account-ready" for ${maskEmail(input.email)}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return false;
        }
    }

    /** The full start link for a candidate's secret, the same address the invitation email carries. */
    testStartUrl(inviteToken: string): string {
        return testStartUrl(this.config.testPortalUrl, inviteToken);
    }

    /** Emails a candidate their test slot. The start link carries a secret, so it travels in the sealed part of the job. */
    sendTestScheduled(input: TestScheduledInput): Promise<boolean> {
        return this.queueCandidateSlot('candidate-test-scheduled', input);
    }

    /** Tells a candidate their slot has moved, with the new time. Same data as the first email. */
    sendTestRescheduled(input: TestScheduledInput): Promise<boolean> {
        return this.queueCandidateSlot('candidate-test-rescheduled', input);
    }

    private async queueCandidateSlot(template: 'candidate-test-scheduled' | 'candidate-test-rescheduled', input: TestScheduledInput): Promise<boolean> {
        const job: MailJobData = {
            template,
            to: input.email,
            params: {
                fullName: input.fullName,
                startsAt: input.startsAt.toISOString(),
                endsAt: input.endsAt.toISOString(),
                durationMinutes: String(input.durationMinutes),
            },
            ref: input.mailRef,
            secure: this.cipher.encrypt({ inviteToken: input.inviteToken }),
        };

        try {
            await withinTimeout(this.mailQueue.add(SEND_MAIL_JOB, job));
            this.logger.log(`Queued "${template}" for ${maskEmail(input.email)}`);
            return true;
        } catch (error) {
            this.logger.error(
                `Could not queue "${template}" for ${maskEmail(input.email)}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return false;
        }
    }

    /** Queues an approved AiSensy template message. Returns false for a number that can't be real. */
    async sendWhatsApp(input: SendWhatsAppInput): Promise<boolean> {
        const destination = normalizePhone(input.phone, this.config.whatsapp.defaultCountryCode);
        if (!destination) {
            this.logger.warn(`Not queuing "${input.campaignName}": the phone number is not valid`);
            return false;
        }
        if (input.dedupeKey !== undefined && !DEDUPE_KEY.test(input.dedupeKey)) {
            this.logger.error(`Not queuing "${input.campaignName}": dedupeKey may only use letters, digits, - and _`);
            return false;
        }

        try {
            await withinTimeout(
                this.whatsappQueue.add(
                    SEND_WHATSAPP_JOB,
                    {
                        campaignName: input.campaignName,
                        destination,
                        userName: input.userName,
                        templateParams: input.templateParams,
                    },
                    input.dedupeKey ? { jobId: input.dedupeKey } : undefined,
                ),
            );
            this.logger.log(`Queued WhatsApp "${input.campaignName}" for ${maskPhone(destination)}`);
            return true;
        } catch (error) {
            this.logger.error(
                `Could not queue WhatsApp "${input.campaignName}": ${error instanceof Error ? error.message : String(error)}`,
            );
            return false;
        }
    }
}
