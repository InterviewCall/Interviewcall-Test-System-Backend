import { MAIL_REF_TAG } from '@app/notifications';
import { MailDeliveryStatus } from '@app/prisma';
import { z } from 'zod';

/** What an SES delivery report means for the test whose email it is about. */
export interface MailEventUpdate {
    ref: string;
    status: MailDeliveryStatus;
    detail: string | null;
    at: Date;
}

const REF = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DETAIL = 500;

const recipient = z.object({ diagnosticCode: z.string().optional(), status: z.string().optional() }).loose();

// Only the parts of an SES event we read. Everything else is left alone, so a new field from AWS breaks nothing.
const sesEventSchema = z
    .object({
        eventType: z.string().optional(),
        notificationType: z.string().optional(),
        mail: z.object({ timestamp: z.string().optional(), tags: z.record(z.string(), z.array(z.string())).optional() }).loose(),
        delivery: z.object({ timestamp: z.string().optional() }).loose().optional(),
        bounce: z
            .object({
                bounceType: z.string().optional(),
                bounceSubType: z.string().optional(),
                timestamp: z.string().optional(),
                bouncedRecipients: z.array(recipient).optional(),
            })
            .loose()
            .optional(),
        complaint: z.object({ complaintFeedbackType: z.string().optional(), timestamp: z.string().optional() }).loose().optional(),
        reject: z.object({ reason: z.string().optional() }).loose().optional(),
        deliveryDelay: z
            .object({ delayType: z.string().optional(), timestamp: z.string().optional(), delayedRecipients: z.array(recipient).optional() })
            .loose()
            .optional(),
    })
    .loose();

const clip = (text: string) => (text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text);
const join = (head: string, tail: string | undefined) => clip(tail ? `${head}: ${tail}` : head);
const timeOf = (...candidates: (string | undefined)[]): Date => {
    for (const candidate of candidates) {
        const date = candidate ? new Date(candidate) : undefined;
        if (date && !Number.isNaN(date.getTime())) return date;
    }
    return new Date();
};

/**
 * Turns the JSON inside an SNS notification into an update, or null when it isn't about one of our
 * tagged emails or isn't a report we track (opens and clicks, for one).
 */
export function interpretSesEvent(rawMessage: string): MailEventUpdate | null {
    let json: unknown;
    try {
        json = JSON.parse(rawMessage);
    } catch {
        return null;
    }
    const parsed = sesEventSchema.safeParse(json);
    if (!parsed.success) return null;
    const event = parsed.data;

    const ref = event.mail.tags?.[MAIL_REF_TAG]?.[0];
    if (!ref || !REF.test(ref)) return null;

    const kind = event.eventType ?? event.notificationType;
    const finish = (status: MailDeliveryStatus, detail: string | null, at: Date): MailEventUpdate => ({ ref, status, detail, at });

    switch (kind) {
        case 'Send':
            return finish(MailDeliveryStatus.SENT, null, timeOf(event.mail.timestamp));
        case 'Delivery':
            return finish(MailDeliveryStatus.DELIVERED, null, timeOf(event.delivery?.timestamp, event.mail.timestamp));
        case 'Bounce': {
            const { bounceType, bounceSubType, bouncedRecipients, timestamp } = event.bounce ?? {};
            const first = bouncedRecipients?.[0];
            const head = `${bounceType ?? 'Unknown'} bounce${bounceSubType ? ` (${bounceSubType})` : ''}`;
            return finish(MailDeliveryStatus.BOUNCED, join(head, first?.diagnosticCode ?? first?.status), timeOf(timestamp, event.mail.timestamp));
        }
        case 'Complaint': {
            const type = event.complaint?.complaintFeedbackType;
            return finish(
                MailDeliveryStatus.COMPLAINED,
                clip(`The recipient reported it as spam${type ? ` (${type})` : ''}`),
                timeOf(event.complaint?.timestamp, event.mail.timestamp),
            );
        }
        case 'Reject':
            return finish(MailDeliveryStatus.REJECTED, join('SES rejected it', event.reject?.reason), timeOf(event.mail.timestamp));
        case 'DeliveryDelay': {
            const { delayType, delayedRecipients, timestamp } = event.deliveryDelay ?? {};
            const first = delayedRecipients?.[0];
            return finish(MailDeliveryStatus.DELAYED, join(`Delayed (${delayType ?? 'unknown reason'})`, first?.diagnosticCode ?? first?.status), timeOf(timestamp, event.mail.timestamp));
        }
        default:
            return null;
    }
}
