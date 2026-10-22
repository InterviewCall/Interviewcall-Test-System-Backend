import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@app/prisma';
import { ALLOW_UNACTIVATED_KEY } from '../common/decorators/allow-unactivated.decorator.js';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.types.js';
import { APP_CONFIG } from '../config/app.config.js';
import type { AppConfig } from '../config/types/app-config.types.js';
import { SessionService } from './session.service.js';

/** Default-deny: every route needs a valid staff session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly sessions: SessionService,
        @Inject(APP_CONFIG) private readonly config: AppConfig,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const targets = [context.getHandler(), context.getClass()];

        if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

        const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const token: unknown = req.cookies?.[this.config.cookie.name];
        if (typeof token !== 'string' || token === '') {
            throw new UnauthorizedException('Not signed in');
        }

        const session = await this.sessions.validate(token);
        if (!session) throw new UnauthorizedException('Session expired or revoked');

        const allowUnactivated = this.reflector.getAllAndOverride<boolean>(ALLOW_UNACTIVATED_KEY, targets);
        if (session.user.status === UserStatus.UNACTIVATED && !allowUnactivated) {
            throw new ForbiddenException({
                statusCode: 403,
                code: 'PASSWORD_CHANGE_REQUIRED',
                message: 'Change your temporary password before continuing',
            });
        }

        req.auth = { user: session.user, sessionId: session.sessionId };
        return true;
    }
}
