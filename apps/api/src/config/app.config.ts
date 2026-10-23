import { Global, Module } from '@nestjs/common';
import type { AppConfig } from './types/app-config.types.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}, got: ${raw}`);
    }
    return value;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${name} must be "true" or "false", got: ${raw}`);
}

function topicArn(env: Env): string | undefined {
    const raw = env.MAIL_EVENTS_TOPIC_ARN;
    if (raw === undefined || raw === '') return undefined;
    if (!/^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(raw)) {
        throw new Error(`MAIL_EVENTS_TOPIC_ARN must be an SNS topic ARN like arn:aws:sns:ap-south-1:123456789012:ses-events, got: ${raw}`);
    }
    return raw;
}

export function loadConfig(env: Env = process.env): AppConfig {
    const nodeEnv = env.NODE_ENV ?? 'development';
    const isProduction = nodeEnv === 'production';

    const sameSite = env.COOKIE_SAMESITE ?? 'lax';
    if (sameSite !== 'lax' && sameSite !== 'strict') {
        throw new Error(`COOKIE_SAMESITE must be "lax" or "strict", got: ${sameSite}`);
    }

    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean);
    if (isProduction && allowedOrigins.length === 0) {
        throw new Error('ALLOWED_ORIGINS must list the frontend origins in production');
    }

    return {
        nodeEnv,
        isProduction,
        port: int(env, 'PORT', 3000, 1, 65535),
        trustProxyHops: int(env, 'TRUST_PROXY_HOPS', 0, 0, 10),
        allowedOrigins,
        swaggerEnabled: bool(env, 'SWAGGER_ENABLED', !isProduction),
        mailEvents: { topicArn: topicArn(env) },
        cookie: {
            name: env.SESSION_COOKIE_NAME ?? 'ic_staff_session',
            candidateName: env.CANDIDATE_COOKIE_NAME ?? 'ic_candidate_session',
            secure: bool(env, 'COOKIE_SECURE', isProduction),
            sameSite,
            domain: env.COOKIE_DOMAIN || undefined,
        },
        session: {
            idleMinutes: int(env, 'SESSION_IDLE_MINUTES', 480, 5, 60 * 24 * 30),
            absoluteDays: int(env, 'SESSION_ABSOLUTE_DAYS', 7, 1, 90),
            touchIntervalMinutes: int(env, 'SESSION_TOUCH_INTERVAL_MINUTES', 5, 1, 60),
        },
    };
}

@Global()
@Module({
    providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
    exports: [APP_CONFIG],
})
export class AppConfigModule {}
