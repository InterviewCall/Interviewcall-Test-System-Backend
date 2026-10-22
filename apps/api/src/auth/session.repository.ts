import { Injectable } from '@nestjs/common';
import { ModelService } from '@app/model';
import { userSelect } from '../users/user.repository.js';
import type { ActiveSessionRow, NewSession, SessionWithUser } from './types/session.types.js';

@Injectable()
export class SessionRepository {
    constructor(private readonly db: ModelService) {}

    async create(data: NewSession): Promise<void> {
        await this.db.session.create({
            data: { ...data, lastSeenAt: data.createdAt },
        });
    }

    findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
        return this.db.session.findUnique({
            where: { tokenHash },
            select: {
                id: true,
                createdAt: true,
                lastSeenAt: true,
                expiresAt: true,
                revokedAt: true,
                user: { select: userSelect },
            },
        });
    }

    async touch(id: number, lastSeenAt: Date, expiresAt: Date): Promise<void> {
        await this.db.session.update({ where: { id }, data: { lastSeenAt, expiresAt } });
    }

    async revokeByTokenHash(tokenHash: string, now: Date): Promise<void> {
        await this.db.session.updateMany({
            where: { tokenHash, revokedAt: null },
            data: { revokedAt: now },
        });
    }

    /** False when the session is not this user's, or is already revoked. */
    async revokeOwn(userId: number, sessionId: number, now: Date): Promise<boolean> {
        const result = await this.db.session.updateMany({
            where: { id: sessionId, userId, revokedAt: null },
            data: { revokedAt: now },
        });
        return result.count > 0;
    }

    async revokeAllForUser(userId: number, now: Date): Promise<void> {
        await this.db.session.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: now },
        });
    }

    listActive(userId: number, now: Date): Promise<ActiveSessionRow[]> {
        return this.db.session.findMany({
            where: { userId, revokedAt: null, expiresAt: { gt: now } },
            orderBy: { lastSeenAt: 'desc' },
            select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
        });
    }
}
