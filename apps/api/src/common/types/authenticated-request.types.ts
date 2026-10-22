import type { Request } from 'express';
import type { UserRecord } from '../../users/types/user.types.js';

/** The signed-in staff user for this request, loaded fresh from the database. */
export type AuthUser = UserRecord;

export interface AuthContext {
    user: AuthUser;
    sessionId: number;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };
