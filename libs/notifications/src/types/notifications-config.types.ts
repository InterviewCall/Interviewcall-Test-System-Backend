import type { MailSender } from './mail.types.js';
export type MailDriver = 'ses' | 'console';
export type WhatsAppDriver = 'aisensy' | 'console';

export interface NotificationsConfig {
    redis: {
        host: string;
        port: number;
        username: string | undefined;
        password: string | undefined;
        db: number;
        tls: boolean;
    };
    /** Namespaces our keys, so the queues can share a Redis with other services. */
    queuePrefix: string;
    /** 32 raw bytes. Encrypts secrets (temporary passwords) inside queued jobs. */
    payloadKey: Buffer;
    appName: string;
    /** Where staff sign in. Linked from the account emails. */
    staffConsoleUrl: string;
    /** Where candidates take their test. Linked from the test-scheduled email. */
    testPortalUrl: string;
    mail: {
        driver: MailDriver;
        /** e.g. `InterviewCall <no-reply@notification.interviewcall.club>`. Each must be an SES-verified identity. */
        from: Record<MailSender, string | undefined>;
        replyTo: string | undefined;
        region: string | undefined;
        configurationSet: string | undefined;
    };
    whatsapp: {
        driver: WhatsAppDriver;
        apiKey: string | undefined;
        apiUrl: string;
        /** Lead source label AiSensy records against the contact. */
        source: string;
        /** Prefixed to local numbers that have no country code. */
        defaultCountryCode: string;
    };
}
