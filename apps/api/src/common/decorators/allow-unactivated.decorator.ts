import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNACTIVATED_KEY = 'auth:allowUnactivated';

/**
 * A user who still holds a temporary password may only call routes marked with
 * this (me, logout, change-password). Everything else answers 403
 * PASSWORD_CHANGE_REQUIRED.
 */
export const AllowUnactivated = () => SetMetadata(ALLOW_UNACTIVATED_KEY, true);
