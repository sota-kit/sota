import type { CapabilityToken } from './capability.ts';
import type { AgentRuntime } from './runtime.ts';

export type StartHook = (runtime: AgentRuntime) => void | Promise<void>;
export type StopHook = () => void | Promise<void>;

/**
 * Generic capability-based registry. Plugins can provide and resolve both
 * built-in capabilities (Model, Engine, Tool, etc.) and arbitrary user-defined
 * capability tokens without modifying @sota/core.
 */
export class PluginRegistry {
  private readonly capabilities = new Map<string, Map<string, unknown>>();
  private readonly startHooks: StartHook[] = [];
  private readonly stopHooks: StopHook[] = [];

  /** Register a named capability implementation under a CapabilityToken. */
  provide<T>(token: CapabilityToken<T>, key: string, impl: T): this {
    let bucket = this.capabilities.get(token.id);
    if (!bucket) {
      bucket = new Map<string, unknown>();
      this.capabilities.set(token.id, bucket);
    }
    bucket.set(key, impl);
    return this;
  }

  /** Register an unnamed/anonymous capability implementation (auto-keyed). */
  add<T>(token: CapabilityToken<T>, impl: T): this {
    return this.provide(token, crypto.randomUUID(), impl);
  }

  /** Resolve a capability by key, or the first registered one if key is omitted. */
  resolve<T>(token: CapabilityToken<T>, key?: string): T | undefined {
    const bucket = this.capabilities.get(token.id);
    if (!bucket) return undefined;
    if (key !== undefined) {
      return bucket.get(key) as T | undefined;
    }
    const first = bucket.values().next();
    return first.done ? undefined : (first.value as T);
  }

  /** Resolve all registered implementations for a capability token. */
  resolveAll<T>(token: CapabilityToken<T>): T[] {
    const bucket = this.capabilities.get(token.id);
    if (!bucket) return [];
    return Array.from(bucket.values()) as T[];
  }

  /** List all registered keys for a capability token. */
  listKeys<T>(token: CapabilityToken<T>): string[] {
    const bucket = this.capabilities.get(token.id);
    return bucket ? Array.from(bucket.keys()) : [];
  }

  /** Register a lifecycle hook invoked when `runtime.start()` is called. */
  onStart(hook: StartHook): this {
    this.startHooks.push(hook);
    return this;
  }

  /** Register a lifecycle hook invoked when `runtime.stop()` is called. */
  onStop(hook: StopHook): this {
    this.stopHooks.push(hook);
    return this;
  }

  getStartHooks(): StartHook[] {
    return [...this.startHooks];
  }

  getStopHooks(): StopHook[] {
    return [...this.stopHooks];
  }
}

/**
 * Standard contract every external or local Sota plugin must implement.
 */
export interface SotaPlugin<TOptions = Record<string, unknown>> {
  readonly name: string;
  readonly version: string;
  setup(registry: PluginRegistry, options?: TOptions): void | Promise<void>;
}

export type PluginFactory<TOptions = Record<string, unknown>> = (
  options?: TOptions,
) => SotaPlugin<TOptions>;

/** Helper for plugin authors to get full TypeScript type inference. */
export function definePlugin<TOptions = Record<string, unknown>>(
  plugin: SotaPlugin<TOptions>,
): SotaPlugin<TOptions> {
  return plugin;
}
