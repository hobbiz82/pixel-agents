import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CODEX_RECENT_MS,
  codexRolloutId,
  codexStatusFromLines,
  readCodexSessions,
} from '../src/codexSessions.js';

/** mptl fork: Codex Desktop sessions read from ~/.codex (no hooks needed). */
const ID = '01a1959a-67d5-7261-b369-63d1287ea28a';
const ID2 = '01a185cc-f252-7790-9cba-6da1631f6d86';

function line(type: string, payload: Record<string, unknown>, timestamp: string): string {
  return JSON.stringify({ timestamp, ordinal: 1, type, payload });
}

describe('codexRolloutId', () => {
  it('takes the session id from the rollout file name', () => {
    expect(codexRolloutId(`/x/rollout-2026-11-01T12-34-46-${ID}.jsonl`)).toBe(ID);
  });
  it('rejects files that are not rollouts', () => {
    expect(codexRolloutId('/x/notes.jsonl')).toBeNull();
    expect(codexRolloutId(`/x/rollout-${ID}.txt`)).toBeNull();
  });
});

describe('codexStatusFromLines', () => {
  const started = line('event_msg', { type: 'task_started' }, '2026-11-01T05:57:56.733Z');
  const done = line('event_msg', { type: 'task_complete' }, '2026-11-01T05:58:00.930Z');
  const other = line('event_msg', { type: 'token_count' }, '2026-11-01T08:43:21.742Z');

  it('is idle since the last finished turn, ignoring later bookkeeping lines', () => {
    expect(codexStatusFromLines([started, done, other])).toEqual({
      status: 'idle',
      statusSince: Date.parse('2026-11-01T05:58:00.930Z'),
    });
  });
  it('is busy while a turn has started and not finished', () => {
    expect(codexStatusFromLines([done, started, other])).toEqual({
      status: 'busy',
      statusSince: Date.parse('2026-11-01T05:57:56.733Z'),
    });
  });
  it('knows nothing when the tail has no turn events or only garbage', () => {
    expect(codexStatusFromLines([other, '{not json', ''])).toEqual({});
  });
});

describe('readCodexSessions', () => {
  let root: string;
  const now = Date.parse('2026-11-01T09:00:00Z');

  function rollout(
    day: string,
    id: string,
    cwd: string,
    ageMs: number,
    extra: string[],
    metaExtra: Record<string, unknown> = {},
  ): string {
    const dir = path.join(root, 'sessions', '2026', '11', day);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-11-${day}T10-00-00-${id}.jsonl`);
    // session_meta carries ~20 KB of base instructions in real files.
    const meta = line(
      'session_meta',
      { id, cwd, base_instructions: 'x'.repeat(30_000), ...metaExtra },
      '2026-11-01T01:00:00Z',
    );
    fs.writeFileSync(file, [meta, ...extra].join('\n') + '\n');
    const t = (now - ageMs) / 1000;
    fs.utimesSync(file, t, t);
    return file;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-codex-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('skips Codex sub-agent threads such as Guardian review; they belong to a parent thread', async () => {
    rollout('01', ID, '/Users/seb/mptl-kho', 60_000, [], { source: 'vscode' });
    rollout('01', ID2, '/Users/seb/mptl-kho', 60_000, [], {
      source: { subagent: { other: 'guardian' } },
      parent_thread_id: ID,
    });
    const sessions = await readCodexSessions(root, now);
    expect(sessions.map((s) => s.sessionId)).toEqual([ID]);
  });

  it('lists sessions written in the recent window with cwd, name and status', async () => {
    const file = rollout('01', ID, '/Users/seb/novaceu-hub', 3_600_000, [
      line('event_msg', { type: 'task_started' }, '2026-11-01T05:57:56Z'),
      line('event_msg', { type: 'task_complete' }, '2026-11-01T05:58:00Z'),
    ]);
    fs.writeFileSync(
      path.join(root, 'session_index.jsonl'),
      [
        JSON.stringify({ id: ID, thread_name: 'Tên cũ', updated_at: 'a' }),
        JSON.stringify({ id: ID, thread_name: 'Hub — quyền', updated_at: 'b' }),
      ].join('\n') + '\n',
    );
    const out = await readCodexSessions(root, now);
    expect(out).toEqual([
      {
        sessionId: ID,
        file,
        cwd: '/Users/seb/novaceu-hub',
        name: 'Hub — quyền',
        status: 'idle',
        statusSince: Date.parse('2026-11-01T05:58:00Z'),
      },
    ]);
  });

  it('leaves out sessions older than the window', async () => {
    rollout('01', ID, '/a', CODEX_RECENT_MS + 60_000, []);
    rollout('01', ID2, '/b', 60_000, []);
    const out = await readCodexSessions(root, now);
    expect(out.map((s) => s.sessionId)).toEqual([ID2]);
    expect(out[0].name).toBeUndefined();
  });

  it('returns nothing when Codex is not installed', async () => {
    expect(await readCodexSessions(path.join(root, 'missing'), now)).toEqual([]);
  });
});
