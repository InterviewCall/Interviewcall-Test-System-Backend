import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getAuth } from '../http/authenticated-request.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.types.js';

/** The signed-in staff user, as loaded fresh from the database for this request. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return getAuth(req).user;
});

/** The id of the session row behind this request. */
export const CurrentSessionId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return getAuth(req).sessionId;
});
