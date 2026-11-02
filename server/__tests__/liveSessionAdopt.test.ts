import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    terminals: [],
  },
}));

import { AgentStateStore } from '../src/agentStateStore.js';
import { DISMISSED_COOLDOWN_MS } from '../src/constants.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import {
  adoptLiveSessions,
  type LiveSession,
  setAgentRemovalCallback,
  setDismissalTracker,
} from '../src/fileWatcher.js';
import { PathSet } from '../src/pathKey.js';

/**
 * mptl fork: every Claude Code session that is still running (its pid is alive in
 * ~/.claude/sessions) becomes a character, however long it has been idle -- the
 * upstream scanners only adopt transcripts written in the last few minutes.
 */
describe('adoptLiveSessions', () => {
  let tmpDir: string;
  let tracker: DismissalTracker;
  let known: PathSet;
  let nextId: { current: number };
  let agents: AgentStateStore;
  let fileWatchers: Map<number, fs.FSWatcher>;
  let pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;

  function transcript(name: string, ageMs: number): string {
    const dir = path.join(tmpDir, '-Users-seb-kho');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.jsonl`);
    fs.writeFileSync(file, '{"type":"assistant"}\n');
    const t = (Date.now() - ageMs) / 1000;
    fs.utimesSync(file, t, t);
    return file;
  }

  function run(live: LiveSession[]): void {
    adoptLiveSessions(
      live,
      known,
      nextId,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      () => {},
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-live-'));
    tracker = new DismissalTracker();
    setDismissalTracker(tracker);
    known = new PathSet();
    nextId = { current: 1 };
    agents = new AgentStateStore();
    fileWatchers = new Map();
    pollingTimers = new Map();
    waitingTimers = new Map();
    permissionTimers = new Map();
  });

  afterEach(() => {
    for (const w of fileWatchers.values()) w.close();
    for (const t of pollingTimers.values()) clearInterval(t);
    for (const t of waitingTimers.values()) clearTimeout(t);
    for (const t of permissionTimers.values()) clearTimeout(t);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adopts a live session idle for days, even with a tiny transcript', () => {
    const file = transcript('s-old', 3 * 24 * 3_600_000);
    run([{ file, cwd: '/Users/seb/kho' }]);
    expect(agents.size).toBe(1);
    const agent = [...agents.values()][0];
    expect(agent.jsonlFile).toBe(file);
    expect(agent.isExternal).toBe(true);
    expect(agent.directoryName).toBe('kho');
    expect(known.has(file)).toBe(true);
  });

  it('skips a session whose transcript does not exist yet', () => {
    run([{ file: path.join(tmpDir, 'nope', 'x.jsonl'), cwd: '/x' }]);
    expect(agents.size).toBe(0);
  });

  it('does not adopt the same transcript twice', () => {
    const file = transcript('s-twice', 1000);
    run([{ file, cwd: '/Users/seb/kho' }]);
    run([{ file, cwd: '/Users/seb/kho' }]);
    expect(agents.size).toBe(1);
  });

  it('a session the user closed with X stays closed after the cooldown ends', () => {
    const file = transcript('s-closed', 1000);
    tracker.dismiss(file, Date.now() - 10_000);
    run([{ file, cwd: '/Users/seb/kho' }]);
    expect(agents.size).toBe(0);

    // Cooldown over: upstream would re-adopt, a live session must not bounce back.
    tracker.dismiss(file, Date.now() - DISMISSED_COOLDOWN_MS - 1000);
    run([{ file, cwd: '/Users/seb/kho' }]);
    expect(agents.size).toBe(0);
  });

  it('skips a permanently dismissed transcript (/clear)', () => {
    const file = transcript('s-cleared', 1000);
    tracker.permanentlyDismiss(file);
    run([{ file, cwd: '/Users/seb/kho' }]);
    expect(agents.size).toBe(0);
  });

  it('drops the old character of a session that moved to another transcript', () => {
    const live = transcript('s-moved', 1000);
    const oldDir = path.join(tmpDir, '-Users-seb');
    fs.mkdirSync(oldDir, { recursive: true });
    const old = path.join(oldDir, 's-moved.jsonl');
    fs.writeFileSync(old, '{}\n');
    run([{ file: old, cwd: '/Users/seb' }]);
    expect(agents.size).toBe(1);
    const oldId = [...agents.keys()][0];

    const removed: number[] = [];
    setAgentRemovalCallback((id) => {
      removed.push(id);
      agents.delete(id);
    });
    run([{ file: live, cwd: '/Users/seb/kho' }]);
    setAgentRemovalCallback(null);

    expect(removed).toEqual([oldId]);
    expect([...agents.values()].map((a) => a.jsonlFile)).toEqual([live]);
    expect(tracker.isPermanentlyDismissed(old)).toBe(true);
  });

  it('a Codex rollout keeps the Codex session id so hook events find the character', () => {
    const id = '01a1959a-67d5-7261-b369-63d1287ea28a';
    const file = transcript(`rollout-2026-11-01T12-34-46-${id}`, 1000);
    run([{ file, cwd: '/Users/seb/novaceu-hub', sessionId: id, provider: 'codex' }]);
    const agent = [...agents.values()][0];
    expect(agent.sessionId).toBe(id);
    expect(agent.providerId).toBe('codex');
    expect(agent.directoryName).toBe('novaceu-hub');
    run([{ file, cwd: '/Users/seb/novaceu-hub', sessionId: id, provider: 'codex' }]);
    expect(agents.size).toBe(1);
  });
});
