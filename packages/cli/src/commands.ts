import { resolve } from 'node:path';
import type { PluginSpec, SotaConfig } from '@sota/core';

export interface CommandOptions {
  cwd?: string;
  skipInstall?: boolean;
  runner?: (cmd: string[], cwd: string) => Promise<number>;
}

const DEFAULT_CONFIG: SotaConfig = {
  plugins: [],
  defaults: {},
};

function isLocalSpecifier(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');
}

function getPluginName(spec: PluginSpec): string {
  const target = Array.isArray(spec) ? spec[0] : spec;
  return typeof target === 'string' ? target : target.name;
}

async function defaultRunner(cmd: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

async function findConfigFile(cwd: string): Promise<string | undefined> {
  for (const name of ['sota.config.json', 'sota.config.ts', 'sota.config.js']) {
    const full = resolve(cwd, name);
    if (await Bun.file(full).exists()) {
      return full;
    }
  }
  return undefined;
}

/** Initialize a `sota.config.json` in `cwd`. */
export async function initCommand(opts: CommandOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const existing = await findConfigFile(cwd);
  if (existing) {
    throw new Error(`Config already exists at "${existing}".`);
  }
  const target = resolve(cwd, 'sota.config.json');
  await Bun.write(target, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return target;
}

/** Install an external plugin via `bun add` (for npm packages) and register it in `sota.config.json`. */
export async function addCommand(
  pluginSpec: string,
  opts: CommandOptions = {},
): Promise<{ installed: boolean; registered: boolean; configPath?: string }> {
  const cwd = opts.cwd ?? process.cwd();
  const run = opts.runner ?? defaultRunner;

  let installed = false;
  if (!isLocalSpecifier(pluginSpec) && !opts.skipInstall) {
    const code = await run(['bun', 'add', pluginSpec], cwd);
    if (code !== 0) {
      throw new Error(`Failed to install "${pluginSpec}" via bun add (exit code ${code}).`);
    }
    installed = true;
  }

  let configPath = await findConfigFile(cwd);
  if (!configPath) {
    configPath = await initCommand({ cwd });
  }

  if (configPath.endsWith('.json')) {
    const config = (await Bun.file(configPath).json()) as SotaConfig;
    const exists = config.plugins.some((p) => getPluginName(p) === pluginSpec);
    if (!exists) {
      config.plugins.push(pluginSpec);
      await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
    }
    return { installed, registered: true, configPath };
  }

  return { installed, registered: false, configPath };
}

/** Remove a plugin from `sota.config.json` and optionally uninstall it via `bun remove`. */
export async function removeCommand(
  pluginSpec: string,
  opts: CommandOptions = {},
): Promise<{ removed: boolean; uninstalled: boolean }> {
  const cwd = opts.cwd ?? process.cwd();
  const run = opts.runner ?? defaultRunner;
  const configPath = await findConfigFile(cwd);

  let removed = false;
  if (configPath && configPath.endsWith('.json')) {
    const config = (await Bun.file(configPath).json()) as SotaConfig;
    const before = config.plugins.length;
    config.plugins = config.plugins.filter((p) => getPluginName(p) !== pluginSpec);
    if (config.plugins.length !== before) {
      await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
      removed = true;
    }
  }

  let uninstalled = false;
  if (!isLocalSpecifier(pluginSpec) && !opts.skipInstall) {
    const code = await run(['bun', 'remove', pluginSpec], cwd);
    if (code === 0) uninstalled = true;
  }

  return { removed, uninstalled };
}

/** List plugins configured in `sota.config.json`. */
export async function listCommand(opts: CommandOptions = {}): Promise<string[]> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = await findConfigFile(cwd);
  if (!configPath) {
    return [];
  }
  if (configPath.endsWith('.json')) {
    const config = (await Bun.file(configPath).json()) as SotaConfig;
    return config.plugins.map(getPluginName);
  }
  return [];
}
