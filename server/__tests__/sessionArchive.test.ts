import { describe, expect, it } from 'vitest';

import {
  type ArchiveIO,
  type ArchiveLogEvent,
  archiveSession,
  codexBinary,
  foldArchiveLog,
  MAX_STOP,
  restoreSession,
} from '../src/sessionArchive.js';

const START = 'Fri Oct 23 11:05:24 2026';

/** In-memory IO: one Claude process (pid 4242) and a codex CLI that records calls. */
function fakeIO(over: Partial<ArchiveIO> = {}) {
  const calls = {
    signals: [] as number[],
    codex: [] as string[][],
    log: [] as ArchiveLogEvent[],
    verified: [] as number[][],
  };
  const io: ArchiveIO = {
    readClaudeRecord: async (pid) =>
      pid === 4242
        ? {
            pid: 4242,
            sessionId: 's1',
            status: 'idle',
            waitingFor: null,
            procStart: START,
            entrypoint: 'claude-desktop',
          }
        : null,
    processStart: async (pid) => (pid === 4242 ? START : null),
    processName: async (pid) => (pid === 4242 ? '/Users/seb/.local/bin/claude' : null),
    signal: (pid) => calls.signals.push(pid),
    runCodex: async (args) => {
      calls.codex.push(args);
    },
    appendLog: async (e) => {
      calls.log.push(e);
    },
    readLog: async () => calls.log,
    now: () => 1_000,
    verifyStops: async (_pid, picked) => {
      calls.verified.push(picked.map((x) => x.pid));
      return picked.map((x) => x.pid).filter((p) => p !== 666);
    },
    ...over,
  };
  return { io, calls };
}

const claudeTarget = {
  sessionId: 's1',
  folder: 'local-ai-system',
  cwd: '/Users/seb/local-ai-system',
  meta: { provider: 'claude' as const, pid: 4242, name: 'MAC - Speakr', status: 'idle' },
};

const codexTarget = {
  sessionId: '019a-codex',
  folder: 'mptl-kho',
  cwd: '/Users/seb/mptl-kho',
  meta: { provider: 'codex' as const, name: 'Kho ads', status: 'idle' },
};

describe('archiveSession — Claude', () => {
  it('stops an idle session with SIGTERM to its own pid and logs who/what/when', async () => {
    const { io, calls } = fakeIO();
    const out = await archiveSession(claudeTarget, io);
    expect(out).toEqual({
      ok: true,
      entry: {
        sessionId: 's1',
        provider: 'claude',
        name: 'MAC - Speakr',
        folder: 'local-ai-system',
        cwd: '/Users/seb/local-ai-system',
        entrypoint: 'claude-desktop',
        archivedAt: 1_000,
      },
    });
    expect(calls.signals).toEqual([4242]);
    expect(calls.log).toEqual([{ kind: 'archived', ...(out.ok ? out.entry : {}) }]);
  });

  it.each([
    ['busy', { status: 'busy' }],
    ['waiting', { status: 'waiting' }],
    ['waiting', { status: 'idle', waitingFor: 'permission' }],
  ])('refuses (%s) when the fresh record says the session is working', async (reason, extra) => {
    const { io, calls } = fakeIO({
      readClaudeRecord: async () => ({
        pid: 4242,
        sessionId: 's1',
        procStart: START,
        ...extra,
      }),
    });
    expect(await archiveSession(claudeTarget, io)).toEqual({ ok: false, reason });
    expect(calls.signals).toEqual([]);
    expect(calls.log).toEqual([]);
  });

  it('refuses from the cached meta before touching the process', async () => {
    const { io, calls } = fakeIO();
    const out = await archiveSession(
      { ...claudeTarget, meta: { ...claudeTarget.meta, status: 'busy' } },
      io,
    );
    expect(out).toEqual({ ok: false, reason: 'busy' });
    expect(calls.signals).toEqual([]);
  });

  it('never signals a pid that now belongs to another session or process', async () => {
    const cases: Partial<ArchiveIO>[] = [
      // record gone (session ended on its own)
      { readClaudeRecord: async () => null },
      // pid reused by a different Claude session
      {
        readClaudeRecord: async () => ({ pid: 4242, sessionId: 'other', procStart: START }),
      },
      // same record, but the process started at another time (pid reused)
      { processStart: async () => 'Mon Nov  2 09:00:00 2026' },
      // record without a start time: cannot prove identity
      {
        readClaudeRecord: async () => ({ pid: 4242, sessionId: 's1', status: 'idle' }),
      },
      // process is not claude
      { processName: async () => '/usr/bin/vim' },
    ];
    for (const over of cases) {
      const { io, calls } = fakeIO(over);
      expect(await archiveSession(claudeTarget, io)).toEqual({
        ok: false,
        reason: 'process_changed',
      });
      expect(calls.signals).toEqual([]);
    }
  });

  it('refuses a Claude agent without a pid', async () => {
    const { io, calls } = fakeIO();
    const out = await archiveSession(
      { ...claudeTarget, meta: { provider: 'claude' as const, name: 'x' } },
      io,
    );
    expect(out).toEqual({ ok: false, reason: 'unknown' });
    expect(calls.signals).toEqual([]);
  });

  it('reports failed (and logs nothing) when the signal throws', async () => {
    const { io, calls } = fakeIO({
      signal: () => {
        throw new Error('EPERM');
      },
    });
    expect(await archiveSession(claudeTarget, io)).toEqual({ ok: false, reason: 'failed' });
    expect(calls.log).toEqual([]);
  });
});

