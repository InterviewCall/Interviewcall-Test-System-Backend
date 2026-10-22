import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    ParseIntPipe,
    Post,
    Req,
    Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AllowUnactivated } from '../common/decorators/allow-unactivated.decorator.js';
import { CurrentSessionId, CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { clientIp, clientUserAgent } from '../common/http/authenticated-request.js';
import type { AuthUser } from '../common/types/authenticated-request.types.js';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import { ApiZodBody, ApiZodResponse } from '../common/zod/zod-swagger.js';
import { APP_CONFIG } from '../config/app.config.js';
import type { AppConfig } from '../config/types/app-config.types.js';
import { toUserResponse } from '../users/user-response.js';
import type { UserResponse } from '../users/types/user.types.js';
import { userResponseSchema } from '../users/users.schemas.js';
import { AuthService } from './auth.service.js';
import { changePasswordSchema, loginSchema, sessionResponseSchema } from './auth.schemas.js';
import type { ChangePasswordInput, LoginInput } from './types/auth-input.types.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly auth: AuthService,
        @Inject(APP_CONFIG) private readonly config: AppConfig,
    ) {}

    @Public()
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Sign in with email and password; sets the session cookie' })
    @ApiZodBody(loginSchema)
    @ApiZodResponse(200, userResponseSchema)
    async login(
        @Body(new ZodValidationPipe(loginSchema)) dto: LoginInput,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<UserResponse> {
        const { user, session } = await this.auth.login(dto.email, dto.password, {
            ip: clientIp(req),
            userAgent: clientUserAgent(req),
        });
        setSessionCookie(res, this.config, session.token, session.cookieExpiresAt);
        return toUserResponse(user);
    }

    @Public()
    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Revoke the current session and clear the cookie' })
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
        const token: unknown = req.cookies?.[this.config.cookie.name];
        await this.auth.logout(typeof token === 'string' ? token : undefined);
        clearSessionCookie(res, this.config);
    }

    @AllowUnactivated()
    @Get('me')
    @ApiCookieAuth()
    @ApiOperation({ summary: 'The signed-in user. status UNACTIVATED means a password change is required.' })
    @ApiZodResponse(200, userResponseSchema)
    me(@CurrentUser() user: AuthUser): UserResponse {
        return toUserResponse(user);
    }

    @AllowUnactivated()
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @Post('change-password')
    @HttpCode(HttpStatus.OK)
    @ApiCookieAuth()
    @ApiOperation({ summary: 'Set a new password; activates the account and signs out every other session' })
    @ApiZodBody(changePasswordSchema)
    @ApiZodResponse(200, userResponseSchema)
    async changePassword(
        @CurrentUser() user: AuthUser,
        @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordInput,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<UserResponse> {
        const result = await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, {
            ip: clientIp(req),
            userAgent: clientUserAgent(req),
        });
        setSessionCookie(res, this.config, result.session.token, result.session.cookieExpiresAt);
        return toUserResponse(result.user);
    }

    @Get('sessions')
    @ApiCookieAuth()
    @ApiOperation({ summary: 'Your active sessions' })
    @ApiZodResponse(200, z.array(sessionResponseSchema))
    sessions(@CurrentUser() user: AuthUser, @CurrentSessionId() sessionId: number) {
        return this.auth.listSessions(user.id, sessionId);
    }

    @Delete('sessions/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiCookieAuth()
    @ApiOperation({ summary: 'Sign out one of your sessions' })
    async revokeSession(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.auth.revokeSession(user.id, id);
    }
}
