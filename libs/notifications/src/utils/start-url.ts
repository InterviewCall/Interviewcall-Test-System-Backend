/**
 * The address a candidate opens to start their test: the portal, then `/t/`, then the secret.
 * One definition, so the emailed link and a link staff copy from the console can never differ.
 */
export function testStartUrl(testPortalUrl: string, inviteToken: string): string {
    return `${testPortalUrl.replace(/\/+$/, '')}/t/${encodeURIComponent(inviteToken)}`;
}
