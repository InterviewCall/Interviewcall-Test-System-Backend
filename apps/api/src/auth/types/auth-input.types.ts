import type { z } from 'zod';
import type { changePasswordSchema, loginSchema } from '../auth.schemas.js';

export type LoginInput = z.output<typeof loginSchema>;
export type ChangePasswordInput = z.output<typeof changePasswordSchema>;