describe('archiveSession — Codex', () => {
  it('runs `codex archive <id>` and logs', async () => {
    const { io, calls } = fakeIO();
    const out = await archiveSession(codexTarget, io);
    expect(out.ok).toBe(true);
    expect(calls.codex).toEqual([['archive', '019a-codex']]);
    expect(calls.signals).toEqual([]);
    expect(calls.log.map((e) => e.kind)).toEqual(['archived']);
  });

  it('refuses a running turn', async () => {
    const { io, calls } = fakeIO();
    const out = await archiveSession(
      { ...codexTarget, meta: { ...codexTarget.meta, status: 'busy' } },
      io,
    );
    expect(out).toEqual({ ok: false, reason: 'busy' });
    expect(calls.codex).toEqual([]);
  });

  it('reports failed when the codex CLI fails', async () => {
    const { io, calls } = fakeIO({
      runCodex: async () => {
        throw new Error('exit 1');
      },
    });
    expect(await archiveSession(codexTarget, io)).toEqual({ ok: false, reason: 'failed' });
    expect(calls.log).toEqual([]);
  });

  it('refuses an agent with no known tool', async () => {
    const { io } = fakeIO();
    expect(await archiveSession({ sessionId: 'x' }, io)).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });
});

describe('restoreSession', () => {
  it('Codex: runs `codex unarchive <id>` then logs the restore', async () => {
    const { io, calls } = fakeIO();
    const out = await restoreSession({ sessionId: '019a-codex', provider: 'codex' }, io);
    expect(out).toEqual({ ok: true });
    expect(calls.codex).toEqual([['unarchive', '019a-codex']]);
    expect(calls.log).toEqual([{ kind: 'restored', sessionId: '019a-codex', restoredAt: 1_000 }]);
  });

  it('Claude: only logs (anh reopens it in the Claude app or with claude --resume)', async () => {
    const { io, calls } = fakeIO();
    expect(await restoreSession({ sessionId: 's1', provider: 'claude' }, io)).toEqual({ ok: true });
    expect(calls.codex).toEqual([]);
    expect(calls.signals).toEqual([]);
    expect(calls.log).toEqual([{ kind: 'restored', sessionId: 's1', restoredAt: 1_000 }]);
  });

  it('Codex: a failed unarchive keeps the session in the archive list', async () => {
    const { io, calls } = fakeIO({
      runCodex: async () => {
        throw new Error('exit 1');
      },
    });
    expect(await restoreSession({ sessionId: 'c', provider: 'codex' }, io)).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(calls.log).toEqual([]);
  });
});

