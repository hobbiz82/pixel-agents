import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  codexQuotaFromRateLimits,
  fetchCodexRateLimits,
  makeCodexQuotaReader,
  type ProviderQuota,
  stopCodexAppServers,
} from '../src/quota.js';

/**
 * mptl fork: Codex limits read live from the Codex app-server.
 *
 * Measured 06/11 16:42: the newest rollout said 7 % of the 5-hour window (written
 * 14:43), while `account/rateLimits/read` said 19 % — usage that left no rollout on
 * this Mac. The live read is the figure; rollouts only fill in when it fails.
 */

const NOW = Date.parse('2026-11-06T09:42:00Z');
const live = {
  rateLimits: {
    limitId: 'codex',
    primary: { usedPercent: 19, windowDurationMins: 300, resetsAt: 1793962594 },
    secondary: { usedPercent: 34, windowDurationMins: 10080, resetsAt: 1794379086 },
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      primary: { usedPercent: 19, windowDurationMins: 300, resetsAt: 1793962594 },
      secondary: { usedPercent: 34, windowDurationMins: 10080, resetsAt: 1794379086 },
    },
  },
};

describe('codexQuotaFromRateLimits', () => {
  it('maps the codex bucket by window length, resets in ms, stamped now and marked live', () => {
    expect(codexQuotaFromRateLimits(live, NOW)).toEqual({
      fiveHour: { usedPercent: 19, resetsAt: 1793962594000 },
      sevenDay: { usedPercent: 34, resetsAt: 1794379086000 },
      updatedAt: NOW,
      source: 'live',
    });
  });

  it('prefers the codex bucket over the single view, and is null for garbage', () => {
    const mixed = {
      rateLimits: {
        limitId: 'premium',
        primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: 1 },
      },
      rateLimitsByLimitId: live.rateLimitsByLimitId,
    };
    expect(codexQuotaFromRateLimits(mixed, NOW)?.fiveHour?.usedPercent).toBe(19);
    expect(
      codexQuotaFromRateLimits({ rateLimits: { primary: { usedPercent: 'x' } } }, NOW),
    ).toBeNull();
    expect(codexQuotaFromRateLimits(null, NOW)).toBeNull();
  });
});

function fakeAppServer(reply: (msg: { id?: number; method: string }) => unknown) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const methods: string[] = [];
  let killed = false;
  stdin.on('data', (chunk: Buffer) => {
    for (const l of chunk.toString().split('\n').filter(Boolean)) {
      const msg = JSON.parse(l) as { id?: number; method: string };
      methods.push(msg.method);
      const out = reply(msg);
      if (out !== undefined) stdout.write(JSON.stringify(out) + '\n');
    }
  });
  const child = { stdin, stdout, kill: () => (killed = true), on: () => child };
  return { spawn: () => child, methods, wasKilled: () => killed };
}

describe('fetchCodexRateLimits', () => {
  it('sends only initialize, initialized and account/rateLimits/read, then stops the server', async () => {
    const fake = fakeAppServer((m) => {
      if (m.method === 'initialize') return { id: m.id, result: {} };
      if (m.method === 'account/rateLimits/read') return { id: m.id, result: live };
      return undefined;
    });
    await expect(fetchCodexRateLimits(fake.spawn, 1000)).resolves.toEqual(live);
    expect(fake.methods).toEqual(['initialize', 'initialized', 'account/rateLimits/read']);
    expect(fake.wasKilled()).toBe(true);
  });

  it('rejects on an error reply or a timeout, and still stops the server', async () => {
    const bad = fakeAppServer((m) =>
      m.method === 'initialize'
        ? { id: m.id, result: {} }
        : m.id
          ? { id: m.id, error: { code: -1, message: 'no auth' } }
          : undefined,
    );
    await expect(fetchCodexRateLimits(bad.spawn, 1000)).rejects.toThrow();
    expect(bad.wasKilled()).toBe(true);

    const silent = fakeAppServer(() => undefined);
    await expect(fetchCodexRateLimits(silent.spawn, 50)).rejects.toThrow();
    expect(silent.wasKilled()).toBe(true);
  });

  it('stops a server still waiting for an answer when the page shuts down', async () => {
    // 06/11: the page stopped, a real `codex app-server` kept running and writing ~/.codex.
    const silent = fakeAppServer(() => undefined);
    const pending = fetchCodexRateLimits(silent.spawn, 60_000);
    stopCodexAppServers();
    expect(silent.wasKilled()).toBe(true);
    await expect(pending).rejects.toThrow();
  });
});

describe('makeCodexQuotaReader', () => {
  const log = (at: number, pct: number): ProviderQuota => ({
    fiveHour: { usedPercent: pct, resetsAt: NOW + 3_600_000 },
    updatedAt: at,
    source: 'log',
  });

  it('asks the server at most every 5 minutes and returns the newest of live and log', async () => {
    let now = NOW;
    let calls = 0;
    let logReading = log(NOW - 2 * 3_600_000, 7);
    const read = makeCodexQuotaReader({
      fetchLive: async () => {
        calls++;
        return live;
      },
      readLog: async () => logReading,
      now: () => now,
    });
    expect((await read())?.fiveHour?.usedPercent).toBe(19);
    now += 60_000;
    expect((await read())?.source).toBe('live');
    expect(calls).toBe(1);
    // Codex used on this Mac after the live read: the rollout is newer.
    logReading = log(now, 21);
    expect((await read())?.fiveHour?.usedPercent).toBe(21);
    now += 5 * 60_000;
    await read();
    expect(calls).toBe(2);
  });

  it('falls back to the rollouts when the server cannot be asked', async () => {
    const read = makeCodexQuotaReader({
      fetchLive: async () => {
        throw new Error('codex not installed');
      },
      readLog: async () => log(NOW - 60_000, 7),
      now: () => NOW,
    });
    expect(await read()).toEqual(log(NOW - 60_000, 7));
  });
});

describe('dropExpired keeps where the reading came from', () => {
  it('passes source through', async () => {
    const { dropExpired } = await import('../src/quota.js');
    const q = codexQuotaFromRateLimits(live, NOW);
    expect(dropExpired(q, NOW)?.source).toBe('live');
  });
});

describe('appServerCommand', () => {
  it('uses the same codex binary lookup as Lưu trữ: launchd has no PATH (06/11: live read fell back to rollouts)', async () => {
    const { appServerCommand } = await import('../src/quota.js');
    expect(appServerCommand({}, '/Users/x', (p) => p === '/Users/x/.local/bin/codex')).toEqual([
      '/Users/x/.local/bin/codex',
      ['app-server'],
    ]);
    expect(appServerCommand({ PIXEL_AGENTS_CODEX_BIN: '/opt/c' }, '/Users/x', () => false)[0]).toBe(
      '/opt/c',
    );
  });
});
