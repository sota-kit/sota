import { z } from 'zod';
import type { RunContext } from '../context.ts';

export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  /** Optional JSON Schema override; if omitted, derived from inputSchema. */
  jsonSchema?: Record<string, unknown>;
}

/**
 * SPI for tools and external protocol connectors (e.g., MCP servers, local functions, HTTP APIs).
 */
export interface ToolSPI {
  readonly id: string;
  listTools(ctx: RunContext): Promise<ToolDefinition[]>;
  execute(name: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown>;
}

/**
 * Minimal, dependency-free Zod-to-JSON-Schema converter for common object/primitive schemas.
 * Complex custom schemas can provide `ToolDefinition.jsonSchema` directly.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, field] of Object.entries(shape)) {
      const isOptional = field instanceof z.ZodOptional || field instanceof z.ZodDefault;
      if (!isOptional) {
        required.push(key);
      }
      properties[key] = zodToJsonSchema(field);
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodString) {
    return { type: 'string', ...(schema.description ? { description: schema.description } : {}) };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number', ...(schema.description ? { description: schema.description } : {}) };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', ...(schema.description ? { description: schema.description } : {}) };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options };
  }

  return { type: 'object' };
}
