import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth on top of SameSite cookies: a browser always sends Origin on a
 * state-changing request, so one from an unknown site is refused. Requests with no
 * Origin (curl, server-to-server, health checks) are not browser sessions and pass.
 */
export function originCheck(allowedOrigins: string[]) {
    const allowed = new Set(allowedOrigins);
    return (req: Request, res: Response, next: NextFunction): void => {
        if (SAFE_METHODS.has(req.method)) return next();
        const origin = req.headers.origin;
        if (origin === undefined || allowed.has(origin)) return next();
        res.status(403).json({
            statusCode: 403,
            code: 'ORIGIN_NOT_ALLOWED',
            message: 'Request origin is not allowed',
        });
    };
}
