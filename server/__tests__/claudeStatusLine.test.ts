import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

/** mptl fork (Đ3): our Claude status line writer (the only place Claude Code
 *  exposes its usage limits) and the longer PermissionRequest hook timeout. */
const { installHooks, installStatusLine, statusLineState, uninstallStatusLine } =
  await import('../src/providers/hook/claude/claudeHookInstaller.js');

function settingsPath(): string {
  return path.join(tmpBase, '.claude', 'settings.json');
}
function writeSettings(s: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}
function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
}
function ourStatusCommand(): string {
  return `node "${path.join(tmpBase, '.pixel-agents', 'hooks', 'claude-statusline.js')}"`;
}

describe('Claude status line writer', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-statusline-'));
  });
  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('installs into a settings file without a status line, keeping everything else', async () => {
    writeSettings({ permissions: { allow: ['Bash(ls)'] }, model: 'x' });
    expect(statusLineState()).toBe('none');
    expect(await installStatusLine()).toBe('ours');
    const s = readSettings();
    expect(s.statusLine).toEqual({ type: 'command', command: ourStatusCommand(), padding: 0 });
    expect(s.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(s.model).toBe('x');
    expect(statusLineState()).toBe('ours');
  });

  it('never replaces a status line the user already has', async () => {
    const mine = { type: 'command', command: '~/bin/my-line.sh' };
    writeSettings({ statusLine: mine });
    expect(statusLineState()).toBe('other');
    expect(await installStatusLine()).toBe('other');
    expect(readSettings().statusLine).toEqual(mine);
    expect(await uninstallStatusLine()).toBe('other');
    expect(readSettings().statusLine).toEqual(mine);
  });

  it('uninstall removes only ours', async () => {
    writeSettings({ model: 'x' });
    await installStatusLine();
    expect(await uninstallStatusLine()).toBe('none');
    expect(readSettings()).toEqual({ model: 'x' });
  });

  it('refuses to touch a settings file it cannot parse', async () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), '{ broken');
    await expect(installStatusLine()).rejects.toThrow();
    expect(fs.readFileSync(settingsPath(), 'utf-8')).toBe('{ broken');
  });
});

describe('PermissionRequest hook timeout', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-permtimeout-'));
  });
  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('gives PermissionRequest room to wait for the page; other events keep 5 s', async () => {
    writeSettings({});
    await installHooks();
    const hooks = readSettings().hooks as Record<
      string,
      Array<{ hooks: Array<{ timeout: number }> }>
    >;
    expect(hooks.PermissionRequest[0].hooks[0].timeout).toBe(60);
    expect(hooks.Stop[0].hooks[0].timeout).toBe(5);
    expect(hooks.PreToolUse[0].hooks[0].timeout).toBe(5);
  });
});
