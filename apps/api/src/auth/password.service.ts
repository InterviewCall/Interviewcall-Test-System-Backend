import { randomInt } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

// OWASP's argon2id minimum: 19 MiB, 2 passes, 1 lane. Stored hashes carry their own
// parameters, so raising these later only affects new hashes.
const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
} as const;

// No 0/O, 1/l/I: temporary passwords get read out or copied by hand.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 16;

@Injectable()
export class PasswordService implements OnModuleInit {
    private dummyHash = '';

    async onModuleInit(): Promise<void> {
        // Verified against when the email is unknown, so "no such user" and
        // "wrong password" cost the same time.
        this.dummyHash = await this.hash('not-a-real-password-just-timing');
    }

    hash(plain: string): Promise<string> {
        return argon2.hash(plain, ARGON2_OPTIONS);
    }

    async verify(hash: string, plain: string): Promise<boolean> {
        try {
            return await argon2.verify(hash, plain);
        } catch {
            // Malformed hash (e.g. a leftover non-argon2 value) is simply "no match".
            return false;
        }
    }

    /** Burns the same time as a real check. Always resolves false. */
    async verifyDummy(plain: string): Promise<false> {
        await this.verify(this.dummyHash, plain);
        return false;
    }

    generateTemporaryPassword(): string {
        let out = '';
        for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
            out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
        }
        return out;
    }
}
