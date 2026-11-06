import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AssistClient,
  AssistHub,
  HOLD_SECONDS_DEFAULT,
  MAX_HELD,
  summarizeToolInput,
} from '../src/assist.js';

/** mptl fork (Đ3): hold Claude permission prompts for the page, notify on waits. */

function settingsStore(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    getSetting: <T>(k: string, d: T): T => (k in data ? (data[k] as T) : d),
    setSetting: <T>(k: string, v: T): void => {
      data[k] = v;
    },
  };
}

function client(privileged: boolean): AssistClient & { got: Record<string, unknown>[] } {
  const got: Record<string, unknown>[] = [];
  return { privileged, send: (m) => got.push(m), got };
}

const EVENT = {
  session_id: 'sess-1',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm install', description: 'Install' },
  cwd: '/Users/seb/proj',
};

describe('summarizeToolInput', () => {
  it('shows the command, path or url of the common tools on one line', () => {
    expect(summarizeToolInput('Bash', { command: 'ls -la\nrm x' })).toBe('ls -la ⏎ rm x');
    expect(summarizeToolInput('Edit', { file_path: '/a/b.ts', old_string: 'x' })).toBe('/a/b.ts');
    expect(summarizeToolInput('WebFetch', { url: 'https://x.y', prompt: 'p' })).toBe('https://x.y');
  });
  it('falls back to compact JSON and cuts long text', () => {
    expect(summarizeToolInput('Mystery', { a: 1 })).toBe('{"a":1}');
    expect(summarizeToolInput('Bash', { command: 'x'.repeat(1000) })).toHaveLength(300);
    expect(summarizeToolInput('Bash', null)).toBe('');
  });
});

describe('AssistHub hold / decide', () => {
  let s: ReturnType<typeof settingsStore>;
  let hub: AssistHub;
  beforeEach(() => {
    vi.useFakeTimers();
    s = settingsStore({ 'mptl.assist.approveFromPage': true });
    let n = 0;
    hub = new AssistHub({ ...s, now: () => 1_000, newId: () => `r${++n}` });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers at once with no decision while approving from the page is off', async () => {
    s.data['mptl.assist.approveFromPage'] = false;
    const page = client(true);
    hub.addClient(page);
    hub.setVisible(page, true);
    await expect(hub.hold(EVENT)).resolves.toBeNull();
    expect(hub.list()).toEqual([]);
  });

  it('does not hold when no tokened page is open and visible', async () => {
    const viewer = client(false);
    hub.addClient(viewer);
    hub.setVisible(viewer, true);
    const page = client(true);
    hub.addClient(page);
    // tokened but hidden
    await expect(hub.hold(EVENT)).resolves.toBeNull();
    hub.setVisible(page, true);
    hub.removeClient(page);
    await expect(hub.hold(EVENT)).resolves.toBeNull();
  });

  it('holds for a visible tokened page, which allows it; the viewer never sees it', async () => {
    const page = client(true);
    const viewer = client(false);
    hub.addClient(page);
    hub.addClient(viewer);
    hub.setVisible(page, true);
    hub.setVisible(viewer, true);
    const pending = hub.hold(EVENT, 7);
    const held = page.got.filter((m) => m.type === 'permissionRequests').pop();
    expect(held).toEqual({
      type: 'permissionRequests',
      requests: [
        {
          requestId: 'r1',
          sessionId: 'sess-1',
          agentId: 7,
          toolName: 'Bash',
          summary: 'npm install',
          cwd: '/Users/seb/proj',
          createdAt: 1_000,
          expiresAt: 1_000 + HOLD_SECONDS_DEFAULT * 1000,
        },
      ],
    });
    expect(viewer.got.some((m) => m.type === 'permissionRequests')).toBe(false);
    expect(hub.decide('r1', 'allow', page)).toBe(true);
    await expect(pending).resolves.toBe('allow');
    expect(hub.list()).toEqual([]);
    expect(page.got.at(-1)).toEqual({ type: 'permissionRequests', requests: [] });
  });

  it('refuses a decision from an untokened client and an unknown or finished request', async () => {
    const page = client(true);
    hub.addClient(page);
    hub.setVisible(page, true);
    const pending = hub.hold(EVENT);
    expect(hub.decide('r1', 'allow', client(false))).toBe(false);
    expect(hub.decide('nope', 'deny', page)).toBe(false);
    expect(hub.decide('r1', 'deny', page)).toBe(true);
    await expect(pending).resolves.toBe('deny');
    expect(hub.decide('r1', 'allow', page)).toBe(false);
  });

  it('"ask" hands the prompt back to the app at once', async () => {
    const page = client(true);
    hub.addClient(page);
    hub.setVisible(page, true);
    const pending = hub.hold(EVENT);
    expect(hub.decide('r1', 'ask', page)).toBe(true);
    await expect(pending).resolves.toBeNull();
  });

  it('times out to no decision, so the app asks as usual', async () => {
    const page = client(true);
    hub.addClient(page);
    hub.setVisible(page, true);
    const pending = hub.hold(EVENT);
    vi.advanceTimersByTime(HOLD_SECONDS_DEFAULT * 1000);
    await expect(pending).resolves.toBeNull();
    expect(hub.list()).toEqual([]);
  });

  it('releases every held prompt when the last visible tokened page goes away', async () => {
    const page = client(true);
    hub.addClient(page);
    hub.setVisible(page, true);
    const a = hub.hold(EVENT);
    const b = hub.hold({ ...EVENT, session_id: 'sess-2' });
    hub.setVisible(page, false);
    await expect(a).resolves.toBeNull();
    await expect(b).resolves.toBeNull();
  });

  it('holds at most MAX_HELD prompts', async () => {
    const page = client(true);
    hub.addClient(page);
    hub.setVisible(page, true);
    for (let i = 0; i < MAX_HELD; i++) void hub.hold({ ...EVENT, session_id: `s${i}` });
    await expect(hub.hold(EVENT)).resolves.toBeNull();
    expect(hub.list()).toHaveLength(MAX_HELD);
  });

  it('ignores a request without a session or tool name', async () => {
    const page = client(true);
    hub.addClient(page);
    hub.setVisible(page, true);
    await expect(hub.hold({ ...EVENT, tool_name: undefined })).resolves.toBeNull();
    await expect(hub.hold({ ...EVENT, session_id: 5 })).resolves.toBeNull();
  });
});

