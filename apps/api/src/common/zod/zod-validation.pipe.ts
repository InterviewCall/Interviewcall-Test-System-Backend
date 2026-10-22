import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates and parses a body, query or param with a Zod schema:
 *   @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserInput
 * The handler receives the parsed value (trimmed, lower-cased, coerced, defaults applied).
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
    constructor(private readonly schema: T) {}

    transform(value: unknown): z.output<T> {
        const result = this.schema.safeParse(value);
        if (result.success) return result.data;

        throw new BadRequestException({
            statusCode: 400,
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            errors: result.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }
}
