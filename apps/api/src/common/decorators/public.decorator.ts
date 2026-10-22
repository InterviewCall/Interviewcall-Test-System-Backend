import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Skips the staff session check. Candidate routes use this plus their own guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
