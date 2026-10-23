import { MailDeliveryStatus } from '@app/prisma';
import { describe, expect, it } from 'vitest';
import { sesEvent } from '../../test/support/sns-fixture.js';
import { interpretSesEvent } from './ses-event.js';

const REF = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('interpretSesEvent', () => {
    it('reads a send', () => {
        expect(interpretSesEvent(sesEvent('Send', REF))).toEqual({
            ref: REF,
            status: MailDeliveryStatus.SENT,
            detail: null,
            at: new Date('2026-10-23T08:00:00.000Z'),
        });
    });

    it('reads a delivery and prefers its own timestamp', () => {
        const update = interpretSesEvent(sesEvent('Delivery', REF, { delivery: { timestamp: '2026-10-23T08:00:05.000Z' } }));
        expect(update).toMatchObject({ status: MailDeliveryStatus.DELIVERED, at: new Date('2026-10-23T08:00:05.000Z') });
    });

    it('reads a permanent bounce with the mail server\'s explanation', () => {
        const update = interpretSesEvent(
            sesEvent('Bounce', REF, {
                bounce: {
                    bounceType: 'Permanent',
                    bounceSubType: 'General',
                    timestamp: '2026-10-23T08:00:03.000Z',
                    bouncedRecipients: [{ emailAddress: 'a@b.com', status: '5.1.1', diagnosticCode: 'smtp; 550 5.1.1 user unknown' }],
                },
            }),
        );
        expect(update).toMatchObject({
            status: MailDeliveryStatus.BOUNCED,
            detail: 'Permanent bounce (General): smtp; 550 5.1.1 user unknown',
        });
    });

    it('reads a bounce that carries no explanation', () => {
        const update = interpretSesEvent(sesEvent('Bounce', REF, { bounce: { bounceType: 'Transient' } }));
        expect(update).toMatchObject({ status: MailDeliveryStatus.BOUNCED, detail: 'Transient bounce' });
    });

    it('reads a complaint', () => {
        const update = interpretSesEvent(sesEvent('Complaint', REF, { complaint: { complaintFeedbackType: 'abuse' } }));
        expect(update).toMatchObject({ status: MailDeliveryStatus.COMPLAINED, detail: 'The recipient reported it as spam (abuse)' });
    });

    it('reads a rejection', () => {
        const update = interpretSesEvent(sesEvent('Reject', REF, { reject: { reason: 'Bad content' } }));
        expect(update).toMatchObject({ status: MailDeliveryStatus.REJECTED, detail: 'SES rejected it: Bad content' });
    });

    it('reads a delay', () => {
        const update = interpretSesEvent(
            sesEvent('DeliveryDelay', REF, {
                deliveryDelay: { delayType: 'MailboxFull', delayedRecipients: [{ diagnosticCode: '452 mailbox full' }] },
            }),
        );
        expect(update).toMatchObject({ status: MailDeliveryStatus.DELAYED, detail: 'Delayed (MailboxFull): 452 mailbox full' });
    });

    it('understands the older notificationType field', () => {
        const raw = JSON.stringify({ notificationType: 'Delivery', mail: { tags: { mailRef: [REF] } } });
        expect(interpretSesEvent(raw)).toMatchObject({ status: MailDeliveryStatus.DELIVERED });
    });

    it('keeps long explanations within the column', () => {
        const update = interpretSesEvent(
            sesEvent('Bounce', REF, { bounce: { bounceType: 'Permanent', bouncedRecipients: [{ diagnosticCode: 'x'.repeat(2000) }] } }),
        );
        expect(update!.detail!.length).toBe(500);
    });

    it('falls back to now when a timestamp is unusable', () => {
        const raw = JSON.stringify({ eventType: 'Send', mail: { timestamp: 'garbage', tags: { mailRef: [REF] } } });
        expect(Math.abs(interpretSesEvent(raw)!.at.getTime() - Date.now())).toBeLessThan(5000);
    });

    it.each([
        ['an event for an email we did not tag', JSON.stringify({ eventType: 'Delivery', mail: { tags: {} } })],
        ['an event with a malformed tag', sesEvent('Delivery', 'has spaces!')],
        ['an event type we do not track', sesEvent('Open', REF)],
        ['an event type we do not track (click)', sesEvent('Click', REF)],
        ['an event with no mail section', JSON.stringify({ eventType: 'Delivery' })],
        ['text that is not JSON', 'Successfully validated SNS topic'],
        ['JSON that is not an object', '42'],
    ])('ignores %s', (_label, raw) => {
        expect(interpretSesEvent(raw)).toBeNull();
    });
});
