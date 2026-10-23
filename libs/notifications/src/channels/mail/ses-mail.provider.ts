import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { NotificationDeliveryError } from '../../errors/notification-delivery.error.js';
import type { NotificationsConfig } from '../../types/notifications-config.types.js';
import { MAIL_REF_TAG } from '../../types/mail.types.js';
import type { MailProvider, RenderedMail } from '../../types/mail.types.js';

// Mistakes in the message or the account: trying again won't change the answer.
const PERMANENT = new Set([
    'MessageRejected',
    'MailFromDomainNotVerifiedException',
    'AccountSuspendedException',
    'SendingPausedException',
    'NotFoundException',
    'BadRequestException',
    'InvalidParameterValue',
]);

// AWS reports some throttling as a plain 400, which would otherwise look permanent.
const THROTTLED = new Set(['Throttling', 'ThrottlingException', 'TooManyRequestsException', 'RequestLimitExceeded']);

/** Sends through AWS SES v2. Credentials come from the standard AWS chain (env vars, profile, instance role). */
export class SesMailProvider implements MailProvider {
    private readonly client: SESv2Client;

    constructor(
        private readonly settings: NotificationsConfig['mail'],
        client?: SESv2Client,
    ) {
        this.client = client ?? new SESv2Client({ region: settings.region });
    }

    async send(mail: RenderedMail): Promise<void> {
        try {
            await this.client.send(
                new SendEmailCommand({
                    FromEmailAddress: this.settings.from[mail.sender],
                    Destination: { ToAddresses: [mail.to] },
                    ReplyToAddresses: this.settings.replyTo ? [this.settings.replyTo] : undefined,
                    ConfigurationSetName: this.settings.configurationSet,
                    EmailTags: mail.ref ? [{ Name: MAIL_REF_TAG, Value: mail.ref }] : undefined,
                    Content: {
                        Simple: {
                            Subject: { Data: mail.subject, Charset: 'UTF-8' },
                            Body: {
                                Html: { Data: mail.html, Charset: 'UTF-8' },
                                Text: { Data: mail.text, Charset: 'UTF-8' },
                            },
                        },
                    },
                }),
            );
        } catch (error) {
            const name = error instanceof Error ? error.name : 'Error';
            const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
            const message = error instanceof Error ? error.message : String(error);
            // Anything not clearly permanent (throttling, 5xx, network) is worth another attempt.
            const retryable = THROTTLED.has(name) || (!PERMANENT.has(name) && !(status !== undefined && status >= 400 && status < 500 && status !== 429));
            throw new NotificationDeliveryError(`SES ${name}: ${message}`, retryable, { cause: error });
        }
    }
}
