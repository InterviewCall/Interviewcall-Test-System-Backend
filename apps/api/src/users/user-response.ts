import type { AuthUser } from '../common/types/authenticated-request.types.js';
import type { UserResponse } from './types/user.types.js';

/** The public shape of a user: never includes the password hash. */
export function toUserResponse(user: AuthUser): UserResponse {
    return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
    };
}
