import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { ArchiveHide } from '../src/archiveHide.js';
import {
  adoptExternalSessionFromHook,
  adoptLiveSessions,
  scanGlobalProjectDirs,
  setHiddenSessionCheck,
  setHookProvider,
} from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { type SessionMetaIO, SessionMetaPoller, type SessionRecord } from '../src/sessionMeta.js';

/**
 * mptl fork, measured 06/11 19:14:
 *
 * T2 — "MAC - mptl-kho to Cloudfare" (record cwd = a worktree) was shown idle since
 * 22/10 while anh was working in it. The file under the worktree's project dir had
 * its last user/assistant line at 22/10 02:12; the one being written was
 * ~/.claude/projects/-Users-seb-mptl-kho/<same id>.jsonl (last line 06/11 16:53).
 * The session's transcript is the newest `<sessionId>.jsonl` in any project dir,
 * not the one the record's cwd points to.
 *
 * T4 — archiving "MAC - peer review repo" stopped pid N; the Claude app resumed the
 * same session 37 s later (SessionStart source=resume, new pid), and the transcript
 * scans brought the character back. A session archived on the page stays hidden
 * until anh uses it again (a new turn after the archive) or restores it.
 */

const ROOT = '/root/projects';
const WT_FILE = `${ROOT}/-Users-seb-kho--claude-worktrees-w/s1.jsonl`;
const MAIN_FILE = `${ROOT}/-Users-seb-kho/s1.jsonl`;
const OLD_ACT = Date.parse('2026-10-22T02:12:35+07:00');
const NEW_ACT = Date.parse('2026-11-06T16:53:35+07:00');
const STATUS_AT = Date.parse('2026-11-06T16:53:39+07:00');

function agent(id: number, sessionId: string, file = `/p/${sessionId}.jsonl`) {
  return createAgentState({
    id,
    sessionId,
    projectDir: path.dirname(file),
    jsonlFile: file,
    isExternal: true,
  });
}

function poller(records: SessionRecord[], io: Partial<SessionMetaIO>, hide?: ArchiveHide) {
  const store = new AgentStateStore();
  const p = new SessionMetaPoller(
    store,
    {
      readRecords: async () => records,
      readPs: async () => records.map((r) => `${r.pid} 1 100`).join('\n'),
      ...io,
    },
    ROOT,
  );
  if (hide) p.setArchiveHide(hide);
  return { store, p };
}

describe('the transcript of a live Claude session (T2)', () => {
  const rec: SessionRecord = {
    pid: 8023,
    sessionId: 's1',
    cwd: '/Users/seb/kho/.claude/worktrees/w',
    status: 'idle',
    statusUpdatedAt: STATUS_AT,
  };
  const mtimes: Record<string, number> = {
    [WT_FILE]: Date.parse('2026-10-28T22:38:55+07:00'),
    [MAIN_FILE]: STATUS_AT,
  };
  const acts: Record<string, number> = { [WT_FILE]: OLD_ACT, [MAIN_FILE]: NEW_ACT };
  const io: Partial<SessionMetaIO> = {
    listSessionFiles: async () => [WT_FILE, MAIN_FILE, `${ROOT}/-Users-seb-kho/other.jsonl`],
    transcriptMtime: async (f) => mtimes[f],
    readLastActivity: async (f) => acts[f],
  };

  it('idle time comes from the newest <sessionId>.jsonl in any project dir', async () => {
    const { store, p } = poller([rec], io);
    store.set(1, agent(1, 's1', WT_FILE));
    await p.tick();
    expect(store.get(1)?.sessionMeta?.statusSince).toBe(NEW_ACT);
  });

  it('the live session points at that transcript, so the character follows it', async () => {
    const { p } = poller([rec], io);
    await p.tick();
    expect(p.liveSessions().map((s) => s.file)).toEqual([MAIN_FILE]);
  });

  it('without a file listing it keeps the cwd-derived path', async () => {
    const { p } = poller([rec], { transcriptMtime: io.transcriptMtime });
    await p.tick();
    expect(p.liveSessions().map((s) => s.file)).toEqual([WT_FILE]);
  });
});

describe('ArchiveHide (T4)', () => {
  const A = Date.parse('2026-11-06T19:09:21+07:00');

  it('hides a Claude session archived on the page, not a Codex one', () => {
    const h = new ArchiveHide();
    h.setArchived([
      { sessionId: 'c1', provider: 'claude', archivedAt: A },
      { sessionId: 'x1', provider: 'codex', archivedAt: A },
    ]);
    expect(h.isHidden('c1')).toBe(true);
    expect(h.isHidden('x1')).toBe(false);
    expect(h.isHidden('other')).toBe(false);
  });

  it('a resume by the app (no new turn) keeps it hidden; a new turn or a busy status shows it', () => {
    const h = new ArchiveHide();
    h.setArchived([{ sessionId: 'c1', provider: 'claude', archivedAt: A }]);
    h.noteActivity('c1', A - 1000, 'idle');
    expect(h.isHidden('c1')).toBe(true);
    h.noteActivity('c1', A + 1000, 'idle');
    expect(h.isHidden('c1')).toBe(false);

    const b = new ArchiveHide();
    b.setArchived([{ sessionId: 'c1', provider: 'claude', archivedAt: A }]);
    b.noteActivity('c1', undefined, 'busy');
    expect(b.isHidden('c1')).toBe(false);
  });

  it('archived again after being used again: hidden again', () => {
    const h = new ArchiveHide();
    h.setArchived([{ sessionId: 'c1', provider: 'claude', archivedAt: A }]);
    h.noteActivity('c1', A + 1000, 'idle');
    h.setArchived([{ sessionId: 'c1', provider: 'claude', archivedAt: A + 5000 }]);
    expect(h.isHidden('c1')).toBe(true);
  });

  it('restored (no longer in the archived list): shown', () => {
    const h = new ArchiveHide();
    h.setArchived([{ sessionId: 'c1', provider: 'claude', archivedAt: A }]);
    h.setArchived([]);
    expect(h.isHidden('c1')).toBe(false);
  });
});

