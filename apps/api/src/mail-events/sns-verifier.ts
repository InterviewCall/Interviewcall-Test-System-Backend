import { createVerify } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

/** Fetches a URL and returns its body as text. A provider, so tests never touch the network. */
export const SNS_FETCH = Symbol('SNS_FETCH');
export type SnsFetch = (url: string) => Promise<string>;

export const snsMessageSchema = z.object({
    Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
    MessageId: z.string(),
    TopicArn: z.string(),
    Message: z.string(),
    Timestamp: z.string(),
    SignatureVersion: z.string(),
    Signature: z.string(),
    SigningCertURL: z.string(),
    Subject: z.string().optional(),
    SubscribeURL: z.string().optional(),
    Token: z.string().optional(),
});
export type SnsMessage = z.infer<typeof snsMessageSchema>;

// The fields AWS signs, in the order it signs them. A field the message doesn't have is left out.
const SIGNED_FIELDS = {
    Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
    SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
    UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
} as const;

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** Only AWS's own SNS addresses are ever fetched, so a forged message can't make the API call somewhere else. */
export function isSnsUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.port === '' && url.username === '' && SNS_HOST.test(url.hostname);
    } catch {
        return false;
    }
}

function isSigningCertUrl(value: string): boolean {
    return isSnsUrl(value) && new URL(value).pathname.endsWith('.pem');
}

export class InvalidSnsMessageError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'InvalidSnsMessageError';
    }
}

const MAX_CACHED_CERTS = 10;

/**
 * Checks that a message really came from AWS SNS: the signature must match the certificate AWS
 * publishes. Without this, anyone who found the webhook address could mark any email as delivered.
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */
@Injectable()
export class SnsVerifier {
    private readonly certs = new Map<string, string>();

    constructor(@Inject(SNS_FETCH) private readonly fetchText: SnsFetch) {}

    async verify(message: SnsMessage): Promise<void> {
        const algorithm = message.SignatureVersion === '1' ? 'RSA-SHA1' : message.SignatureVersion === '2' ? 'RSA-SHA256' : undefined;
        if (!algorithm) throw new InvalidSnsMessageError(`Unsupported signature version: ${message.SignatureVersion}`);
        if (!isSigningCertUrl(message.SigningCertURL)) throw new InvalidSnsMessageError('The signing certificate is not on an SNS address');

        const certificate = await this.certificate(message.SigningCertURL);
        const text = SIGNED_FIELDS[message.Type]
            .filter((field) => message[field] !== undefined)
            .map((field) => `${field}\n${message[field]}\n`)
            .join('');

        let valid = false;
        try {
            valid = createVerify(algorithm).update(text, 'utf8').verify(certificate, message.Signature, 'base64');
        } catch {
            // A malformed certificate or signature is simply not valid.
        }
        if (!valid) throw new InvalidSnsMessageError('The signature does not match');
    }

    private async certificate(url: string): Promise<string> {
        const cached = this.certs.get(url);
        if (cached) return cached;
        let pem: string;
        try {
            pem = await this.fetchText(url);
        } catch (error) {
            throw new InvalidSnsMessageError(`Could not fetch the signing certificate: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (this.certs.size >= MAX_CACHED_CERTS) this.certs.clear();
        this.certs.set(url, pem);
        return pem;
    }
}
