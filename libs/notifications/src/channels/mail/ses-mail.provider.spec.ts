import type { SESv2Client } from '@aws-sdk/client-sesv2';
import { NotificationDeliveryError } from '../../errors/notification-delivery.error.js';
import { testConfig } from '../../../test/support/test-config.js';
import { SesMailProvider } from './ses-mail.provider.js';

const settings = testConfig({
    MAIL_DRIVER: 'ses',
    MAIL_FROM_ACCOUNTS: 'InterviewCall <accounts@notification.interviewcall.club>',
    MAIL_FROM_CANDIDATES: 'InterviewCall Tests <tests@notification.interviewcall.club>',
    MAIL_REPLY_TO: 'support@interviewcall.club',
    AWS_REGION: 'ap-south-1',
    SES_CONFIGURATION_SET: 'transactional',
}).mail;

const mail = { sender: 'accounts' as const, to: 'priya@example.com', subject: 'Hello ünï', html: '<p>Hi</p>', text: 'Hi' };

function providerWith(send: (command: { input: unknown }) => Promise<unknown>) {
    return new SesMailProvider(settings, { send } as unknown as SESv2Client);
}

function awsError(name: string, status: number, message = 'boom') {
    return Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });
}

describe('SesMailProvider', () => {
    it('sends HTML and text from the configured address', async () => {
        const send = vi.fn().mockResolvedValue({ MessageId: 'abc' });
        await providerWith(send).send(mail);

        expect(send.mock.calls[0][0].input).toEqual({
            FromEmailAddress: 'InterviewCall <accounts@notification.interviewcall.club>',
            Destination: { ToAddresses: ['priya@example.com'] },
            ReplyToAddresses: ['support@interviewcall.club'],
            ConfigurationSetName: 'transactional',
            Content: {
                Simple: {
                    Subject: { Data: 'Hello ünï', Charset: 'UTF-8' },
                    Body: { Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' }, Text: { Data: 'Hi', Charset: 'UTF-8' } },
                },
            },
        });
    });

    it('tags the message with its reference, so delivery reports can be matched to it', async () => {
        const send = vi.fn().mockResolvedValue({});
        await providerWith(send).send({ ...mail, ref: 'b1a7c1de-0f43-4d1a-9a52-2f1f0e6c9d11' });
        expect(send.mock.calls[0][0].input.EmailTags).toEqual([{ Name: 'mailRef', Value: 'b1a7c1de-0f43-4d1a-9a52-2f1f0e6c9d11' }]);

        await providerWith(send).send(mail);
        expect(send.mock.calls[1][0].input.EmailTags).toBeUndefined();
    });

    it('sends candidate mail from the candidates address', async () => {
        const send = vi.fn().mockResolvedValue({});
        await providerWith(send).send({ ...mail, sender: 'candidates' });
        expect(send.mock.calls[0][0].input.FromEmailAddress).toBe('InterviewCall Tests <tests@notification.interviewcall.club>');
    });

    it.each([
        ['MessageRejected', 400],
        ['MailFromDomainNotVerifiedException', 400],
        ['AccountSuspendedException', 400],
        ['BadRequestException', 400],
        ['SomethingElse', 403],
        ['LimitExceededException', 400],
    ])('treats %s (%i) as permanent', async (name, status) => {
        const error = await providerWith(() => Promise.reject(awsError(name, status))).send(mail).catch((e) => e);
        expect(error).toBeInstanceOf(NotificationDeliveryError);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain(`SES ${name}`);
    });

    it.each([
        ['TooManyRequestsException', 429],
        ['ThrottlingException', 400],
        ['Throttling', 400],
        ['InternalFailure', 500],
        ['ServiceUnavailable', 503],
    ])('treats %s (%i) as worth retrying', async (name, status) => {
        const error = await providerWith(() => Promise.reject(awsError(name, status))).send(mail).catch((e) => e);
        expect(error.retryable).toBe(true);
    });

    it('retries when there is no HTTP status at all (network down)', async () => {
        const error = await providerWith(() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))).send(mail).catch((e) => e);
        expect(error.retryable).toBe(true);
    });
});
