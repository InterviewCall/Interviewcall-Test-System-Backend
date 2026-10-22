import { z } from 'zod';

/** Spread into a query schema: z.object({ ...paginationShape, q: ... }). */
export const paginationShape = {
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const pageOf = <T extends z.ZodType>(item: T) =>
    z.object({
        items: z.array(item),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int(),
    });
