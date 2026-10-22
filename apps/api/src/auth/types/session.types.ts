import type { UserRecord } from '../../users/types/user.types.js';

export interface NewSession {
    userId: number;
    tokenHash: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date;
}

export interface SessionWithUser {
    id: number;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    user: UserRecord;
}

export interface ActiveSessionRow {
    id: number;
    ip: string | null;
    userAgent: string | null;
    createdAt: Date;
    lastSeenAt: Date;
}

/** Where a sign-in came from, stored on the session. */
export interface SessionMeta {
    ip: string | null;
    userAgent: string | null;
}

export interface CreatedSession {
    token: string;
    expiresAt: Date;
    /** When the cookie should die: the absolute cap, not the sliding idle deadline. */
    cookieExpiresAt: Date;
}

export interface ValidSession {
    sessionId: number;
    user: UserRecord;
}
