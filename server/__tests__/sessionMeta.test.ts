import { describe, expect, it } from 'vitest';

import { resendAgentActivity } from '../src/agentActivityResend.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import type { CodexSession } from '../src/codexSessions.js';
import {
  buildSessionMetas,
  parsePsTree,
  parseSessionRecord,
  sameMeta,
  SessionMetaPoller,
  type SessionRecord,
  transcriptPathFor,
} from '../src/sessionMeta.js';

const KB = 1024;

function agent(id: number, sessionId: string) {
  return createAgentState({
    id,
    sessionId,
    projectDir: '/p',
    jsonlFile: `/p/${sessionId}.jsonl`,
    isExternal: true,
  });
}

describe('parseSessionRecord', () => {
  it('reads the fields Claude Code writes to ~/.claude/sessions/<pid>.json', () => {
    expect(
      parseSessionRecord({
        pid: 4242,
        sessionId: 's1',
        name: 'MAC - SPEAKR setup',
        cwd: '/Users/seb/local-ai-system',
        status: 'idle',
        statusUpdatedAt: 1000,
        messagingSocketPath: '/tmp/x.sock',
      }),
    ).toEqual({
      pid: 4242,
      sessionId: 's1',
      name: 'MAC - SPEAKR setup',
      cwd: '/Users/seb/local-ai-system',
      status: 'idle',
      statusUpdatedAt: 1000,
    });
  });

  it('rejects a record without a numeric pid or a session id', () => {
    expect(parseSessionRecord({ sessionId: 's1' })).toBeNull();
    expect(parseSessionRecord({ pid: '12', sessionId: 's1' })).toBeNull();
    expect(parseSessionRecord({ pid: 12 })).toBeNull();
    expect(parseSessionRecord(null)).toBeNull();
    expect(parseSessionRecord('x')).toBeNull();
  });

  it('drops optional fields of the wrong type instead of passing them on', () => {
    expect(
      parseSessionRecord({ pid: 1, sessionId: 's', name: 7, statusUpdatedAt: 'later' }),
    ).toEqual({
      pid: 1,
      sessionId: 's',
    });
  });
});

describe('parsePsTree', () => {
  it('sums each process with all of its descendants, in bytes', () => {
    const out = [
      '  100     1  1000',
      '  200   100   500',
      '  300   200   250',
      '  400     1    10',
    ].join('\n');
    const rss = parsePsTree(out);
    expect(rss.get(100)).toBe((1000 + 500 + 250) * KB);
    expect(rss.get(200)).toBe((500 + 250) * KB);
    expect(rss.get(400)).toBe(10 * KB);
  });

  it('ignores junk lines and survives a process that names itself as parent', () => {
    const rss = parsePsTree('garbage\n  7  7  100\n\n  8  7  50\n');
    expect(rss.get(7)).toBe(150 * KB);
    expect(rss.get(8)).toBe(50 * KB);
  });
});

describe('buildSessionMetas', () => {
  const rss = new Map([
    [10, 2000 * KB],
    [20, 300 * KB],
  ]);

  it('keeps only sessions whose process is still alive', () => {
    const records: SessionRecord[] = [
      { pid: 10, sessionId: 'alive', name: 'A', status: 'busy', statusUpdatedAt: 5 },
      { pid: 99, sessionId: 'dead', name: 'B' },
    ];
    const metas = buildSessionMetas(records, rss);
    expect([...metas.keys()]).toEqual(['alive']);
    expect(metas.get('alive')).toEqual({
      provider: 'claude',
      pid: 10,
      name: 'A',
      rssBytes: 2000 * KB,
      status: 'busy',
      statusSince: 5,
    });
  });

  it('when two live records share a session id, the most recently updated wins', () => {
    const metas = buildSessionMetas(
      [
        { pid: 10, sessionId: 's', name: 'old', statusUpdatedAt: 1 },
        { pid: 20, sessionId: 's', name: 'new', statusUpdatedAt: 2 },
      ],
      rss,
    );
    expect(metas.get('s')?.name).toBe('new');
    expect(metas.get('s')?.pid).toBe(20);
  });
});

