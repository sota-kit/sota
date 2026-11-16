import type { RuntimeMiddleware } from './middleware.ts';
import type {
  EngineSPI,
  GuardSPI,
  MemorySPI,
  ModelSPI,
  ToolSPI,
  TraceSPI,
} from './spi/index.ts';

/**
 * Strongly-typed capability identifier. Any external package can define new
 * capability tokens without modifying @sota/core.
 */
export interface CapabilityToken<T> {
  readonly id: string;
  /** Phantom type marker for TypeScript inference; never present at runtime. */
  readonly __type?: T;
}

/** Define a new capability token for use with PluginRegistry. */
export function defineCapability<T>(id: string): CapabilityToken<T> {
  return { id };
}

// Built-in standard capability tokens for cross-plugin interoperability.
export const ModelCapability = defineCapability<ModelSPI>('sota.model');
export const EngineCapability = defineCapability<EngineSPI>('sota.engine');
export const ToolCapability = defineCapability<ToolSPI>('sota.tool');
export const MemoryCapability = defineCapability<MemorySPI>('sota.memory');
export const GuardCapability = defineCapability<GuardSPI>('sota.guard');
export const MiddlewareCapability = defineCapability<RuntimeMiddleware>('sota.middleware');
export const TraceCapability = defineCapability<TraceSPI>('sota.trace');
