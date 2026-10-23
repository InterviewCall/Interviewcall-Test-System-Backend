import { createSign } from 'node:crypto';

/**
 * A throwaway key pair and certificate, made only for tests, standing in for the ones AWS signs SNS
 * messages with. Nothing here is a real secret.
 */
export const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDpb5dfT5oOclPJ
w1G0k4PlV5g/XSPF1OdQLJvpkJWj1yJTH+n9n9XDI7wr+Tw5nT6loYJgLpKxXJni
DZ8QFbTC9J8HrQ4Ied2oUMtjeXppM3TdZDf6hHc07C62iCpinmw69Bm65W+KmmZ3
4eDHzFvxnEc6OzklWHbvTtaMWJlgQsVSFWmSJjRrgHcuoTyDFkMfpQU5OOCO3YkW
2zAcUXGsxH8baS0ueBO4sxdWjUdCO8ZxpYnWTub2OjH87JWMEmESeiiWosvP0L5c
qtZR/krk1xh5NbyUneeoSm2G5MS/623Vu06n4BmW/wTWYLRKArBqjIFk+0ZMcX8P
wxGP74NrAgMBAAECggEAOaN6JuiKy4JjOfBmXkYGTTyhtROUX6bALsW1AajXqgrW
yNuadStgJrzOG7WAr2EqNM96V7FoOy74OB7Q5bHWXkT0d3q9ek5M8uBwN/Gozg0M
kBXM1Kicno6qwhtBC/S+GJhpOgKo1fplzrgRPoQxN6k01SYGaDg9tb0rsJ+3z1J0
mS93sNTkMp5zyDpBznnb1WfmoeX+omTW+3mj2lx0BNqnEU5Eky6zKEBoFSupgXLe
gcEY2B8qtg3x6BiQPBJ/SuYVPw+RYZQzihagkC3k+vQXZTyFzI+CMaceo0/sGAa1
Xhq+YKFvOjOfYMjBpEiXNni9Pl42Lb8HDSgop2X84QKBgQD1qhg/dCfRI4lu53vg
glp3XmP/TpAUF450WYrcHkUTMjQhHQhOMwz06faNB9wAsaqpFi+GHItBC7nGVnpX
2QkPbGZ5guwooQBEi52I3f+jJKIu54bfctCefeVuEqGrAruClHJUdiJXgv3Ux2Yh
HGCRA3dyf84H5p17Qi35GsJlaQKBgQDzQcpWL+SNn5DsZGmTK+13SZhplgs4/ETW
6OdrkHEzNMFY5ngQqm5n0V6YdQtYI5eqNYfhuZMBDUODkccgS7Ay53SILFkiS2xx
ngOMDlwJ2nN1lk3GjjY5W9vdd0JRpdsR3+0+vJS5ITd9IJmnkdVzbATU0XEifes5
34DRNhNjswKBgGcPktib/FBK3k8+ocOQLC/D06O568viDgtVvWGW+VeSSjhSG7fi
xt7AgISt9Wf9ISGKgyl6NBl3t9ozUWQlUx27VkpH2Jc65AfdoptWtvZUWg3fZ7+6
RTcYjfXdryE1JkEj0csJPGMGO0LW3Eurwf9UOvo4D9FUuGCLZQoKZd9xAoGANZRB
H9iuq68AucCoLF1ZkZOpOWBuGmAePYPRLTUEafXtvEoPGgSgCsfn4Qaut/wm9LuT
sVkxkuK8AyfBx1BEgAHQ/glenJomSaQ3PcsP5K+0DKtNeDVspheghtg0yE0Swo4i
8FWTIG+7jBj5HxqU/DZHniR/mcxIWlfrRKl3fdcCgYEAzNhKUDqINaWQWLMbXExi
TXtRZ5/oej6co2z4qYSFe8LWIxO/O3Vp6Qnv0630SsmL4h6SvyP2lGN2KCjI4ttG
iQTsRHuzUJruHkqdqvKMFEiF23gGBCGRlA2JFqVL8EQqbARtGBpxzucNUcwgnqE6
4OU0yAL3FkpCm4eqcqPNG+s=
-----END PRIVATE KEY-----
`;

export const TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIUcM5d9BfOQL/eVSHKNdpiWTMS3X0wDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQc25zLnRlc3QuZXhhbXBsZTAgFw0yNjEwMjMwNzIxNDda
GA8yMTI2MDkyOTA3MjE0N1owGzEZMBcGA1UEAwwQc25zLnRlc3QuZXhhbXBsZTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAOlvl19Pmg5yU8nDUbSTg+VX
mD9dI8XU51Asm+mQlaPXIlMf6f2f1cMjvCv5PDmdPqWhgmAukrFcmeINnxAVtML0
nwetDgh53ahQy2N5emkzdN1kN/qEdzTsLraIKmKebDr0Gbrlb4qaZnfh4MfMW/Gc
Rzo7OSVYdu9O1oxYmWBCxVIVaZImNGuAdy6hPIMWQx+lBTk44I7diRbbMBxRcazE
fxtpLS54E7izF1aNR0I7xnGlidZO5vY6MfzslYwSYRJ6KJaiy8/Qvlyq1lH+SuTX
GHk1vJSd56hKbYbkxL/rbdW7TqfgGZb/BNZgtEoCsGqMgWT7Rkxxfw/DEY/vg2sC
AwEAAaNTMFEwHQYDVR0OBBYEFBXLChMKC/qSM947sXpFn9g6iq7zMB8GA1UdIwQY
MBaAFBXLChMKC/qSM947sXpFn9g6iq7zMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAMizqiSqfyX4AsZY1+DHyp76ZEGJ60dcqMZC4qvxDt6BI3ZM
aaAhckduoZF7y0d27GOcEWJJJE46vIZO9crfdQI6bu7o27D+sRkSCjUsbgId7BU0
dfMPS5zzIQydi3AOJIDX22T+llDzhqThQ8+JgKtlzsV3z7cpb5OOlXRVeD0GPmRZ
TYaPYV9rOoa0KRPxlUUQ8GjeNicj3TiS32J4+N/ka+OwnujuMEERxUeVoWRQdE8Y
aUdhwA1337T87ha44+xqXrJ0EzdtKtvkPkMDDoI+DgaaCAiUKTD6wIZ6Xbas6Arh
rm19MbmOQJ7wqIY6862hUAOYh82s6+sJdtQGMdI=
-----END CERTIFICATE-----
`;

