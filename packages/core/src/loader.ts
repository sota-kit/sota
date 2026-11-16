import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginFactory, SotaPlugin } from './plugin.ts';
import { PluginRegistry } from './plugin.ts';

export type PluginSpec =
  | string
  | [string, Record<string, unknown>]
  | SotaPlugin
  | [SotaPlugin, Record<string, unknown>];

export interface SotaConfig {
  plugins: PluginSpec[];
  defaults?: {
    model?: string;
    engine?: string;
    memory?: string;
  };
}

function isSotaPlugin(value: unknown): value is SotaPlugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'setup' in value &&
    typeof (value as SotaPlugin).setup === 'function'
  );
}

async function importPluginModule(specifier: string, cwd: string): Promise<unknown> {
  const isLocalPath =
    specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier);
  if (isLocalPath) {
    const absPath = isAbsolute(specifier) ? specifier : resolve(cwd, specifier);
    return import(pathToFileURL(absPath).href);
  }
  return import(specifier);
}

/**
 * Resolve a single PluginSpec (package name, local file path, tuple with options,
 * or inline SotaPlugin) into a SotaPlugin instance + options.
 */
export async function resolvePlugin(
  spec: PluginSpec,
  cwd = process.cwd(),
): Promise<{ plugin: SotaPlugin; options?: Record<string, unknown> }> {
  const [target, options] = Array.isArray(spec) ? spec : [spec, undefined];

  if (isSotaPlugin(target)) {
    return { plugin: target, options };
  }

  if (typeof target !== 'string') {
    throw new Error(`Invalid plugin specifier: ${String(target)}`);
  }

  const mod = (await importPluginModule(target, cwd)) as {
    default?: SotaPlugin | PluginFactory;
    plugin?: SotaPlugin | PluginFactory;
  };
  const exported = mod.default ?? mod.plugin;

  if (typeof exported === 'function') {
    return { plugin: exported(options), options };
  }
  if (isSotaPlugin(exported)) {
    return { plugin: exported, options };
  }

  throw new Error(
    `Plugin "${target}" must default-export a SotaPlugin object or factory function.`,
  );
}

/** Load and mount all plugins declared in `specs` into a PluginRegistry. */
export async function loadPlugins(
  specs: PluginSpec[],
  registry = new PluginRegistry(),
  cwd = process.cwd(),
): Promise<PluginRegistry> {
  for (const spec of specs) {
    const { plugin, options } = await resolvePlugin(spec, cwd);
    await registry.mount(plugin, options);
  }
  return registry;
}

/** Load a `sota.config.ts` / `sota.config.js` / `sota.config.json` from `cwd`. */
export async function loadConfig(configPath?: string, cwd = process.cwd()): Promise<SotaConfig> {
  const candidates = configPath
    ? [isAbsolute(configPath) ? configPath : resolve(cwd, configPath)]
    : [
        resolve(cwd, 'sota.config.ts'),
        resolve(cwd, 'sota.config.js'),
        resolve(cwd, 'sota.config.json'),
      ];

  for (const candidate of candidates) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      if (candidate.endsWith('.json')) {
        return (await file.json()) as SotaConfig;
      }
      const mod = (await import(pathToFileURL(candidate).href)) as { default?: SotaConfig };
      if (!mod.default) {
        throw new Error(`Config file "${candidate}" must have a default export.`);
      }
      return mod.default;
    }
  }

  throw new Error(`No Sota config file found in "${cwd}".`);
}
