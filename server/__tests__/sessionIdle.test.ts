import { describe, expect, it } from 'vitest';

import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  lastActivityFromText,
  type SessionMetaIO,
  SessionMetaPoller,
  type SessionRecord,
} from '../src/sessionMeta.js';

/**
 * mptl fork: idle time and dead sessions.
 *
 * Measured 06/11: `statusUpdatedAt` in ~/.claude/sessions is rewritten whenever the
 * Claude app restarts its sessions (every record read 02/11 22:43), and the transcript
 * mtime moves with bookkeeping lines (bridge-session, artifact-autoreact-ledger). Only
 * the timestamp of the last user/assistant line says when the session last did anything.
 */

const LAST_REAL = Date.parse('2026-10-24T10:16:00Z');
const APP_RESTART = Date.parse('2026-11-02T15:43:00Z');

function line(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

describe('lastActivityFromText', () => {
  it('is the timestamp of the last user or assistant line, skipping bookkeeping lines after it', () => {
    const text = [
      line({ type: 'user', timestamp: '2026-10-24T08:33:00Z' }),
      line({ type: 'assistant', timestamp: '2026-10-24T10:16:00Z' }),
      line({ type: 'system', timestamp: '2026-11-02T15:43:00Z' }),
      line({ type: 'bridge-session', timestamp: '2026-11-02T15:43:00Z' }),
      line({ type: 'artifact-autoreact-ledger' }),
      '',
    ].join('\n');
    expect(lastActivityFromText(text)).toBe(LAST_REAL);
  });

  it('survives a cut first line, bad JSON and a bad timestamp; undefined when nothing counts', () => {
    const text = [
      'ssistant","timestamp":"2026-11-05T00:00:00Z"}',
      '{oops',
      line({ type: 'assistant', timestamp: 'nope' }),
    ].join('\n');
    expect(lastActivityFromText(text)).toBeUndefined();
  });
});

function agent(
  id: number,
  sessionId: string,
  extra: Partial<{ providerId: string; leadAgentId: number }> = {},
) {
  const a = createAgentState({
    id,
    sessionId,
    projectDir: '/p',
    jsonlFile: `/p/${sessionId}.jsonl`,
    isExternal: true,
  });
  Object.assign(a, extra);
  return a;
}

function poller(records: SessionRecord[], io: Partial<SessionMetaIO> = {}) {
  const store = new AgentStateStore();
  const p = new SessionMetaPoller(
    store,
    {
      readRecords: async () => records,
      readPs: async () => records.map((r) => `${r.pid} 1 100`).join('\n'),
      ...io,
    },
    '/root/projects',
  );
  return { store, p };
}

describe('SessionMetaPoller idle time', () => {
  const rec = (status: string): SessionRecord => ({
    pid: 10,
    sessionId: 's1',
    cwd: '/Users/seb/kho',
    status,
    statusUpdatedAt: APP_RESTART,
  });

  it('an idle session counts from its last real activity, not from the app restart', async () => {
    const asked: string[] = [];
    const { store, p } = poller([rec('idle')], {
      readLastActivity: async (file) => {
        asked.push(file);
        return LAST_REAL;
      },
    });
    store.set(1, agent(1, 's1'));
    await p.tick();
    expect(asked).toEqual(['/root/projects/-Users-seb-kho/s1.jsonl']);
    expect(store.get(1)?.sessionMeta?.statusSince).toBe(LAST_REAL);
  });

  it('keeps the status time when the transcript is newer, and for a busy session', async () => {
    const later = APP_RESTART + 60_000;
    const a = poller([rec('idle')], { readLastActivity: async () => later });
    a.store.set(1, agent(1, 's1'));
    await a.p.tick();
    expect(a.store.get(1)?.sessionMeta?.statusSince).toBe(APP_RESTART);

    const b = poller([rec('busy')], { readLastActivity: async () => LAST_REAL });
    b.store.set(1, agent(1, 's1'));
    await b.p.tick();
    expect(b.store.get(1)?.sessionMeta?.statusSince).toBe(APP_RESTART);
  });

  it('an unreadable transcript falls back to the status time', async () => {
    const { store, p } = poller([rec('idle')], {
      readLastActivity: async () => {
        throw new Error('EACCES');
      },
    });
    store.set(1, agent(1, 's1'));
    await p.tick();
    expect(store.get(1)?.sessionMeta?.statusSince).toBe(APP_RESTART);
  });
});

describe('SessionMetaPoller dead Claude sessions', () => {
  const OLD = Date.now() - 10 * 60_000;
  const alive: SessionRecord[] = [{ pid: 10, sessionId: 'alive', cwd: '/Users/seb/kho' }];

  function setup(mtime = OLD) {
    const gone: number[] = [];
    const { store, p } = poller(alive, { transcriptMtime: async () => mtime });
    p.onSessionGone((id) => gone.push(id));
    store.set(1, agent(1, 'alive'));
    store.set(2, agent(2, 'dead'));
    store.set(3, agent(3, 'codex-thread', { providerId: 'codex' }));
    store.set(4, agent(4, 'teammate', { leadAgentId: 1 }));
    return { gone, p, store };
  }

  it('removes a Claude character whose process is gone, after two checks in a row', async () => {
    const { gone, p } = setup();
    await p.tick();
    expect(gone).toEqual([]);
    await p.tick();
    expect(gone).toEqual([2]);
  });

  it('never removes Codex threads or teammates, and waits while the transcript is still being written', async () => {
    const recent = setup(Date.now());
    await recent.p.tick();
    await recent.p.tick();
    expect(recent.gone).toEqual([]);
  });

  it('a session that comes back resets the count', async () => {
    const gone: number[] = [];
    const records: SessionRecord[] = [];
    const { store, p } = poller(records, { transcriptMtime: async () => OLD });
    p.onSessionGone((id) => gone.push(id));
    store.set(2, agent(2, 'flaky'));
    await p.tick();
    records.push({ pid: 11, sessionId: 'flaky', cwd: '/x' });
    await p.tick();
    records.length = 0;
    await p.tick();
    expect(gone).toEqual([]);
  });

  it('does not judge anything when the session folder cannot be read', async () => {
    const gone: number[] = [];
    const { store, p } = poller([], {
      readRecords: async () => {
        throw new Error('EACCES');
      },
      transcriptMtime: async () => OLD,
    });
    p.onSessionGone((id) => gone.push(id));
    store.set(2, agent(2, 'dead'));
    await p.tick();
    await p.tick();
    expect(gone).toEqual([]);
  });
});
