import { describe, expect, it, vi } from 'vitest';
import { CERT_URL, signedSnsMessage, TEST_CERTIFICATE } from '../../test/support/sns-fixture.js';
import { InvalidSnsMessageError, isSnsUrl, snsMessageSchema, SnsVerifier } from './sns-verifier.js';

const parse = (raw: Record<string, string>) => snsMessageSchema.parse(raw);
const verifierWith = (fetchText = vi.fn(async () => TEST_CERTIFICATE)) => ({ fetchText, verifier: new SnsVerifier(fetchText) });

describe('SnsVerifier', () => {
    it.each(['1', '2'] as const)('accepts a notification signed with version %s', async (version) => {
        const { verifier } = verifierWith();
        await expect(verifier.verify(parse(signedSnsMessage({ Subject: 'hello' }, version)))).resolves.toBeUndefined();
    });

    it('accepts a notification that has no subject', async () => {
        const { verifier } = verifierWith();
        await expect(verifier.verify(parse(signedSnsMessage()))).resolves.toBeUndefined();
    });

    it('accepts a subscription confirmation', async () => {
        const { verifier } = verifierWith();
        const message = signedSnsMessage({
            Type: 'SubscriptionConfirmation',
            Token: 'abc123',
            SubscribeURL: 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc123',
        });
        await expect(verifier.verify(parse(message))).resolves.toBeUndefined();
    });

    it('rejects a message whose content was changed after signing', async () => {
        const { verifier } = verifierWith();
        const message = signedSnsMessage({ Message: '{"eventType":"Bounce"}' });
        await expect(verifier.verify(parse({ ...message, Message: '{"eventType":"Delivery"}' }))).rejects.toThrow(InvalidSnsMessageError);
    });

    it('rejects a signature from a different key', async () => {
        const { verifier } = verifierWith();
        const message = signedSnsMessage();
        const other = signedSnsMessage({ MessageId: 'someone-else' });
        await expect(verifier.verify(parse({ ...message, Signature: other.Signature! }))).rejects.toThrow(/does not match/);
    });

    it('rejects a certificate that is not on an SNS address, without fetching it', async () => {
        const { verifier, fetchText } = verifierWith();
        const message = signedSnsMessage({ SigningCertURL: 'https://evil.example.com/cert.pem' });
        await expect(verifier.verify(parse(message))).rejects.toThrow(/not on an SNS address/);
        expect(fetchText).not.toHaveBeenCalled();
    });

    it('rejects an unknown signature version', async () => {
        const { verifier } = verifierWith();
        await expect(verifier.verify(parse({ ...signedSnsMessage(), SignatureVersion: '3' }))).rejects.toThrow(/Unsupported/);
    });

    it('reports a certificate it cannot fetch as an invalid message', async () => {
        const { verifier } = verifierWith(vi.fn(async () => Promise.reject(new Error('HTTP 500'))));
        await expect(verifier.verify(parse(signedSnsMessage()))).rejects.toThrow(InvalidSnsMessageError);
    });

    it('treats a garbage certificate as an invalid signature', async () => {
        const { verifier } = verifierWith(vi.fn(async () => 'not a certificate'));
        await expect(verifier.verify(parse(signedSnsMessage()))).rejects.toThrow(/does not match/);
    });

    it('fetches the certificate once and reuses it', async () => {
        const { verifier, fetchText } = verifierWith();
        await verifier.verify(parse(signedSnsMessage()));
        await verifier.verify(parse(signedSnsMessage({ MessageId: 'another' })));
        expect(fetchText).toHaveBeenCalledTimes(1);
        expect(fetchText).toHaveBeenCalledWith(CERT_URL);
    });
});

describe('isSnsUrl', () => {
    it.each([
        'https://sns.ap-south-1.amazonaws.com/x.pem',
        'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
        'https://sns.cn-north-1.amazonaws.com.cn/x.pem',
    ])('accepts %s', (url) => expect(isSnsUrl(url)).toBe(true));

    it.each([
        'http://sns.ap-south-1.amazonaws.com/x.pem',
        'https://sns.ap-south-1.amazonaws.com.evil.com/x.pem',
        'https://evil.com/sns.ap-south-1.amazonaws.com/x.pem',
        'https://user@sns.ap-south-1.amazonaws.com/x.pem',
        'https://sns.ap-south-1.amazonaws.com:8443/x.pem',
        'https://s3.ap-south-1.amazonaws.com/x.pem',
        'not a url',
    ])('rejects %s', (url) => expect(isSnsUrl(url)).toBe(false));
});
