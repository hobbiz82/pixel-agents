import { describe, expect, it } from 'vitest';

import {
  parseAssistSettings,
  parsePermissionRequests,
  parseQuotaStatus,
  quotaLevel,
  readingLabel,
  remainingPercent,
  resetLabel,
  secondsLeft,
  worstPercent,
} from '../src/office/assistView.js';

/** mptl fork (Đ3): quota panel + permission cards, view logic. */

describe('parseQuotaStatus', () => {
  it('keeps well-formed windows and the reader state', () => {
    expect(
      parseQuotaStatus({
        type: 'quotaStatus',
        claude: { fiveHour: { usedPercent: 23.5, resetsAt: 10 }, updatedAt: 1 },
        codex: {
          fiveHour: { usedPercent: 'x', resetsAt: 1 },
          sevenDay: { usedPercent: 32, resetsAt: 20 },
          updatedAt: 2,
        },
        claudeReader: 'ours',
      }),
    ).toEqual({
      claude: { fiveHour: { usedPercent: 23.5, resetsAt: 10 }, updatedAt: 1 },
      codex: { sevenDay: { usedPercent: 32, resetsAt: 20 }, updatedAt: 2 },
      claudeReader: 'ours',
    });
  });
  it('treats a missing or unknown reader as none and drops empty providers', () => {
    expect(
      parseQuotaStatus({ type: 'quotaStatus', codex: { updatedAt: 1 }, claudeReader: 'x' }),
    ).toEqual({ claudeReader: 'none' });
  });
});

describe('worstPercent / quotaLevel', () => {
  it('is the highest window across tools, or null without readings', () => {
    expect(
      worstPercent({
        claude: { fiveHour: { usedPercent: 23, resetsAt: 1 }, updatedAt: 0 },
        codex: { sevenDay: { usedPercent: 71.6, resetsAt: 1 }, updatedAt: 0 },
        claudeReader: 'ours',
      }),
    ).toBe(71.6);
    expect(worstPercent({ claudeReader: 'none' })).toBeNull();
  });
  it('turns amber at 70 % and red at 90 %', () => {
    expect(quotaLevel(69.9)).toBe('ok');
    expect(quotaLevel(70)).toBe('warn');
    expect(quotaLevel(90)).toBe('high');
  });
});

describe('resetLabel', () => {
  const now = Date.parse('2026-11-06T09:00:00Z'); // 16:00 in Hồ Chí Minh
  it('shows the reset time of day in the business time zone when within a day', () => {
    expect(resetLabel(Date.parse('2026-11-06T12:30:00Z'), now)).toBe('reset 19:30');
  });
  it('adds the date when the reset is a day or more away', () => {
    expect(resetLabel(Date.parse('2026-11-09T01:00:00Z'), now)).toBe('reset 08:00 09/11');
  });
  it('says the window already reset', () => {
    expect(resetLabel(now - 1, now)).toBe('đã reset');
  });
});

describe('parsePermissionRequests / secondsLeft', () => {
  it('keeps well-formed requests, oldest first', () => {
    const a = {
      requestId: 'a',
      sessionId: 's',
      toolName: 'Bash',
      summary: 'ls',
      createdAt: 20,
      expiresAt: 50,
    };
    const b = { ...a, requestId: 'b', createdAt: 10, agentId: 3, cwd: '/x' };
    expect(parsePermissionRequests([a, { requestId: 1 }, b, null])).toEqual([b, a]);
    expect(parsePermissionRequests('nope')).toEqual([]);
  });
  it('counts whole seconds down to zero', () => {
    expect(secondsLeft(10_500, 1_000)).toBe(10);
    expect(secondsLeft(500, 1_000)).toBe(0);
  });
});

describe('parseAssistSettings', () => {
  it('reads booleans and falls back to the safe defaults', () => {
    expect(
      parseAssistSettings({ approveFromPage: true, notifyMac: false, holdSeconds: 30 }),
    ).toEqual({ approveFromPage: true, notifyMac: false, holdSeconds: 30 });
    expect(parseAssistSettings({})).toEqual({
      approveFromPage: false,
      notifyMac: true,
      holdSeconds: 30,
    });
  });
});

describe('quota source and reading time (06/11 fix)', () => {
  it('keeps a known source and drops an unknown one', () => {
    const v = parseQuotaStatus({
      type: 'quotaStatus',
      codex: { fiveHour: { usedPercent: 19, resetsAt: 10 }, updatedAt: 1, source: 'live' },
      claude: { fiveHour: { usedPercent: 5, resetsAt: 10 }, updatedAt: 1, source: 'x' },
    });
    expect(v.codex?.source).toBe('live');
    expect(v.claude && 'source' in v.claude).toBe(false);
  });

  it('says when and where the figure was read, in Hồ Chí Minh time', () => {
    const now = Date.parse('2026-11-06T09:45:00Z');
    expect(
      readingLabel({ updatedAt: Date.parse('2026-11-06T09:42:00Z'), source: 'live' }, now),
    ).toBe('đọc lúc 16:42 · máy chủ Codex');
    expect(
      readingLabel({ updatedAt: Date.parse('2026-11-06T07:43:00Z'), source: 'log' }, now),
    ).toBe('đọc lúc 14:43 · nhật ký trên máy, có thể cũ');
    expect(readingLabel({ updatedAt: Date.parse('2026-11-04T01:00:00Z') }, now)).toBe(
      'đọc lúc 08:00 04/11',
    );
  });

  it('remaining is 100 minus used, never below 0', () => {
    expect(remainingPercent(19)).toBe(81);
    expect(remainingPercent(104)).toBe(0);
  });
});