describe('SessionMetaPoller with the archive (T4)', () => {
  const A = Date.parse('2026-11-06T19:09:21+07:00');
  const rec: SessionRecord = {
    pid: 94842,
    sessionId: 'c1',
    cwd: '/Users/seb/las',
    status: 'idle',
    statusUpdatedAt: A + 38_000,
  };

  it('removes a character of an archived session the app brought back', async () => {
    const hide = new ArchiveHide();
    const removed: number[] = [];
    const { store, p } = poller(
      [rec],
      {
        readArchiveLog: async () => [{ sessionId: 'c1', provider: 'claude', archivedAt: A }],
        readLastActivity: async () => A - 60_000,
      },
      hide,
    );
    p.onSessionHidden((id) => removed.push(id));
    store.set(1, agent(1, 'c1'));
    store.set(2, agent(2, 'other'));
    await p.tick();
    expect(hide.isHidden('c1')).toBe(true);
    expect(removed).toEqual([1]);
  });

  it('keeps it when anh used the session after archiving it', async () => {
    const hide = new ArchiveHide();
    const removed: number[] = [];
    const { store, p } = poller(
      [rec],
      {
        readArchiveLog: async () => [{ sessionId: 'c1', provider: 'claude', archivedAt: A }],
        readLastActivity: async () => A + 60_000,
      },
      hide,
    );
    p.onSessionHidden((id) => removed.push(id));
    store.set(1, agent(1, 'c1'));
    await p.tick();
    expect(hide.isHidden('c1')).toBe(false);
    expect(removed).toEqual([]);
  });

  it('an unreadable archive log hides nothing new and keeps the last list', async () => {
    const hide = new ArchiveHide();
    hide.setArchived([{ sessionId: 'c1', provider: 'claude', archivedAt: A }]);
    const { p } = poller(
      [rec],
      {
        readArchiveLog: async () => {
          throw new Error('EACCES');
        },
        readLastActivity: async () => A - 60_000,
      },
      hide,
    );
    await p.tick();
    expect(hide.isHidden('c1')).toBe(true);
  });
});

describe('adoption paths skip a hidden session (T4)', () => {
  let rt: AgentRuntime | undefined;
  let root: string | undefined;
  afterEach(() => {
    setHiddenSessionCheck(null);
    rt?.dispose();
    rt = undefined;
    setHookProvider(claudeProvider as unknown as Parameters<typeof setHookProvider>[0]);
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function setup() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), `pxl-hide-${crypto.randomUUID()}`));
    const proj = path.join(root, '-Users-x-proj');
    fs.mkdirSync(proj);
    const hidden = path.join(proj, 'hid.jsonl');
    const shown = path.join(proj, 'shown.jsonl');
    fs.writeFileSync(hidden, 'x'.repeat(4096));
    fs.writeFileSync(shown, 'x'.repeat(4096));
    const store = new AgentStateStore();
    rt = new AgentRuntime(store, claudeProvider);
    setHookProvider({
      ...claudeProvider,
      getAllSessionRoots: () => [root as string],
    } as unknown as Parameters<typeof setHookProvider>[0]);
    setHiddenSessionCheck((sid) => sid === 'hid');
    return { store, rt, hidden, shown, proj };
  }

  const names = (store: AgentStateStore) =>
    [...store.values()].map((a) => path.basename(a.jsonlFile)).sort();

  it('the live-session adoption', () => {
    const { store, rt: r, hidden, shown, proj } = setup();
    adoptLiveSessions(
      [
        { file: hidden, cwd: proj, sessionId: 'hid', provider: 'claude' },
        { file: shown, cwd: proj, sessionId: 'shown', provider: 'claude' },
      ],
      new Set<string>(),
      store.nextAgentId,
      store,
      r.fileWatchers,
      r.pollingTimers,
      r.waitingTimers,
      r.permissionTimers,
      () => {},
    );
    expect(names(store)).toEqual(['shown.jsonl']);
  });

  it('the global transcript scan', () => {
    const { store, rt: r } = setup();
    scanGlobalProjectDirs(
      new Set<string>(),
      store.nextAgentId,
      store,
      r.fileWatchers,
      r.pollingTimers,
      r.waitingTimers,
      r.permissionTimers,
      () => {},
    );
    expect(names(store)).toEqual(['shown.jsonl']);
  });

  it('a SessionStart hook (the app resuming it)', () => {
    const { store, rt: r, hidden, proj } = setup();
    adoptExternalSessionFromHook(
      'hid',
      hidden,
      proj,
      new Set<string>(),
      store.nextAgentId,
      store,
      r.fileWatchers,
      r.pollingTimers,
      r.waitingTimers,
      r.permissionTimers,
      () => {},
    );
    expect(names(store)).toEqual([]);
  });
});