export const CERT_URL = 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-test.pem';
export const TOPIC_ARN = 'arn:aws:sns:ap-south-1:123456789012:ses-events';

const NOTIFICATION_FIELDS = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const;
const CONFIRMATION_FIELDS = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const;

/** Builds an SNS message signed the way AWS signs them. */
export function signedSnsMessage(
    overrides: Record<string, string | undefined> = {},
    version: '1' | '2' = '2',
): Record<string, string> {
    const message: Record<string, string | undefined> = {
        Type: 'Notification',
        MessageId: '22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324',
        TopicArn: TOPIC_ARN,
        Message: '{}',
        Timestamp: '2026-10-23T08:00:00.000Z',
        SignatureVersion: version,
        SigningCertURL: CERT_URL,
        ...overrides,
    };
    const fields = message.Type === 'Notification' ? NOTIFICATION_FIELDS : CONFIRMATION_FIELDS;
    const text = fields
        .filter((field) => message[field] !== undefined)
        .map((field) => `${field}\n${message[field]}\n`)
        .join('');
    const signature = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256').update(text, 'utf8').sign(TEST_PRIVATE_KEY, 'base64');
    return Object.fromEntries(Object.entries({ ...message, Signature: signature }).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

/** The JSON SES puts inside a notification for the given kind of event. */
export function sesEvent(kind: string, ref: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        eventType: kind,
        mail: {
            timestamp: '2026-10-23T08:00:00.000Z',
            messageId: '0100019abc-test',
            tags: { mailRef: [ref], 'ses:source-ip': ['203.0.113.7'] },
        },
        ...extra,
    });
}
