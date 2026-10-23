import { createHash, randomBytes } from 'node:crypto';

/** 256 bits of randomness, URL-safe. This is the secret in the candidate's start link. */
export function newSecretToken(): string {
    return randomBytes(32).toString('base64url');
}

/** Only the hash is stored, so a copy of the database cannot be used to open anyone's test. */
export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
