import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@app/prisma';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.types.js';

/** Runs after AuthGuard. A route with @Roles() needs one of them; without it, any signed-in user passes. */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!required || required.length === 0) return true;

        const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
        if (!req.auth || !required.includes(req.auth.user.role)) {
            throw new ForbiddenException('You do not have access to this resource');
        }
        return true;
    }
}
