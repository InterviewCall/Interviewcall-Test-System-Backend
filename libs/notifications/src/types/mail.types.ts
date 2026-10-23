/** Every email we can send. Add the id here, then add its three template files. */
export const MAIL_TEMPLATE_IDS = ['staff-account-ready', 'candidate-test-scheduled', 'candidate-test-rescheduled'] as const;
export type MailTemplateId = (typeof MAIL_TEMPLATE_IDS)[number];

/**
 * Which address an email is sent from. Each template picks one:
 * - accounts: staff sign-in details (account created, password reset, ...)
 * - candidates: anything sent to a candidate (test scheduled, ...)
 */
export const MAIL_SENDERS = ['accounts', 'candidates'] as const;
export type MailSender = (typeof MAIL_SENDERS)[number];

export type StaffAccountReason = 'created' | 'reset' | 'reactivated';

/** Added to every template by the worker. */
export interface MailGlobals {
    appName: string;
    staffConsoleUrl: string;
    testPortalUrl: string;
    year: number;
}

/**
 * The name of the SES message tag that carries a mail's reference. SES repeats the tags of a message in every
 * delivery event, so the reference is how a "delivered" or "bounced" report finds the test it belongs to.
 */
export const MAIL_REF_TAG = 'mailRef';

/** Letters, digits, - and _ only: what SES accepts in a tag value. */
export const MAIL_REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface RenderedMail {
    sender: MailSender;
    to: string;
    subject: string;
    html: string;
    text: string;
    /** Sent to SES as the mailRef tag, when the caller wants to follow this email's delivery. */
    ref?: string;
}

export interface MailProvider {
    /** Resolves once the provider has accepted the message. Throws NotificationDeliveryError otherwise. */
    send(mail: RenderedMail): Promise<void>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
