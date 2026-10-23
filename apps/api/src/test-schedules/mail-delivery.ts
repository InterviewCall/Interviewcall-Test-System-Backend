import { MailDeliveryStatus } from '@app/prisma';

/**
 * How far along an email is. A status only ever moves to a higher one, so a late "sent"
 * report never undoes "delivered", and the order SES delivers its reports in doesn't matter.
 * A bounce and a rejection are two ways of ending up at the same place, so they share a rank.
 */
const RANK: Record<MailDeliveryStatus, number> = {
    [MailDeliveryStatus.QUEUED]: 1,
    [MailDeliveryStatus.SENT]: 2,
    [MailDeliveryStatus.DELAYED]: 3,
    [MailDeliveryStatus.DELIVERED]: 4,
    [MailDeliveryStatus.BOUNCED]: 5,
    [MailDeliveryStatus.REJECTED]: 5,
    [MailDeliveryStatus.COMPLAINED]: 6,
};

/** The statuses an email may currently have for `next` to replace them. */
export function statusesBelow(next: MailDeliveryStatus): MailDeliveryStatus[] {
    return Object.values(MailDeliveryStatus).filter((status) => RANK[status] < RANK[next]);
}
