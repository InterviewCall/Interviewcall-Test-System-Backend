import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { NOTIFICATIONS_CONFIG } from '../config/notifications.config.js';
import type { NotificationsConfig } from '../types/notifications-config.types.js';

const VERSION = 'v1';
const AAD = Buffer.from('ic-notifications');

/**
 * Seals a small JSON object with AES-256-GCM. Used for values that must reach the worker
 * but should never be readable from Redis, a queue dashboard or a backup (temporary passwords).
 * The key lives only in the environment of the API and the worker.
 */
@Injectable()
export class PayloadCipher {
    private readonly key: Buffer;

    constructor(@Inject(NOTIFICATIONS_CONFIG) config: NotificationsConfig) {
        this.key = config.payloadKey;
    }

    /** Returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
    encrypt(values: Record<string, string>): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(AAD);
        const body = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
        return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
    }

    /** Throws if the token was tampered with or sealed under a different key. */
    decrypt(token: string): Record<string, string> {
        const [version, iv, tag, body] = token.split('.');
        if (version !== VERSION || !iv || !tag || !body) throw new Error('Unreadable secure payload');

        const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
        decipher.setAAD(AAD);
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        const json = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
        return JSON.parse(json.toString('utf8')) as Record<string, string>;
    }
}
