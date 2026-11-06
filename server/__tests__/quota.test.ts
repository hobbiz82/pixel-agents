import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  claudeQuotaFromStatusInput,
  codexQuotaFromLines,
  dropExpired,
  quotaMessage,
  QuotaPoller,
  readClaudeQuota,
  readCodexQuota,
  statusLineText,
  writeClaudeQuota,
} from '../src/quota.js';

/** mptl fork (Đ3): Claude + Codex usage limits for the quota panel. */
const ID = '01a1959a-67d5-7261-b369-63d1287ea28a';
const ID2 = '01a185cc-f252-7790-9cba-6da1631f6d86';

function tokenCount(timestamp: string, primary: number, secondary: number): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        limit_name: null,
        primary: { used_percent: primary, window_minutes: 300, resets_at: 1_793_962_594 },
        secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 1_794_379_086 },
      },
    },
  });
}

describe('codexQuotaFromLines', () => {
  it('takes the last token_count rate limits, 5-hour and weekly by window length', () => {
    const lines = [
      tokenCount('2026-11-06T08:00:00.000Z', 3, 30),
      '{not json',
      tokenCount('2026-11-06T09:00:00.000Z', 7, 32),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }),
    ];
    expect(codexQuotaFromLines(lines)).toEqual({
      fiveHour: { usedPercent: 7, resetsAt: 1_793_962_594_000 },
      sevenDay: { usedPercent: 32, resetsAt: 1_794_379_086_000 },
      updatedAt: Date.parse('2026-11-06T09:00:00.000Z'),
    });
  });
  it('skips a token_count without rate limits and knows nothing from garbage', () => {
    const bare = JSON.stringify({
      timestamp: '2026-11-06T10:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: null, rate_limits: null },
    });
    expect(
      codexQuotaFromLines([tokenCount('2026-11-06T09:00:00.000Z', 7, 32), bare]),
    ).toMatchObject({ fiveHour: { usedPercent: 7 } });
    expect(codexQuotaFromLines(['', '{x', bare])).toBeNull();
  });
  it('ignores a window with a missing or non-numeric percentage', () => {
    const odd = JSON.stringify({
      timestamp: '2026-11-06T09:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          primary: { used_percent: 'lots', window_minutes: 300, resets_at: 1 },
          secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1_794_379_086 },
        },
      },
    });
    expect(codexQuotaFromLines([odd])).toEqual({
      sevenDay: { usedPercent: 12, resetsAt: 1_794_379_086_000 },
      updatedAt: Date.parse('2026-11-06T09:00:00.000Z'),
    });
  });
});

describe('claudeQuotaFromStatusInput', () => {
  const now = Date.parse('2026-11-06T09:00:00Z');
  it('reads the status line rate_limits (percent 0-100, resets_at in epoch seconds)', () => {
    expect(
      claudeQuotaFromStatusInput(
        {
          session_id: 'abc',
          rate_limits: {
            five_hour: { used_percentage: 23.5, resets_at: 1_793_970_000 },
            seven_day: { used_percentage: 41.2, resets_at: 1_794_400_000 },
          },
        },
        now,
      ),
    ).toEqual({
      fiveHour: { usedPercent: 23.5, resetsAt: 1_793_970_000_000 },
      sevenDay: { usedPercent: 41.2, resetsAt: 1_794_400_000_000 },
      updatedAt: now,
    });
  });
  it('is null when the input carries no rate limits (API key or first response not yet in)', () => {
    expect(claudeQuotaFromStatusInput({ session_id: 'abc' }, now)).toBeNull();
    expect(claudeQuotaFromStatusInput(null, now)).toBeNull();
    expect(claudeQuotaFromStatusInput({ rate_limits: { five_hour: {} } }, now)).toBeNull();
  });
});

describe('dropExpired', () => {
  it('drops a window whose reset time has passed, and the whole quota when none is left', () => {
    const q = {
      fiveHour: { usedPercent: 90, resetsAt: 1_000 },
      sevenDay: { usedPercent: 40, resetsAt: 5_000 },
      updatedAt: 500,
    };
    expect(dropExpired(q, 2_000)).toEqual({ sevenDay: q.sevenDay, updatedAt: 500 });
    expect(dropExpired(q, 6_000)).toBeNull();
    expect(dropExpired(null, 0)).toBeNull();
  });
});

