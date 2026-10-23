import 'dotenv/config';

import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { UserStatus, UserRole } from '../src/generated/prisma/enums.js';
import { describeResult, seedProblems } from './seeds/problems/seed-problems.js';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function createClient(): PrismaClient {
    const adapter = new PrismaMariaDb({
        host: requireEnv('DB_HOST'),
        port: Number(process.env.DB_PORT ?? 3306),
        user: requireEnv('DB_USER'),
        password: requireEnv('DB_PASSWORD'),
        database: requireEnv('DB_NAME'),
        connectionLimit: 2,
        connectTimeout: 5000,
    });

    return new PrismaClient({ adapter });
}

async function seedAdmin(prisma: PrismaClient): Promise<void> {
    const email = requireEnv('SEED_ADMIN_EMAIL').trim().toLowerCase();
    const fullName = requireEnv('SEED_ADMIN_FULL_NAME').trim();
    const phone = requireEnv('SEED_ADMIN_PHONE').trim();
    const password = requireEnv('SEED_ADMIN_PASSWORD');

    if (password.length < 10 || password.length > 128) {
        throw new Error('SEED_ADMIN_PASSWORD must be between 10 and 128 characters');
    }

    // Same parameters as PasswordService in apps/api, so the admin signs in like anyone else.
    const hashPassword = () =>
        argon2.hash(password, {
            type: argon2.argon2id,
            memoryCost: 19_456,
            timeCost: 2,
            parallelism: 1,
        });

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
        // The account is already there. Its profile fields are refreshed from the
        // environment, but a password that was rotated since is never overwritten.
        // The one exception is a pre-argon2 (bcrypt) hash, which the API can no longer
        // verify: that one is replaced with SEED_ADMIN_PASSWORD so the admin can sign in.
        const legacyHash = !existing.passwordHash.startsWith('$argon2');

        const updated = await prisma.user.update({
            where: { email },
            data: {
                fullName,
                phone,
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE,
                ...(legacyHash && { passwordHash: await hashPassword() }),
            },
        });

        console.log(
            `Admin already present, profile refreshed (${
                legacyHash ? 'legacy password hash replaced with SEED_ADMIN_PASSWORD' : 'password untouched'
            }): ${updated.email} [id=${updated.id}]`,
        );
        return;
    }

    const passwordHash = await hashPassword();

    const created = await prisma.user.create({
        data: {
            fullName,
            email,
            phone,
            passwordHash,
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
        },
    });

    console.log(`Admin created: ${created.email} [id=${created.id}]`);
}

async function main(): Promise<void> {
    const prisma = createClient();

    try {
        await seedAdmin(prisma);

        // The old question bank. interviewcall.problems.json sits in the backend's root folder.
        const problemsFile =
            process.env.PROBLEMS_JSON_PATH ?? fileURLToPath(new URL('../../../interviewcall.problems.json', import.meta.url));
        console.log(describeResult(await seedProblems(prisma, problemsFile)));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
});
