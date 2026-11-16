#!/usr/bin/env bun
import { addCommand, initCommand, listCommand, removeCommand } from './commands.ts';

function printHelp(): void {
  console.log(`sota - Pluggable AI Microkernel CLI

Usage:
  sota init                   Create sota.config.json in the current directory
  sota add <plugin>           Install an npm or local plugin and register it
  sota remove <plugin>        Remove a plugin from config and uninstall it
  sota list                   List registered plugins
`);
}

async function main(): Promise<void> {
  const [command, arg] = Bun.argv.slice(2);

  switch (command) {
    case 'init': {
      const path = await initCommand();
      console.log(`Initialized Sota config at ${path}`);
      break;
    }
    case 'add': {
      if (!arg) {
        console.error('Error: missing <plugin> argument.');
        process.exit(1);
      }
      const res = await addCommand(arg);
      if (res.registered) {
        console.log(`Added "${arg}" to ${res.configPath}`);
      } else {
        console.log(
          `Installed "${arg}". Please add it to "plugins" in ${res.configPath}.`,
        );
      }
      break;
    }
    case 'remove': {
      if (!arg) {
        console.error('Error: missing <plugin> argument.');
        process.exit(1);
      }
      const res = await removeCommand(arg);
      console.log(`Removed "${arg}" (config: ${res.removed}, uninstalled: ${res.uninstalled})`);
      break;
    }
    case 'list': {
      const plugins = await listCommand();
      if (plugins.length === 0) {
        console.log('No plugins registered.');
      } else {
        for (const p of plugins) console.log(`- ${p}`);
      }
      break;
    }
    default:
      printHelp();
      if (command && command !== '--help' && command !== '-h') {
        process.exit(1);
      }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