describe('readCodexQuota / readClaudeQuota', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-quota-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function rollout(day: string, id: string, lines: string[], mtime: number): void {
    const dir = path.join(root, 'sessions', ...day.split('-'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-${day}T01-02-03-${id}.jsonl`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
  }

  it('reads the newest rollout that has rate limits, archived ones included', async () => {
    const t = Date.parse('2026-11-06T09:00:00Z');
    rollout('2026-11-05', ID, [tokenCount('2026-11-05T09:00:00.000Z', 50, 60)], t - 86_400_000);
    // newest file has no token_count yet: fall back to the older one
    rollout('2026-11-06', ID2, [JSON.stringify({ type: 'session_meta', payload: {} })], t);
    expect(await readCodexQuota(root)).toMatchObject({ fiveHour: { usedPercent: 50 } });
    const arch = path.join(root, 'archived_sessions');
    fs.mkdirSync(arch, { recursive: true });
    const f = path.join(arch, `rollout-2026-11-06T02-00-00-${ID2.replace('01a1', '01a2')}.jsonl`);
    fs.writeFileSync(f, tokenCount('2026-11-06T10:00:00.000Z', 9, 33) + '\n');
    fs.utimesSync(f, t / 1000 + 60, t / 1000 + 60);
    expect(await readCodexQuota(root)).toMatchObject({ fiveHour: { usedPercent: 9 } });
  });

  it('is null for a missing ~/.codex', async () => {
    expect(await readCodexQuota(path.join(root, 'nope'))).toBeNull();
  });

  it('reads the Claude quota file and rejects a malformed one', async () => {
    const file = path.join(root, 'claude-quota.json');
    expect(await readClaudeQuota(file)).toBeNull();
    fs.writeFileSync(file, '{"fiveHour":{"usedPercent":"x"}}');
    expect(await readClaudeQuota(file)).toBeNull();
    const q = { fiveHour: { usedPercent: 12, resetsAt: 9e12 }, updatedAt: 1 };
    fs.writeFileSync(file, JSON.stringify(q));
    expect(await readClaudeQuota(file)).toEqual(q);
  });
});

describe('QuotaPoller', () => {
  it('broadcasts only when the quota changed, and keeps a snapshot for late clients', async () => {
    const sent: Record<string, unknown>[] = [];
    let codexPct = 7;
    const poller = new QuotaPoller((m) => sent.push(m), {
      readClaude: async () => null,
      readCodex: async () => ({
        fiveHour: { usedPercent: codexPct, resetsAt: 9e12 },
        updatedAt: 1,
      }),
      now: () => 0,
    });
    await poller.tick();
    await poller.tick();
    expect(sent).toHaveLength(1);
    codexPct = 8;
    await poller.tick();
    expect(sent).toHaveLength(2);
    expect(poller.snapshot()).toEqual(
      quotaMessage(null, { fiveHour: { usedPercent: 8, resetsAt: 9e12 }, updatedAt: 1 }),
    );
  });
  it('keeps the other provider when one read throws', async () => {
    const sent: Record<string, unknown>[] = [];
    const poller = new QuotaPoller((m) => sent.push(m), {
      readClaude: async () => {
        throw new Error('boom');
      },
      readCodex: async () => ({ sevenDay: { usedPercent: 1, resetsAt: 9e12 }, updatedAt: 1 }),
      now: () => 0,
    });
    await poller.tick();
    expect(sent[0]).toEqual({
      type: 'quotaStatus',
      codex: { sevenDay: { usedPercent: 1, resetsAt: 9e12 }, updatedAt: 1 },
    });
  });
});

describe('status line writer helpers', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-qline-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints a short line, rounding percentages, and nothing without a reading', () => {
    expect(
      statusLineText({
        fiveHour: { usedPercent: 23.5, resetsAt: 1 },
        sevenDay: { usedPercent: 41.2, resetsAt: 1 },
        updatedAt: 0,
      }),
    ).toBe('5h 24% · 7d 41%');
    expect(statusLineText({ sevenDay: { usedPercent: 3, resetsAt: 1 }, updatedAt: 0 })).toBe(
      '7d 3%',
    );
    expect(statusLineText(null)).toBe('');
  });

  it('writes the quota file atomically (owner-only) and it reads back', async () => {
    const file = path.join(dir, 'sub', 'claude-quota.json');
    const q = { fiveHour: { usedPercent: 5, resetsAt: 9e12 }, updatedAt: 7 };
    writeClaudeQuota(file, q);
    expect(await readClaudeQuota(file)).toEqual(q);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['claude-quota.json']);
  });
});