describe('sameMeta', () => {
  const base = { pid: 1, name: 'A', rssBytes: 1000 * KB, status: 'idle', statusSince: 5 };
  it('treats small RAM drift as unchanged so the UI is not re-sent every tick', () => {
    expect(sameMeta(base, { ...base, rssBytes: 1040 * KB })).toBe(true);
  });
  it('flags a RAM change of 5 % or more, and any change of name, status or pid', () => {
    expect(sameMeta(base, { ...base, rssBytes: 1060 * KB })).toBe(false);
    expect(sameMeta(base, { ...base, name: 'B' })).toBe(false);
    expect(sameMeta(base, { ...base, status: 'busy', statusSince: 9 })).toBe(false);
    expect(sameMeta(base, { ...base, pid: 2 })).toBe(false);
    expect(sameMeta(undefined, base)).toBe(false);
  });
});

describe('SessionMetaPoller', () => {
  function setup(records: SessionRecord[], psOut: string) {
    const store = new AgentStateStore();
    store.set(1, agent(1, 's1'));
    store.set(2, agent(2, 'no-session-file'));
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));
    const io = { records, psOut };
    const poller = new SessionMetaPoller(store, {
      readRecords: async () => io.records,
      readPs: async () => io.psOut,
    });
    return { store, sent, io, poller };
  }

  it('attaches name, RAM and status to the matching agent and broadcasts it once', async () => {
    const { store, sent, poller } = setup(
      [{ pid: 10, sessionId: 's1', name: 'Kho', status: 'idle', statusUpdatedAt: 7 }],
      '10 1 2048',
    );
    await poller.tick();
    expect(store.get(1)?.sessionMeta).toEqual({
      provider: 'claude',
      pid: 10,
      name: 'Kho',
      rssBytes: 2048 * KB,
      status: 'idle',
      statusSince: 7,
    });
    expect(store.get(2)?.sessionMeta).toBeUndefined();
    expect(sent).toEqual([
      {
        type: 'agentSessionMeta',
        id: 1,
        provider: 'claude',
        pid: 10,
        name: 'Kho',
        rssBytes: 2048 * KB,
        status: 'idle',
        statusSince: 7,
      },
    ]);

    await poller.tick();
    expect(sent).toHaveLength(1);
  });

  it('re-broadcasts when the session changes', async () => {
    const { sent, io, poller } = setup(
      [{ pid: 10, sessionId: 's1', name: 'Kho', status: 'idle', statusUpdatedAt: 7 }],
      '10 1 2048',
    );
    await poller.tick();
    io.records = [{ pid: 10, sessionId: 's1', name: 'Kho', status: 'busy', statusUpdatedAt: 9 }];
    await poller.tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ status: 'busy', statusSince: 9 });
  });

  it('a failing ps or unreadable session folder leaves agents untouched', async () => {
    const store = new AgentStateStore();
    store.set(1, agent(1, 's1'));
    const poller = new SessionMetaPoller(store, {
      readRecords: async () => {
        throw new Error('EACCES');
      },
      readPs: async () => '10 1 1',
    });
    await expect(poller.tick()).resolves.toBeUndefined();
    expect(store.get(1)?.sessionMeta).toBeUndefined();
  });
});

describe('resendAgentActivity', () => {
  it('replays session meta to a client that connects later', () => {
    const store = new AgentStateStore();
    const a = agent(1, 's1');
    a.sessionMeta = { pid: 10, name: 'Kho', rssBytes: 5, status: 'idle', statusSince: 7 };
    store.set(1, a);
    const sent: Record<string, unknown>[] = [];
    resendAgentActivity((m) => sent.push(m), store);
    expect(sent).toContainEqual({
      type: 'agentSessionMeta',
      id: 1,
      pid: 10,
      name: 'Kho',
      rssBytes: 5,
      status: 'idle',
      statusSince: 7,
    });
  });
});

