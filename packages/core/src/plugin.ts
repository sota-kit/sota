import type { CapabilityToken } from './capability.ts';
import type { AgentRuntime } from './runtime.ts';

export type StartHook = (runtime: AgentRuntime) => void | Promise<void>;
export type StopHook = () => void | Promise<void>;
export type DisposeHook = () => void | Promise<void>;

export interface MountedPlugin {
  readonly name: string;
  readonly version: string;
  dispose(): Promise<void>;
}

/**
 * Generic capability-based registry supporting hierarchical scoping (`createScope`)
 * and reversible plugin mounting (`mount` + `dispose`).
 */
export class PluginRegistry {
  private readonly parent?: PluginRegistry;
  private readonly capabilities = new Map<string, Map<string, unknown>>();
  private readonly startHooks: StartHook[] = [];
  private readonly stopHooks: StopHook[] = [];
  private readonly mountedPlugins = new Map<string, MountedPlugin>();

  constructor(parent?: PluginRegistry) {
    this.parent = parent;
  }

  /** Create an isolated child registry that inherits capabilities from this parent. */
  createScope(): PluginRegistry {
    return new PluginRegistry(this);
  }

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

  /** Remove a specific capability key from this registry scope. */
  remove<T>(token: CapabilityToken<T>, key: string): boolean {
    const bucket = this.capabilities.get(token.id);
    if (!bucket) return false;
    return bucket.delete(key);
  }

  /** Resolve a capability by key (child scope overrides parent), or first registered. */
  resolve<T>(token: CapabilityToken<T>, key?: string): T | undefined {
    const bucket = this.capabilities.get(token.id);
    if (key !== undefined) {
      if (bucket?.has(key)) {
        return bucket.get(key) as T;
      }
      return this.parent?.resolve(token, key);
    }
    if (bucket && bucket.size > 0) {
      const first = bucket.values().next();
      if (!first.done) return first.value as T;
    }
    return this.parent?.resolve(token);
  }

  /** Resolve all registered implementations across parent and current scope. */
  resolveAll<T>(token: CapabilityToken<T>): T[] {
    const parentItems = this.parent ? this.parent.resolveAll(token) : [];
    const bucket = this.capabilities.get(token.id);
    const ownItems = bucket ? (Array.from(bucket.values()) as T[]) : [];
    return [...parentItems, ...ownItems];
  }

  /** List all unique registered keys across parent and current scope. */
  listKeys<T>(token: CapabilityToken<T>): string[] {
    const keys = new Set<string>(this.parent ? this.parent.listKeys(token) : []);
    const bucket = this.capabilities.get(token.id);
    if (bucket) {
      for (const k of bucket.keys()) keys.add(k);
    }
    return Array.from(keys);
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

  /**
   * Register a cleanup callback for the currently mounting plugin.
   * Outside `mount()`, this is a no-op unless overridden by a scoped proxy.
   */
  onDispose(_hook: DisposeHook): this {
    return this;
  }

  getStartHooks(): StartHook[] {
    const parentHooks = this.parent ? this.parent.getStartHooks() : [];
    return [...parentHooks, ...this.startHooks];
  }

  getStopHooks(): StopHook[] {
    const parentHooks = this.parent ? this.parent.getStopHooks() : [];
    return [...parentHooks, ...this.stopHooks];
  }

  /**
   * Mount a SotaPlugin while tracking every capability and hook it registers,
   * returning a `MountedPlugin` handle that can cleanly roll back all side effects.
   */
  async mount<TOptions = Record<string, unknown>>(
    plugin: SotaPlugin<TOptions>,
    options?: TOptions,
  ): Promise<MountedPlugin> {
    if (this.mountedPlugins.has(plugin.name)) {
      await this.unmount(plugin.name);
    }

    const addedEntries: Array<{ token: CapabilityToken<unknown>; key: string }> = [];
    const addedStartHooks: StartHook[] = [];
    const addedStopHooks: StopHook[] = [];
    const disposeHooks: DisposeHook[] = [];

    const trackedRegistry = new Proxy(this, {
      get(target, prop, receiver) {
        if (prop === 'provide') {
          return <T>(token: CapabilityToken<T>, key: string, impl: T) => {
            target.provide(token, key, impl);
            addedEntries.push({ token: token as CapabilityToken<unknown>, key });
            return trackedRegistry;
          };
        }
        if (prop === 'add') {
          return <T>(token: CapabilityToken<T>, impl: T) => {
            const key = crypto.randomUUID();
            target.provide(token, key, impl);
            addedEntries.push({ token: token as CapabilityToken<unknown>, key });
            return trackedRegistry;
          };
        }
        if (prop === 'onStart') {
          return (hook: StartHook) => {
            target.onStart(hook);
            addedStartHooks.push(hook);
            return trackedRegistry;
          };
        }
        if (prop === 'onStop') {
          return (hook: StopHook) => {
            target.onStop(hook);
            addedStopHooks.push(hook);
            return trackedRegistry;
          };
        }
        if (prop === 'onDispose') {
          return (hook: DisposeHook) => {
            disposeHooks.push(hook);
            return trackedRegistry;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const returnedCleanup = await plugin.setup(trackedRegistry, options);
    if (typeof returnedCleanup === 'function') {
      disposeHooks.push(returnedCleanup);
    }

    let disposed = false;
    const handle: MountedPlugin = {
      name: plugin.name,
      version: plugin.version,
      dispose: async () => {
        if (disposed) return;
        disposed = true;

        for (const entry of addedEntries) {
          this.remove(entry.token, entry.key);
        }
        for (const hook of addedStartHooks) {
          const idx = this.startHooks.indexOf(hook);
          if (idx !== -1) this.startHooks.splice(idx, 1);
        }
        for (const hook of addedStopHooks) {
          const idx = this.stopHooks.indexOf(hook);
          if (idx !== -1) this.stopHooks.splice(idx, 1);
        }
        for (let i = disposeHooks.length - 1; i >= 0; i--) {
          await disposeHooks[i]?.();
        }
        this.mountedPlugins.delete(plugin.name);
      },
    };

    this.mountedPlugins.set(plugin.name, handle);
    return handle;
  }

  /** Unmount a previously mounted plugin by name and roll back its registrations. */
  async unmount(name: string): Promise<boolean> {
    const handle = this.mountedPlugins.get(name);
    if (!handle) return false;
    await handle.dispose();
    return true;
  }

  /** List all mounted plugin names in this scope. */
  listMountedPlugins(): string[] {
    return Array.from(this.mountedPlugins.keys());
  }
}

/**
 * Standard contract every external or local Sota plugin must implement.
 * `setup()` may optionally return a cleanup function invoked on unmount/dispose.
 */
export interface SotaPlugin<TOptions = Record<string, unknown>> {
  readonly name: string;
  readonly version: string;
  setup(
    registry: PluginRegistry,
    options?: TOptions,
  ): void | DisposeHook | Promise<void | DisposeHook>;
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