describe('AssistHub settings / welcome / notify', () => {
  it('persists settings and broadcasts them to every client', () => {
    const s = settingsStore();
    const hub = new AssistHub(s);
    const a = client(true);
    const b = client(false);
    hub.addClient(a);
    hub.addClient(b);
    hub.setSettings({ approveFromPage: true });
    const msg = {
      type: 'assistSettings',
      approveFromPage: true,
      notifyMac: true,
      holdSeconds: HOLD_SECONDS_DEFAULT,
    };
    expect(a.got.at(-1)).toEqual(msg);
    expect(b.got.at(-1)).toEqual(msg);
    expect(s.data['mptl.assist.approveFromPage']).toBe(true);
  });

  it('welcomes a client with settings and quota; held prompts only for tokened ones', () => {
    const hub = new AssistHub(settingsStore());
    hub.setQuota({ type: 'quotaStatus', codex: { updatedAt: 1 } });
    const viewer = client(false);
    hub.welcome(viewer);
    expect(viewer.got.map((m) => m.type)).toEqual(['assistSettings', 'quotaStatus']);
    const page = client(true);
    hub.welcome(page);
    expect(page.got.map((m) => m.type)).toEqual([
      'assistSettings',
      'quotaStatus',
      'permissionRequests',
    ]);
  });

  it('notifies on a wait, at most once a minute per session, and not when off', () => {
    let t = 0;
    const notes: string[][] = [];
    const s = settingsStore();
    const hub = new AssistHub({
      ...s,
      now: () => t,
      notify: (title, body) => notes.push([title, body]),
    });
    hub.notifyWaiting('sess-1', 'kho', 'Bash');
    hub.notifyWaiting('sess-1', 'kho', 'Bash');
    t = 61_000;
    hub.notifyWaiting('sess-1', 'kho', 'Edit');
    hub.notifyWaiting('sess-2', undefined, undefined);
    expect(notes).toEqual([
      ['Pixel Agents', 'kho cần anh duyệt: Bash'],
      ['Pixel Agents', 'kho cần anh duyệt: Edit'],
      ['Pixel Agents', 'Một phiên đang chờ anh'],
    ]);
    hub.setSettings({ notifyMac: false });
    t = 200_000;
    hub.notifyWaiting('sess-1', 'kho', 'Bash');
    expect(notes).toHaveLength(3);
  });
});
