import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

// @nestjs/swagger does not export its schema type; the JSON Schema Zod emits is what it expects.
type SchemaObject = NonNullable<Parameters<typeof ApiBody>[0]> extends { schema: infer S } ? S : never;
type PropertyMap = Record<string, SchemaObject>;

/** The OpenAPI 3.0 form of a Zod schema, used only for the generated docs. */
export function toOpenApi(schema: z.ZodType, io: 'input' | 'output'): SchemaObject {
    const { $schema: _omit, ...rest } = z.toJSONSchema(schema, {
        target: 'openapi-3.0',
        io,
        unrepresentable: 'any',
    }) as Record<string, unknown>;
    return rest as SchemaObject;
}

export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: toOpenApi(schema, 'input') });

export const ApiZodResponse = (status: number, schema: z.ZodType, description?: string) =>
    ApiResponse({ status, description, schema: toOpenApi(schema, 'output') });

/** One ApiQuery per field of a Zod object, so Swagger shows them as separate parameters. */
export function ApiZodQuery(schema: z.ZodObject) {
    const json = toOpenApi(schema, 'input');
    const required = new Set((json as { required?: string[] }).required ?? []);
    return applyDecorators(
        ...Object.entries(((json as { properties?: PropertyMap }).properties ?? {})).map(([name, property]) =>
            ApiQuery({ name, required: required.has(name), schema: property }),
        ),
    );
}
