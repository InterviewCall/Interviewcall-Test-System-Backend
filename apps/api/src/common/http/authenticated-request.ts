import type { Request } from 'express';
import type { AuthContext, AuthenticatedRequest } from '../types/authenticated-request.types.js';

export function getAuth(req: AuthenticatedRequest): AuthContext {
    if (!req.auth) {
        // Only reachable if a route skipped the AuthGuard but asked for the user.
        throw new Error('No authenticated user on this request');
    }
    return req.auth;
}

export function clientIp(req: Request): string | null {
    return req.ip ?? null;
}

export function clientUserAgent(req: Request): string | null {
    const value = req.headers['user-agent'];
    return typeof value === 'string' ? value.slice(0, 255) : null;
}
