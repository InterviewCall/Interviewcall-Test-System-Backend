import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import argon2 from 'argon2';
import request from 'supertest';
import { ModelService } from '@app/model';
import { NotificationsModule } from '@app/notifications';
import { UserRole, UserStatus } from '@app/prisma';
import { ApiModule } from '../../src/api.module.js';
import { SNS_FETCH } from '../../src/mail-events/sns-verifier.js';
import type { SnsFetch } from '../../src/mail-events/sns-verifier.js';
import { configureApp } from '../../src/app.setup.js';
import { loadConfig } from '../../src/config/app.config.js';
import { createFakeModel } from './fake-model.js';
import type { FakeModel } from './fake-model.js';
import { FakeNotificationsModule } from './fake-notifications.js';

export const ORIGIN = 'http://localhost:3100';
export const PASSWORD = 'correct horse battery';
export const api = (path: string) => `/api/v1${path}`;

let passwordHash: string | undefined;

/** Adds a staff user straight to the fake database. */
export async function seedStaff(
    db: FakeModel,
    overrides: Partial<{ email: string; fullName: string; role: UserRole; status: UserStatus }> = {},
) {
    passwordHash ??= await argon2.hash(PASSWORD, { type: argon2.argon2id });
    return db.user.create({
        data: {
            fullName: overrides.fullName ?? 'Test Person',
            email: overrides.email ?? 'admin@example.com',
            phone: '+91 98765 43210',
            passwordHash,
            role: overrides.role ?? UserRole.ADMIN,
            status: overrides.status ?? UserStatus.ACTIVE,
        },
    });
}

/** The real API with the fake database and the fake notification queue. */
export async function buildApp(
    db: FakeModel,
    options: { mailEventsTopicArn?: string; fetchText?: SnsFetch } = {},
): Promise<NestExpressApplication> {
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.COOKIE_SECURE = 'false';
    if (options.mailEventsTopicArn) process.env.MAIL_EVENTS_TOPIC_ARN = options.mailEventsTopicArn;
    else delete process.env.MAIL_EVENTS_TOPIC_ARN;
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
        .overrideProvider(SNS_FETCH)
        .useValue(options.fetchText ?? (async () => Promise.reject(new Error('the test did not expect a network call'))))
        .overrideProvider(ModelService)
        .useValue(db)
        .overrideModule(NotificationsModule)
        .useModule(FakeNotificationsModule)
        .overrideGuard(ThrottlerGuard)
        .useValue({ canActivate: () => true })
        .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, loadConfig());
    await app.init();
    return app;
}

/** Signs in and returns an agent that carries the session cookie. */
export async function signIn(app: NestExpressApplication, email: string) {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post(api('/auth/login')).send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`sign-in as ${email} failed with ${res.status}`);
    return agent;
}

export { createFakeModel };
export type { FakeModel };
