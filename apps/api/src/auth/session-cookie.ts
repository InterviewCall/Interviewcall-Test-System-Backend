import type { Response } from 'express';
import type { AppConfig } from '../config/types/app-config.types.js';

export function setSessionCookie(res: Response, config: AppConfig, token: string, expires: Date): void {
    res.cookie(config.cookie.name, token, {
        httpOnly: true,
        secure: config.cookie.secure,
        sameSite: config.cookie.sameSite,
        domain: config.cookie.domain,
        path: '/',
        expires,
    });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
    res.clearCookie(config.cookie.name, {
        httpOnly: true,
        secure: config.cookie.secure,
        sameSite: config.cookie.sameSite,
        domain: config.cookie.domain,
        path: '/',
    });
}
