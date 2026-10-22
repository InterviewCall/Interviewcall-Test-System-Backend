/**
 * Turns a phone number as people type it into E.164 ("+917044610338"), or null when it
 * can't be a real number. Numbers without a country code get `defaultCountryCode`.
 */
export function normalizePhone(raw: string, defaultCountryCode: string): string | null {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;

    let e164: string;
    if (trimmed.startsWith('+')) {
        e164 = digits;
    } else if (trimmed.startsWith('00')) {
        e164 = digits.slice(2);
    } else if (digits.length === 10) {
        e164 = defaultCountryCode + digits;
    } else if (digits.startsWith(defaultCountryCode) && digits.length === defaultCountryCode.length + 10) {
        e164 = digits;
    } else {
        return null;
    }

    // E.164 allows at most 15 digits; nothing real is shorter than 8.
    if (e164.length < 8 || e164.length > 15 || e164.startsWith('0')) return null;
    return `+${e164}`;
}

/** "arijit@x.com" -> "a***@x.com", for logs. */
export function maskEmail(email: string): string {
    const at = email.lastIndexOf('@');
    if (at < 1) return '***';
    return `${email[0]}***${email.slice(at)}`;
}

/** "+917044610338" -> "+91*****0338", for logs. */
export function maskPhone(phone: string): string {
    return phone.length <= 6 ? '***' : `${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`;
}
