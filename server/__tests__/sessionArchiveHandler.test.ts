import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { type ClientMessageContext, handleClientMessage } from '../src/clientMessageHandler.js';
import { FileStateAdapter } from '../src/fileStateAdapter.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import type { ArchiveIO, ArchiveLogEvent } from '../src/sessionArchive.js';
import type { InspectIO } from '../src/sessionInspect.js';
import type { TrashIO } from '../src/sessionTrash.js';
import type { AgentState, SessionMeta } from '../src/types.js';

const START = 'Fri Oct 23 11:05:24 2026';

function agent(id: number, sessionId: string, meta: SessionMeta): AgentState {
  return {
    id,
    sessionId,
    isExternal: true,
    projectDir: '/p',
    jsonlFile: `/p/${sessionId}.jsonl`,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
    sessionMeta: meta,
  };
}

/** Settle the async archive chain (identity checks → action → log → replies). */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('archiveSession / restoreSession messages', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let store: AgentStateStore;
  let runtime: AgentRuntime;
  let sent: Array<Record<string, unknown>>;
  let broadcasts: Array<Record<string, unknown>>;
  let calls: { signals: number[]; codex: string[][]; log: ArchiveLogEvent[] };
  let io: ArchiveIO;
  let inspectIO: InspectIO;
  let inspected: string[] = [];
  let trashIO: TrashIO;
  let trashed: string[][];

  function ctx(overrides: Partial<ClientMessageContext> = {}): ClientMessageContext {
    return {
      store,
      runtime,
      cache: null,
      privileged: true,
      archiveIO: io,
      inspectIO,
      trashIO,
      ...overrides,
    };
  }

  function dispatch(msg: Record<string, unknown>, context = ctx()): void {
    handleClientMessage(msg, (m) => sent.push(m), context);
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-archive-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    store = new AgentStateStore();
    store.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
    runtime = new AgentRuntime(store, claudeProvider);
    sent = [];
    broadcasts = [];
    store.on('broadcast', (m) => broadcasts.push(m));
    calls = { signals: [], codex: [], log: [] };
    io = {
      readClaudeRecord: async (pid) =>
        pid === 4242 ? { pid, sessionId: 's1', status: 'idle', procStart: START } : null,
      processStart: async () => START,
      processName: async () => '/Users/seb/.local/bin/claude',
      signal: (pid) => calls.signals.push(pid),
      runCodex: async (args) => {
        calls.codex.push(args);
      },
      appendLog: async (e) => {
        calls.log.push(e);
      },
      readLog: async () => calls.log,
      now: () => 1_000,
      verifyStops: async (_pid, picked) => picked.map((x) => x.pid),
    };
    inspectIO = {
      ps: async () => '',
      listening: async () => '',
      established: async () => '',
      launchdPids: async () => '',
      cwds: async () => '',
      git: async (cwd) => {
        inspected.push(cwd);
        return '# branch.head main\n? a\n';
      },
      tail: async () => JSON.stringify({ type: 'user', message: { content: 'Hỏi cuối' } }),
    };
    trashed = [];
    trashIO = {
      kind: async () => 'file',
      list: async () => [],
      isLive: async (sid) => sid === 'live-again',
      trash: async (paths) => {
        trashed.push(paths);
      },
      appendLog: async (e) => {
        calls.log.push(e);
      },
      now: () => 2_000,
    };
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    runtime.dispose();
    store.dispose();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('archives an idle Claude session: stops it, removes the character, tells every office', async () => {
    store.set(5, agent(5, 's1', { provider: 'claude', pid: 4242, name: 'Speakr', status: 'idle' }));

    dispatch({ type: 'archiveSession', id: 5, folder: 'local-ai-system' });
    await settle();

    expect(calls.signals).toEqual([4242]);
    expect(store.has(5)).toBe(false);
    expect(sent).toContainEqual({
      type: 'sessionArchiveResult',
      id: 5,
      ok: true,
      provider: 'claude',
      sessionId: 's1',
    });
    const list = broadcasts.find((m) => m.type === 'archivedSessions');
    expect(list?.sessions).toEqual([
      expect.objectContaining({ sessionId: 's1', provider: 'claude', folder: 'local-ai-system' }),
    ]);
  });

  it('keeps a busy session and says why', async () => {
    store.set(5, agent(5, 's1', { provider: 'claude', pid: 4242, status: 'busy' }));

    dispatch({ type: 'archiveSession', id: 5 });
    await settle();

    expect(calls.signals).toEqual([]);
    expect(store.has(5)).toBe(true);
    expect(sent).toContainEqual({ type: 'sessionArchiveResult', id: 5, ok: false, reason: 'busy' });
    expect(broadcasts.some((m) => m.type === 'archivedSessions')).toBe(false);
  });

  it('a read-only office cannot archive', async () => {
    store.set(5, agent(5, 's1', { provider: 'claude', pid: 4242, status: 'idle' }));

    dispatch({ type: 'archiveSession', id: 5 }, ctx({ privileged: false }));
    await settle();

    expect(calls.signals).toEqual([]);
    expect(store.has(5)).toBe(true);
  });

  it('an unknown character id does nothing', async () => {
    dispatch({ type: 'archiveSession', id: 99 });
    await settle();

    expect(calls.signals).toEqual([]);
    expect(calls.codex).toEqual([]);
    expect(sent).toContainEqual({
      type: 'sessionArchiveResult',
      id: 99,
      ok: false,
      reason: 'unknown',
    });
  });

  it('restores a Codex session using the provider from the log, not the client', async () => {
    calls.log.push({ kind: 'archived', sessionId: 'c1', provider: 'codex', archivedAt: 1 });

    dispatch({ type: 'restoreSession', sessionId: 'c1', provider: 'claude' });
    await settle();

    expect(calls.codex).toEqual([['unarchive', 'c1']]);
    expect(sent).toContainEqual({ type: 'sessionRestoreResult', sessionId: 'c1', ok: true });
    expect(broadcasts.find((m) => m.type === 'archivedSessions')?.sessions).toEqual([]);
  });

  it('refuses to restore a session that is not in the archive', async () => {
    dispatch({ type: 'restoreSession', sessionId: 'nope' });
    await settle();

    expect(calls.codex).toEqual([]);
    expect(calls.log).toEqual([]);
    expect(sent).toContainEqual({
      type: 'sessionRestoreResult',
      sessionId: 'nope',
      ok: false,
      reason: 'unknown',
    });
  });

  it('a restored session may be adopted again (its X-close dismissal is lifted)', async () => {
    store.set(6, agent(6, 'c1', { provider: 'codex', status: 'idle' }));
    dispatch({ type: 'archiveSession', id: 6 });
    await settle();
    expect(runtime.dismissalTracker.isDismissed('/p/c1.jsonl')).toBe(true);

    dispatch({ type: 'restoreSession', sessionId: 'c1' });
    await settle();

    expect(runtime.dismissalTracker.isDismissed('/p/c1.jsonl')).toBe(false);
  });

  it('webviewReady sends the archived list to a tokened office only', async () => {
    calls.log.push({ kind: 'archived', sessionId: 'c1', provider: 'codex', archivedAt: 1 });

    dispatch({ type: 'webviewReady' });
    await settle();
    expect(sent.find((m) => m.type === 'archivedSessions')?.sessions).toEqual([
      { sessionId: 'c1', provider: 'codex', archivedAt: 1 },
    ]);

    sent = [];
    dispatch({ type: 'webviewReady' }, ctx({ privileged: false }));
    await settle();
    expect(sent.some((m) => m.type === 'archivedSessions')).toBe(false);
  });

  it('inspects a session for the confirm: git and last message, tokened office only', async () => {
    store.set(5, agent(5, 's1', { provider: 'claude', pid: 4242, status: 'idle', cwd: '/u/kho' }));
    dispatch({ type: 'inspectSession', id: 5 });
    await settle();
    expect(inspected).toEqual(['/u/kho']);
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'sessionInspection',
        id: 5,
        ok: true,
        git: { branch: 'main', changed: 1, unpushed: null },
        lastPrompt: 'Hỏi cuối',
        processes: [],
      }),
    );

    sent = [];
    dispatch({ type: 'inspectSession', id: 5 }, ctx({ privileged: false }));
    await settle();
    expect(sent.some((m) => m.type === 'sessionInspection')).toBe(false);
  });

  it('an unknown agent gets an inspection refusal', async () => {
    dispatch({ type: 'inspectSession', id: 77 });
    await settle();
    expect(sent).toContainEqual({ type: 'sessionInspection', id: 77, ok: false });
  });

  it('archive passes only well-formed stop entries and reports what was stopped', async () => {
    store.set(5, agent(5, 's1', { provider: 'claude', pid: 4242, status: 'idle' }));
    const T = 'Fri Oct 23 12:00:00 2026';
    dispatch({
      type: 'archiveSession',
      id: 5,
      stop: [
        { pid: 900, start: T },
        { pid: -1, start: T },
        { pid: 901 },
        'x',
        { pid: 902, start: T },
      ],
    });
    await settle();
    expect(calls.signals).toEqual([900, 902, 4242]);
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'sessionArchiveResult',
        id: 5,
        ok: true,
        stopped: { done: 2, skipped: 0 },
      }),
    );
  });

  it('deletes archived sessions to the Trash, refuses live and unknown ones', async () => {
    const sid = '0a1b2c3d-1111-2222-3333-444455556666';
    calls.log.push(
      {
        kind: 'archived',
        sessionId: sid,
        provider: 'claude',
        file: `${os.homedir()}/.claude/projects/-u-kho/${sid}.jsonl`,
        archivedAt: 1,
      },
      { kind: 'archived', sessionId: 'live-again', provider: 'codex', archivedAt: 1 },
    );
    dispatch({ type: 'deleteArchived', sessionIds: [sid, 'live-again', 'never-archived'] });
    await settle();
    expect(trashed).toHaveLength(1);
    expect(sent).toContainEqual({
      type: 'archivedDeleteResult',
      total: 3,
      ok: 1,
      items: trashed[0].length,
      refused: { live: 1, unknown: 1 },
    });
    const list = broadcasts.filter((m) => m.type === 'archivedSessions').pop();
    expect((list?.sessions as { sessionId: string }[]).map((e) => e.sessionId)).toEqual([
      'live-again',
    ]);
  });

  it('a read-only office cannot delete', async () => {
    calls.log.push({ kind: 'archived', sessionId: 'c1', provider: 'codex', archivedAt: 1 });
    dispatch({ type: 'deleteArchived', sessionIds: ['c1'] }, ctx({ privileged: false }));
    await settle();
    expect(trashed).toEqual([]);
    expect(sent.some((m) => m.type === 'archivedDeleteResult')).toBe(false);
  });
});
