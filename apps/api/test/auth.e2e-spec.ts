import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import argon2 from 'argon2';
import request from 'supertest';
import { ModelService } from '@app/model';
import { UserRole, UserStatus } from '@app/prisma';
import { ApiModule } from '../src/api.module.js';
import { configureApp } from '../src/app.setup.js';
import { NotificationsModule } from '@app/notifications';
import { loadConfig } from '../src/config/app.config.js';
import { createFakeModel } from './support/fake-model.js';
import type { FakeModel } from './support/fake-model.js';
import { FakeNotificationsModule, fakeNotifications } from './support/fake-notifications.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'correct horse battery';
const COOKIE = 'ic_staff_session';

let passwordHash: string;

async function seedUser(
    db: FakeModel,
    overrides: Partial<{ email: string; role: UserRole; status: UserStatus }> = {},
) {
    return db.user.create({
        data: {
            fullName: 'Test Person',
            email: overrides.email ?? 'admin@example.com',
            phone: '+91 98765 43210',
            passwordHash,
            role: overrides.role ?? UserRole.ADMIN,
            status: overrides.status ?? UserStatus.ACTIVE,
        },
    });
}

async function buildApp(db: FakeModel, { throttle }: { throttle: boolean }) {
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.COOKIE_SECURE = 'false';
    const builder = Test.createTestingModule({ imports: [ApiModule] })
        .overrideProvider(ModelService)
        .useValue(db)
        .overrideModule(NotificationsModule)
        .useModule(FakeNotificationsModule);
    if (!throttle) builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true });
    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, loadConfig());
    await app.init();
    return app;
}

const api = (path: string) => `/api/v1${path}`;

async function login(app: NestExpressApplication, email: string, password = PASSWORD) {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post(api('/auth/login')).send({ email, password });
    return { agent, res };
}

beforeAll(async () => {
    passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
});

