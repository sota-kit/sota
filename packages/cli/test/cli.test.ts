import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCommand, initCommand, listCommand, removeCommand } from '../src/commands.ts';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sota-cli-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('@sota/cli', () => {
  test('init, add, list, and remove plugins in sota.config.json', async () => {
    const dir = makeTempDir();
    const spawned: string[][] = [];
    const mockRunner = async (cmd: string[]) => {
      spawned.push(cmd);
      return 0;
    };

    const configPath = await initCommand({ cwd: dir });
    expect(configPath.endsWith('sota.config.json')).toBe(true);

    const addRes = await addCommand('@sota-plugin/langgraph', {
      cwd: dir,
      runner: mockRunner,
    });
    expect(addRes.installed).toBe(true);
    expect(addRes.registered).toBe(true);
    expect(spawned).toContainEqual(['bun', 'add', '@sota-plugin/langgraph']);

    // Local path plugin should not invoke bun add
    await addCommand('./local/my-plugin.ts', { cwd: dir, runner: mockRunner });
    expect(spawned.length).toBe(1);

    const listed = await listCommand({ cwd: dir });
    expect(listed).toEqual(['@sota-plugin/langgraph', './local/my-plugin.ts']);

    const removeRes = await removeCommand('@sota-plugin/langgraph', {
      cwd: dir,
      runner: mockRunner,
    });
    expect(removeRes.removed).toBe(true);
    expect(removeRes.uninstalled).toBe(true);
    expect(spawned).toContainEqual(['bun', 'remove', '@sota-plugin/langgraph']);

    const afterRemove = await listCommand({ cwd: dir });
    expect(afterRemove).toEqual(['./local/my-plugin.ts']);
  });
});
