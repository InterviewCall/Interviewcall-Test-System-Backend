import 'dotenv/config';

import bcrypt from 'bcrypt';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { UserStatus, UserType } from '../src/generated/prisma/enums.js';

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
    const saltRounds = Number(process.env.SALT_ROUNDS ?? 10);

    if (!Number.isInteger(saltRounds) || saltRounds < 10 || saltRounds > 15) {
        throw new Error(
            `SALT_ROUNDS must be an integer between 10 and 15, got: ${process.env.SALT_ROUNDS}`,
        );
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
        // The account is already there. Its profile fields are refreshed from the
        // environment, but passwordHash is deliberately left alone so that re-running
        // the seed can never silently reset a password that was rotated since.
        const updated = await prisma.user.update({
            where: { email },
            data: {
                fullName,
                phone,
                userType: UserType.ADMIN,
                status: UserStatus.ACTIVE,
            },
        });

        console.log(
            `Admin already present, profile refreshed (password untouched): ${updated.email} [id=${updated.id}]`,
        );
        return;
    }

    const passwordHash = await bcrypt.hash(password, saltRounds);

    const created = await prisma.user.create({
        data: {
            fullName,
            email,
            phone,
            passwordHash,
            userType: UserType.ADMIN,
            status: UserStatus.ACTIVE,
        },
    });

    console.log(`Admin created: ${created.email} [id=${created.id}]`);
}

async function main(): Promise<void> {
    const prisma = createClient();

    try {
        await seedAdmin(prisma);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
});
