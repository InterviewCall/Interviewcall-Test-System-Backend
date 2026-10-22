import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@app/prisma';

export const ROLES_KEY = 'auth:roles';

/** Restricts a route (or controller) to the listed roles. No decorator = any signed-in user. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