describe('foldArchiveLog', () => {
  it('lists archived sessions newest first, minus later restores', () => {
    const list = foldArchiveLog([
      { kind: 'archived', sessionId: 'a', provider: 'claude', archivedAt: 1 },
      { kind: 'archived', sessionId: 'b', provider: 'codex', archivedAt: 2 },
      { kind: 'restored', sessionId: 'a', restoredAt: 3 },
      { kind: 'archived', sessionId: 'c', provider: 'claude', archivedAt: 4 },
    ]);
    expect(list.map((e) => e.sessionId)).toEqual(['c', 'b']);
  });

  it('a session archived again after a restore is listed again', () => {
    const list = foldArchiveLog([
      { kind: 'archived', sessionId: 'a', provider: 'claude', archivedAt: 1 },
      { kind: 'restored', sessionId: 'a', restoredAt: 2 },
      { kind: 'archived', sessionId: 'a', provider: 'claude', archivedAt: 3 },
    ]);
    expect(list).toEqual([{ sessionId: 'a', provider: 'claude', archivedAt: 3 }]);
  });

  it('skips malformed lines', () => {
    const list = foldArchiveLog([
      { kind: 'archived', sessionId: '', provider: 'claude', archivedAt: 1 },
      { kind: 'nope' } as unknown as ArchiveLogEvent,
      { kind: 'archived', sessionId: 'ok', provider: 'codex', archivedAt: 2 },
    ]);
    expect(list.map((e) => e.sessionId)).toEqual(['ok']);
  });
});

describe('codexBinary', () => {
  it('prefers PIXEL_AGENTS_CODEX_BIN', () => {
    expect(codexBinary({ PIXEL_AGENTS_CODEX_BIN: '/opt/codex' }, '/h', () => true)).toBe(
      '/opt/codex',
    );
  });

  it('finds ~/.local/bin/codex when launchd PATH has no codex', () => {
    expect(codexBinary({}, '/Users/seb', (p) => p === '/Users/seb/.local/bin/codex')).toBe(
      '/Users/seb/.local/bin/codex',
    );
  });

  it('falls back to plain `codex` on PATH', () => {
    expect(codexBinary({}, '/h', () => false)).toBe('codex');
  });
});

describe('defaultArchiveIO.processStart', () => {
  it('reads the start time in UTC, the zone Claude writes procStart in', async () => {
    const { defaultArchiveIO } = await import('../src/sessionArchive.js');
    const start = await defaultArchiveIO().processStart(process.pid);
    expect(start).toBeTruthy();
    // "Fri Oct 23 11:05:24 2026" read as UTC must be when this test process started.
    const parsed = Date.parse(`${start} UTC`);
    const actual = Date.now() - process.uptime() * 1000;
    expect(Math.abs(parsed - actual)).toBeLessThan(5_000);
  });
});

describe('archiveSession — stopping what the session started', () => {
  const T = 'Fri Oct 23 12:00:00 2026';
  const stop = [
    { pid: 500, start: T },
    { pid: 666, start: T },
    { pid: 501, start: T },
  ];

  it('stops the re-checked processes first, then the session, and counts the rest', async () => {
    const { io, calls } = fakeIO();
    const out = await archiveSession({ ...claudeTarget, stop }, io);
    expect(calls.verified).toEqual([[500, 666, 501]]);
    expect(calls.signals).toEqual([500, 501, 4242]);
    expect(out.ok && out.stopped).toEqual({ done: 2, skipped: 1 });
  });

  it('touches nothing when the session itself fails its identity check', async () => {
    const { io, calls } = fakeIO({ processStart: async () => 'Sat Oct 24 00:00:00 2026' });
    const out = await archiveSession({ ...claudeTarget, stop }, io);
    expect(out).toEqual({ ok: false, reason: 'process_changed' });
    expect(calls.verified).toEqual([]);
    expect(calls.signals).toEqual([]);
  });

  it('a process that cannot be signalled is skipped; the session is still archived', async () => {
    const { io, calls } = fakeIO({
      signal: (pid) => {
        if (pid === 500) throw new Error('ESRCH');
        calls.signals.push(pid);
      },
    });
    const out = await archiveSession({ ...claudeTarget, stop }, io);
    expect(calls.signals).toEqual([501, 4242]);
    expect(out.ok && out.stopped).toEqual({ done: 1, skipped: 2 });
  });

  it('caps the list it is willing to stop', async () => {
    const { io, calls } = fakeIO();
    const many = Array.from({ length: 60 }, (_, i) => ({ pid: 1000 + i, start: T }));
    await archiveSession({ ...claudeTarget, stop: many }, io);
    expect(calls.verified[0]).toHaveLength(MAX_STOP);
  });

  it('Codex ignores a stop list (one shared app)', async () => {
    const { io, calls } = fakeIO();
    const out = await archiveSession({ ...codexTarget, stop }, io);
    expect(out.ok).toBe(true);
    expect(calls.verified).toEqual([]);
    expect(calls.signals).toEqual([]);
  });
});
