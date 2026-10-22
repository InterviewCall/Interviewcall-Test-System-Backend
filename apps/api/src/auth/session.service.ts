import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UserStatus } from '@app/prisma';
import { SessionRepository } from './session.repository.js';
import { APP_CONFIG } from '../config/app.config.js';
import type { AppConfig } from '../config/types/app-config.types.js';
import type { CreatedSession, SessionMeta, ValidSession } from './types/session.types.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

@Injectable()
export class SessionService {
    constructor(
        private readonly sessions: SessionRepository,
        @Inject(APP_CONFIG) private readonly config: AppConfig,
    ) {}

    static hashToken(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    async create(userId: number, meta: SessionMeta, now = new Date()): Promise<CreatedSession> {
        const token = randomBytes(32).toString('base64url');
        const absoluteEnd = this.absoluteEnd(now);
        const expiresAt = this.slidingExpiry(now, absoluteEnd);

        await this.sessions.create({
            userId,
            tokenHash: SessionService.hashToken(token),
            ip: meta.ip,
            userAgent: meta.userAgent,
            createdAt: now,
            expiresAt,
        });

        return { token, expiresAt, cookieExpiresAt: absoluteEnd };
    }

    /** Returns the session's user, or null if the token is unknown, revoked or expired. */
    async validate(token: string, now = new Date()): Promise<ValidSession | null> {
        const session = await this.sessions.findByTokenHash(SessionService.hashToken(token));

        if (!session || session.revokedAt !== null) return null;
        if (session.expiresAt <= now) return null;

        const absoluteEnd = this.absoluteEnd(session.createdAt);
        if (absoluteEnd <= now) return null;

        if (session.user.status === UserStatus.INACTIVE) return null;

        const touchAfter = session.lastSeenAt.getTime() + this.config.session.touchIntervalMinutes * MINUTE;
        if (now.getTime() >= touchAfter) {
            await this.sessions.touch(session.id, now, this.slidingExpiry(now, absoluteEnd));
        }

        return { sessionId: session.id, user: session.user };
    }

    revokeByToken(token: string, now = new Date()): Promise<void> {
        return this.sessions.revokeByTokenHash(SessionService.hashToken(token), now);
    }

    /** Returns false when the session is not this user's, or is already gone. */
    revokeOwn(userId: number, sessionId: number, now = new Date()): Promise<boolean> {
        return this.sessions.revokeOwn(userId, sessionId, now);
    }

    revokeAllForUser(userId: number, now = new Date()): Promise<void> {
        return this.sessions.revokeAllForUser(userId, now);
    }

    listActive(userId: number, now = new Date()) {
        return this.sessions.listActive(userId, now);
    }

    private absoluteEnd(createdAt: Date): Date {
        return new Date(createdAt.getTime() + this.config.session.absoluteDays * DAY);
    }

    private slidingExpiry(from: Date, absoluteEnd: Date): Date {
        const idle = new Date(from.getTime() + this.config.session.idleMinutes * MINUTE);
        return idle < absoluteEnd ? idle : absoluteEnd;
    }
}