describe('auth and users (no throttling)', () => {
    let app: NestExpressApplication;
    let db: FakeModel;

    beforeEach(async () => {
        fakeNotifications.staffEmails = [];
        fakeNotifications.queueIsUp = true;
        db = createFakeModel();
        app = await buildApp(db, { throttle: false });
    });
    afterEach(() => app.close());

    it('serves /health without a session', async () => {
        await request(app.getHttpServer()).get(api('/health')).expect(200, { status: 'ok' });
    });

    it('rejects protected routes without a session', async () => {
        await request(app.getHttpServer()).get(api('/auth/me')).expect(401);
        await request(app.getHttpServer()).get(api('/users')).expect(401);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
        await seedUser(db);
        const wrong = await login(app, 'admin@example.com', 'nope-nope-nope');
        const unknown = await login(app, 'ghost@example.com');
        expect(wrong.res.status).toBe(401);
        expect(unknown.res.status).toBe(401);
        expect(wrong.res.body.message).toBe(unknown.res.body.message);
    });

    it('signs in, sets an httpOnly cookie, never leaks the hash, and signs out', async () => {
        await seedUser(db);
        const { agent, res } = await login(app, '  ADMIN@Example.com ');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ email: 'admin@example.com', role: 'ADMIN', status: 'ACTIVE' });
        expect(JSON.stringify(res.body)).not.toContain('passwordHash');
        const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
        expect(cookie).toContain(`${COOKIE}=`);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Lax');

        // Only the hash of the token is stored.
        const raw = /ic_staff_session=([^;]+)/.exec(cookie)![1];
        expect(db._sessions[0].tokenHash).toHaveLength(64);
        expect(db._sessions[0].tokenHash).not.toBe(raw);

        await agent.get(api('/auth/me')).expect(200);
        await agent.post(api('/auth/logout')).expect(204);
        await agent.get(api('/auth/me')).expect(401);
        expect(db._sessions[0].revokedAt).toBeInstanceOf(Date);
    });

    it('refuses a deactivated account with the generic message', async () => {
        await seedUser(db, { status: UserStatus.INACTIVE });
        const { res } = await login(app, 'admin@example.com');
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects expired and idle sessions', async () => {
        await seedUser(db);
        const { agent } = await login(app, 'admin@example.com');
        await agent.get(api('/auth/me')).expect(200);
        db._sessions[0].expiresAt = new Date(Date.now() - 1000);
        await agent.get(api('/auth/me')).expect(401);
    });

    it('enforces the absolute session lifetime even if recently active', async () => {
        await seedUser(db);
        const { agent } = await login(app, 'admin@example.com');
        db._sessions[0].createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        await agent.get(api('/auth/me')).expect(401);
    });

    it('blocks a temporary-password user until they change it, then rotates the session', async () => {
        await seedUser(db, { email: 'new@example.com', role: UserRole.ADVISOR, status: UserStatus.UNACTIVATED });
        const { agent, res } = await login(app, 'new@example.com');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('UNACTIVATED');
        const oldCookie = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

        await agent.get(api('/auth/me')).expect(200);
        const blocked = await agent.get(api('/auth/sessions')).expect(403);
        expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

        await agent
            .post(api('/auth/change-password'))
            .send({ currentPassword: 'wrong-wrong-wrong', newPassword: 'a brand new passphrase' })
            .expect(400);
        await agent
            .post(api('/auth/change-password'))
            .send({ currentPassword: PASSWORD, newPassword: 'short' })
            .expect(400);

        const changed = await agent
            .post(api('/auth/change-password'))
            .send({ currentPassword: PASSWORD, newPassword: 'a brand new passphrase' })
            .expect(200);
        expect(changed.body.status).toBe('ACTIVE');

        await agent.get(api('/auth/sessions')).expect(200);
        // The pre-change cookie is dead.
        await request(app.getHttpServer()).get(api('/auth/me')).set('Cookie', oldCookie).expect(401);
        // Old password no longer works, new one does.
        expect((await login(app, 'new@example.com')).res.status).toBe(401);
        expect((await login(app, 'new@example.com', 'a brand new passphrase')).res.status).toBe(200);
    });

    it('lists and revokes your own sessions only', async () => {
        await seedUser(db);
        await seedUser(db, { email: 'other@example.com', role: UserRole.ADVISOR });
        const first = await login(app, 'admin@example.com');
        const second = await login(app, 'admin@example.com');
        const other = await login(app, 'other@example.com');

        const list = await first.agent.get(api('/auth/sessions')).expect(200);
        expect(list.body).toHaveLength(2);
        expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

        const otherSessionId = db._sessions.find((s) => s.userId === 2)!.id;
        await first.agent.delete(api(`/auth/sessions/${otherSessionId}`)).expect(404);
        await other.agent.get(api('/auth/me')).expect(200);

        const target = list.body.find((s: { current: boolean }) => !s.current);
        await first.agent.delete(api(`/auth/sessions/${target.id}`)).expect(204);
        await second.agent.get(api('/auth/me')).expect(401);
    });

    it('limits user management to admins', async () => {
        await seedUser(db);
        await seedUser(db, { email: 'advisor@example.com', role: UserRole.ADVISOR });
        const advisor = await login(app, 'advisor@example.com');
        await advisor.agent.get(api('/users')).expect(403);
        await advisor.agent
            .post(api('/users'))
            .send({ fullName: 'X Y', email: 'x@example.com', phone: '+91 99999 99999', role: 'ADMIN' })
            .expect(403);

        const admin = await login(app, 'admin@example.com');
        const list = await admin.agent.get(api('/users')).expect(200);
        expect(list.body.total).toBe(2);
        expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    });

    it('lets a manager look at the staff list but change nothing', async () => {
        await seedUser(db);
        const advisorRow = await seedUser(db, { email: 'advisor@example.com', role: UserRole.ADVISOR });
        await seedUser(db, { email: 'manager@example.com', role: UserRole.MANAGER });
        const manager = (await login(app, 'manager@example.com')).agent;

        const list = await manager.get(api('/users')).expect(200);
        expect(list.body.total).toBe(3);
        expect(JSON.stringify(list.body)).not.toContain('passwordHash');

        await manager
            .post(api('/users'))
            .send({ fullName: 'X Y', email: 'x@example.com', phone: '+91 99999 99999', role: 'ADVISOR' })
            .expect(403);
        await manager.get(api(`/users/${advisorRow.id}`)).expect(403);
        await manager.patch(api(`/users/${advisorRow.id}`)).send({ role: 'ADMIN' }).expect(403);
        await manager.post(api(`/users/${advisorRow.id}/deactivate`)).expect(403);
        await manager.post(api(`/users/${advisorRow.id}/reset-password`)).expect(403);
        await manager.post(api(`/users/${advisorRow.id}/reactivate`)).expect(403);
    });

    it('creates users with a one-time temporary password that works once and forces a change', async () => {
        await seedUser(db);
        const admin = await login(app, 'admin@example.com');
        const created = await admin.agent
            .post(api('/users'))
            .send({ fullName: 'Asha Rao', email: 'Asha@Example.com', phone: '+91 98765 11111', role: 'ADVISOR' })
            .expect(201);
        expect(created.body.user).toMatchObject({ email: 'asha@example.com', role: 'ADVISOR', status: 'UNACTIVATED' });
        expect(created.body.temporaryPassword).toHaveLength(16);
        expect(JSON.stringify(created.body)).not.toContain('passwordHash');
        expect(created.body.emailQueued).toBe(true);
        expect(fakeNotifications.staffEmails).toEqual([
            {
                fullName: 'Asha Rao',
                email: 'asha@example.com',
                role: 'ADVISOR',
                temporaryPassword: created.body.temporaryPassword,
                reason: 'created',
            },
        ]);

        await admin.agent
            .post(api('/users'))
            .send({ fullName: 'Dup', email: 'asha@example.com', phone: '+91 98765 11111', role: 'EDITOR' })
            .expect(409);

        const asha = await login(app, 'asha@example.com', created.body.temporaryPassword);
        expect(asha.res.status).toBe(200);
        await asha.agent.get(api('/users')).expect(403);
    });

    it('validates input and rejects unknown fields', async () => {
        await seedUser(db);
        const admin = await login(app, 'admin@example.com');
        await admin.agent
            .post(api('/users'))
            .send({ fullName: 'A', email: 'not-an-email', phone: 'abc', role: 'GOD' })
            .expect(400);
        await admin.agent
            .post(api('/users'))
            .send({ fullName: 'Asha Rao', email: 'a@example.com', phone: '+91 98765 11111', role: 'ADVISOR', status: 'ACTIVE' })
            .expect(400);
        const bad = await admin.agent
            .post(api('/users'))
            .send({ fullName: 'A', email: 'not-an-email', phone: 'abc', role: 'GOD' })
            .expect(400);
        expect(bad.body.code).toBe('VALIDATION_FAILED');
        expect(bad.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['email', 'fullName', 'phone', 'role']);
        const paged = await admin.agent.get(api('/users?page=1&pageSize=5')).expect(200);
        expect(paged.body).toMatchObject({ page: 1, pageSize: 5 });
        await admin.agent.get(api('/users?pageSize=1000')).expect(400);
        await admin.agent.get(api('/users?role=GOD')).expect(400);
        await admin.agent.get(api('/users?nope=1')).expect(400);
        await admin.agent.get(api('/users/abc')).expect(400);
        await admin.agent.get(api('/users/999')).expect(404);
    });

    it('protects the acting admin from locking themselves out', async () => {
        const admin = await seedUser(db);
        const session = await login(app, 'admin@example.com');
        await session.agent.post(api(`/users/${admin.id}/deactivate`)).expect(400);
        await session.agent.patch(api(`/users/${admin.id}`)).send({ role: 'ADVISOR' }).expect(400);
        await session.agent.post(api(`/users/${admin.id}/reset-password`)).expect(400);
        await session.agent.patch(api(`/users/${admin.id}`)).send({ fullName: 'New Name' }).expect(200);
    });

    it('deactivating signs the user out everywhere; reactivating forces a new password change', async () => {
        await seedUser(db);
        const advisorRow = await seedUser(db, { email: 'advisor@example.com', role: UserRole.ADVISOR });
        const admin = await login(app, 'admin@example.com');
        const advisor = await login(app, 'advisor@example.com');
        await advisor.agent.get(api('/auth/me')).expect(200);

        await admin.agent.post(api(`/users/${advisorRow.id}/deactivate`)).expect(200);
        await advisor.agent.get(api('/auth/me')).expect(401);
        expect((await login(app, 'advisor@example.com')).res.status).toBe(401);
        await admin.agent.post(api(`/users/${advisorRow.id}/reset-password`)).expect(400);

        const back = await admin.agent.post(api(`/users/${advisorRow.id}/reactivate`)).expect(200);
        expect(back.body.user.status).toBe('UNACTIVATED');
        expect((await login(app, 'advisor@example.com')).res.status).toBe(401);
        expect((await login(app, 'advisor@example.com', back.body.temporaryPassword)).res.status).toBe(200);
        await admin.agent.post(api(`/users/${advisorRow.id}/reactivate`)).expect(400);
    });

    it('reset-password issues a new temporary password and revokes sessions', async () => {
        await seedUser(db);
        const advisorRow = await seedUser(db, { email: 'advisor@example.com', role: UserRole.ADVISOR });
        const admin = await login(app, 'admin@example.com');
        const advisor = await login(app, 'advisor@example.com');

        const reset = await admin.agent.post(api(`/users/${advisorRow.id}/reset-password`)).expect(200);
        await advisor.agent.get(api('/auth/me')).expect(401);
        expect((await login(app, 'advisor@example.com')).res.status).toBe(401);
        const again = await login(app, 'advisor@example.com', reset.body.temporaryPassword);
        expect(again.res.body.status).toBe('UNACTIVATED');
        expect(reset.body.emailQueued).toBe(true);
        expect(fakeNotifications.staffEmails.at(-1)).toMatchObject({
            email: 'advisor@example.com',
            reason: 'reset',
            temporaryPassword: reset.body.temporaryPassword,
        });
    });

    it('emails reactivated users, and says so when the email could not be queued', async () => {
        await seedUser(db);
        const advisorRow = await seedUser(db, { email: 'advisor@example.com', role: UserRole.ADVISOR });
        const admin = await login(app, 'admin@example.com');
        await admin.agent.post(api(`/users/${advisorRow.id}/deactivate`)).expect(200);

        const back = await admin.agent.post(api(`/users/${advisorRow.id}/reactivate`)).expect(200);
        expect(back.body.emailQueued).toBe(true);
        expect(fakeNotifications.staffEmails.at(-1)).toMatchObject({ reason: 'reactivated' });

        fakeNotifications.queueIsUp = false;
        const reset = await admin.agent.post(api(`/users/${advisorRow.id}/reset-password`)).expect(200);
        expect(reset.body.emailQueued).toBe(false);
        expect(reset.body.temporaryPassword).toHaveLength(16); // the admin can still pass it on
    });

    it('refuses state-changing requests from an unknown origin', async () => {
        await seedUser(db);
        const bad = await request(app.getHttpServer())
            .post(api('/auth/login'))
            .set('Origin', 'https://evil.example')
            .send({ email: 'admin@example.com', password: PASSWORD });
        expect(bad.status).toBe(403);
        expect(bad.body.code).toBe('ORIGIN_NOT_ALLOWED');

        await request(app.getHttpServer())
            .post(api('/auth/login'))
            .set('Origin', ORIGIN)
            .send({ email: 'admin@example.com', password: PASSWORD })
            .expect(200);
    });
});

describe('login throttling', () => {
    it('answers 429 after five attempts in a minute', async () => {
        const db = createFakeModel();
        await seedUser(db);
        const app = await buildApp(db, { throttle: true });
        try {
            for (let i = 0; i < 5; i++) {
                await request(app.getHttpServer())
                    .post(api('/auth/login'))
                    .send({ email: 'admin@example.com', password: 'wrong-wrong-wrong' })
                    .expect(401);
            }
            await request(app.getHttpServer())
                .post(api('/auth/login'))
                .send({ email: 'admin@example.com', password: PASSWORD })
                .expect(429);
        } finally {
            await app.close();
        }
    });
});
