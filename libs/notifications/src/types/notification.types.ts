import type { MailTemplateId, StaffAccountReason } from './mail.types.js';
import type { WhatsAppMessage } from './whatsapp.types.js';

/** What sits in Redis for a queued email. */
export interface MailJobData {
    template: MailTemplateId;
    to: string;
    /** Not sensitive: stored as plain JSON. */
    params: Record<string, string>;
    /** Follows the email's delivery: sent to SES as a tag and echoed in every delivery event. Not sensitive. */
    ref?: string;
    /** Encrypted JSON of the sensitive values. Removed from the job once it is delivered or has given up. */
    secure?: string;
}

/** What sits in Redis for a queued WhatsApp message. */
export type WhatsAppJobData = WhatsAppMessage;

export interface StaffAccountReadyInput {
    fullName: string;
    email: string;
    role: string;
    temporaryPassword: string;
    reason: StaffAccountReason;
}

export interface TestScheduledInput {
    fullName: string;
    email: string;
    /** The window in which the candidate may start the test. */
    startsAt: Date;
    endsAt: Date;
    /** How long the test takes once started. Depends on the level, so the caller supplies it. */
    durationMinutes: number;
    /** The secret in the candidate's start link. Travels sealed, never as plain job data. */
    inviteToken: string;
    /** Tags this email so SES delivery reports (delivered, bounced) can be matched to it. */
    mailRef?: string;
}

export interface SendWhatsAppInput {
    campaignName: string;
    /** As stored, e.g. "+91 70446 10338" or "7044610338". */
    phone: string;
    userName: string;
    templateParams: string[];
    /**
     * Makes the send idempotent: queueing the same id twice sends once. Use something that
     * identifies the event, like `test-scheduled-<scheduleId>`. Letters, digits, `-` and `_` only.
     */
    dedupeKey?: string;
}
