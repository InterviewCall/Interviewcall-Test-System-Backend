import { Module } from '@nestjs/common';
import { z } from 'zod';
import type { NotificationsConfig } from '../types/notifications-config.types.js';

export const NOTIFICATIONS_CONFIG = Symbol('NOTIFICATIONS_CONFIG');

type Env = Record<string, string | undefined>;

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z
    .object({
        NODE_ENV: z.string().default('development'),

        REDIS_HOST: z.string().default('localhost'),
        REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
        REDIS_USERNAME: z.string().optional(),
        REDIS_PASSWORD: z.string().optional(),
        REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
        REDIS_TLS: flag.default(false),
        NOTIFICATIONS_QUEUE_PREFIX: z.string().min(1).default('ic-entrance'),
        NOTIFICATIONS_PAYLOAD_KEY: z
            .string({ error: 'is required. Generate one with: openssl rand -base64 32' })
            .refine((value) => Buffer.from(value, 'base64').length === 32, {
                error: 'must be 32 random bytes, base64 encoded. Generate one with: openssl rand -base64 32',
            }),

        APP_NAME: z.string().min(1).default('InterviewCall'),
        STAFF_CONSOLE_URL: z.url().default('http://localhost:3000'),

        MAIL_DRIVER: z.enum(['ses', 'console']).optional(),
        MAIL_FROM_ACCOUNTS: z.string().min(3).optional(),
        MAIL_FROM_CANDIDATES: z.string().min(3).optional(),
        MAIL_REPLY_TO: z.string().min(3).optional(),
        AWS_REGION: z.string().min(1).optional(),
        SES_CONFIGURATION_SET: z.string().min(1).optional(),

        WHATSAPP_DRIVER: z.enum(['aisensy', 'console']).optional(),
        AISENSY_API_KEY: z.string().min(1).optional(),
        AISENSY_API_URL: z.url().default('https://backend.aisensy.com/campaign/t1/api'),
        AISENSY_SOURCE: z.string().min(1).default('InterviewCall entrance test'),
        DEFAULT_PHONE_COUNTRY_CODE: z.string().regex(/^[1-9][0-9]{0,2}$/, 'must be digits only, e.g. 91').default('91'),
    })
    .superRefine((env, ctx) => {
        const production = env.NODE_ENV === 'production';
        const mailDriver = env.MAIL_DRIVER ?? (production ? 'ses' : 'console');
        const whatsappDriver = env.WHATSAPP_DRIVER ?? (production ? 'aisensy' : 'console');

        const need = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

        if (mailDriver === 'ses') {
            if (!env.MAIL_FROM_ACCOUNTS) need('MAIL_FROM_ACCOUNTS', 'is required when MAIL_DRIVER=ses');
            if (!env.MAIL_FROM_CANDIDATES) need('MAIL_FROM_CANDIDATES', 'is required when MAIL_DRIVER=ses');
            if (!env.AWS_REGION) need('AWS_REGION', 'is required when MAIL_DRIVER=ses');
        }
        if (whatsappDriver === 'aisensy' && !env.AISENSY_API_KEY) {
            need('AISENSY_API_KEY', 'is required when WHATSAPP_DRIVER=aisensy');
        }
        // The console drivers print whole messages, temporary passwords included.
        if (production && mailDriver === 'console') need('MAIL_DRIVER', 'cannot be "console" in production');
        if (production && whatsappDriver === 'console') need('WHATSAPP_DRIVER', 'cannot be "console" in production');
    });

/** Reads and checks every notifications setting at once, so a bad .env fails at startup. */
export function loadNotificationsConfig(env: Env = process.env): NotificationsConfig {
    // An empty value in .env means "not set".
    const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));

    const parsed = envSchema.safeParse(present);
    if (!parsed.success) {
        const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
        throw new Error(`Invalid notifications configuration:\n${problems.join('\n')}`);
    }

    const e = parsed.data;
    const production = e.NODE_ENV === 'production';
    return {
        redis: {
            host: e.REDIS_HOST,
            port: e.REDIS_PORT,
            username: e.REDIS_USERNAME,
            password: e.REDIS_PASSWORD,
            db: e.REDIS_DB,
            tls: e.REDIS_TLS,
        },
        queuePrefix: e.NOTIFICATIONS_QUEUE_PREFIX,
        payloadKey: Buffer.from(e.NOTIFICATIONS_PAYLOAD_KEY, 'base64'),
        appName: e.APP_NAME,
        staffConsoleUrl: e.STAFF_CONSOLE_URL.replace(/\/+$/, ''),
        mail: {
            driver: e.MAIL_DRIVER ?? (production ? 'ses' : 'console'),
            from: { accounts: e.MAIL_FROM_ACCOUNTS, candidates: e.MAIL_FROM_CANDIDATES },
            replyTo: e.MAIL_REPLY_TO,
            region: e.AWS_REGION,
            configurationSet: e.SES_CONFIGURATION_SET,
        },
        whatsapp: {
            driver: e.WHATSAPP_DRIVER ?? (production ? 'aisensy' : 'console'),
            apiKey: e.AISENSY_API_KEY,
            apiUrl: e.AISENSY_API_URL,
            source: e.AISENSY_SOURCE,
            defaultCountryCode: e.DEFAULT_PHONE_COUNTRY_CODE,
        },
    };
}

/** Provides the checked config to everything in this library. */
@Module({
    providers: [{ provide: NOTIFICATIONS_CONFIG, useFactory: () => loadNotificationsConfig() }],
    exports: [NOTIFICATIONS_CONFIG],
})
export class NotificationsConfigModule {}
