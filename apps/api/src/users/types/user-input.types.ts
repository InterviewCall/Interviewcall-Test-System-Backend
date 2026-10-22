import type { z } from 'zod';
import type { createUserSchema, listUsersQuerySchema, updateUserSchema } from '../users.schemas.js';

export type CreateUserInput = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.output<typeof updateUserSchema>;
export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;