describe('transcriptPathFor', () => {
  it('maps cwd to the Claude projects folder the way Claude Code names it', () => {
    expect(
      transcriptPathFor('/home/u/.claude/projects', {
        pid: 1,
        sessionId: 'abc',
        cwd: '/Users/seb/Desktop/my-project/lab_manager/.claude/worktrees/x',
      }),
    ).toBe(
      '/home/u/.claude/projects/-Users-seb-Desktop-my-project-lab-manager--claude-worktrees-x/abc.jsonl',
    );
  });
  it('returns null without a cwd', () => {
    expect(transcriptPathFor('/r', { pid: 1, sessionId: 'abc' })).toBeNull();
  });
});

describe('SessionMetaPoller.liveSessions', () => {
  it('lists the transcript and cwd of every live session after a tick', async () => {
    const store = new AgentStateStore();
    const poller = new SessionMetaPoller(
      store,
      {
        readRecords: async () => [
          { pid: 10, sessionId: 'live', cwd: '/Users/seb/kho' },
          { pid: 99, sessionId: 'dead', cwd: '/Users/seb/old' },
        ],
        readPs: async () => '10 1 100',
      },
      '/root/projects',
    );
    expect(poller.liveSessions()).toEqual([]);
    await poller.tick();
    expect(poller.liveSessions()).toEqual([
      {
        file: '/root/projects/-Users-seb-kho/live.jsonl',
        cwd: '/Users/seb/kho',
        sessionId: 'live',
        provider: 'claude',
      },
    ]);
  });
});

describe('SessionMetaPoller with Codex sessions', () => {
  const CODEX_ID = '01a1959a-67d5-7261-b369-63d1287ea28a';
  const codexFile = `/c/sessions/2026/11/01/rollout-2026-11-01T12-34-46-${CODEX_ID}.jsonl`;

  function setup(readCodex: () => Promise<CodexSession[]>) {
    const store = new AgentStateStore();
    store.set(1, agent(1, 's1'));
    store.set(2, agent(2, CODEX_ID));
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));
    const poller = new SessionMetaPoller(
      store,
      {
        readRecords: async () => [{ pid: 10, sessionId: 's1', cwd: '/Users/seb/kho' }],
        readPs: async () => '10 1 100',
        readCodex,
      },
      '/root/projects',
    );
    return { store, sent, poller };
  }

  it('tags Codex sessions as codex, with name and status but no pid or RAM', async () => {
    const { store, sent, poller } = setup(async () => [
      {
        sessionId: CODEX_ID,
        file: codexFile,
        cwd: '/Users/seb/novaceu-hub',
        name: 'Hub — quyền',
        status: 'idle',
        statusSince: 5,
      },
    ]);
    await poller.tick();
    expect(store.get(2)?.sessionMeta).toEqual({
      provider: 'codex',
      name: 'Hub — quyền',
      status: 'idle',
      statusSince: 5,
    });
    expect(store.get(1)?.sessionMeta?.provider).toBe('claude');
    expect(sent.find((m) => m.id === 2)).toEqual({
      type: 'agentSessionMeta',
      id: 2,
      provider: 'codex',
      name: 'Hub — quyền',
      status: 'idle',
      statusSince: 5,
    });
    expect(poller.liveSessions()).toContainEqual({
      file: codexFile,
      cwd: '/Users/seb/novaceu-hub',
      sessionId: CODEX_ID,
      provider: 'codex',
    });
  });

  it('a broken Codex folder does not hide the Claude sessions', async () => {
    const { store, poller } = setup(async () => {
      throw new Error('EACCES');
    });
    await poller.tick();
    expect(store.get(1)?.sessionMeta?.provider).toBe('claude');
    expect(store.get(2)?.sessionMeta).toBeUndefined();
    expect(poller.liveSessions()).toHaveLength(1);
  });

  it('sameMeta compares metas without RAM', () => {
    const m = { provider: 'codex' as const, name: 'a', status: 'idle', statusSince: 1 };
    expect(sameMeta(m, { ...m })).toBe(true);
    expect(sameMeta(m, { ...m, status: 'busy' })).toBe(false);
  });
});
