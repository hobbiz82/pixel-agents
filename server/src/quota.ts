/**
 * mptl fork (Đ3): usage limits of Claude and Codex, for the quota panel.
 *
 * Codex: asked live from a throwaway `codex app-server` (`account/rateLimits/read`)
 * at most every 5 minutes. Rollouts also carry the limits (`token_count` events) but
 * only from turns run on this Mac: on 06/11 the newest one said 7 % while the server
 * said 19 %. A rollout reading is used only when it is newer than the live one, or
 * when the server cannot be asked. Claude Code exposes its
 * limits only to a status line command (`rate_limits.five_hour` /
 * `seven_day`, claude.ai subscribers only, after the session's first API
 * response); our status line writer stores them in
 * ~/.pixel-agents/claude-quota.json and this module reads that file.
 * Read-only: nothing here writes to ~/.codex or ~/.claude.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { codexDefaultRoot, codexRolloutId } from './codexSessions.js';
import { LAYOUT_FILE_DIR } from './constants.js';

export interface QuotaWindow {
  /** 0–100 (Claude may exceed 100 behind a gateway). */
  usedPercent: number;
  /** Epoch ms when the window resets. */
  resetsAt: number;
}

export interface ProviderQuota {
  fiveHour?: QuotaWindow;
  sevenDay?: QuotaWindow;
  /** Epoch ms of the reading. */
  updatedAt: number;
  /** Codex only: asked from the server, or taken from this Mac's rollouts. */
  source?: 'live' | 'log';
}

export const CLAUDE_QUOTA_FILE_NAME = 'claude-quota.json';
const FIVE_HOUR_MINUTES = 300;
const SEVEN_DAY_MINUTES = 10_080;
/** Enough of a rollout's tail to reach a token_count behind long tool output. */
const TAIL_BYTES = 256 << 10;
/** How many of the newest rollouts to try before giving up. */
const MAX_ROLLOUTS_TRIED = 8;

export function claudeQuotaFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CLAUDE_QUOTA_FILE_NAME);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** One window from `{percent, resets_at (epoch s)}`; undefined when unusable. */
function windowOf(pct: unknown, resetsAtSec: unknown): QuotaWindow | undefined {
  if (!finite(pct) || !finite(resetsAtSec)) return undefined;
  return { usedPercent: pct, resetsAt: resetsAtSec * 1000 };
}

function withWindows(
  fiveHour: QuotaWindow | undefined,
  sevenDay: QuotaWindow | undefined,
  updatedAt: number,
): ProviderQuota | null {
  if (!fiveHour && !sevenDay) return null;
  return {
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
    updatedAt,
  };
}

/** The last usable `token_count` rate limits in these rollout lines (oldest first). */
export function codexQuotaFromLines(lines: string[]): ProviderQuota | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('rate_limits')) continue;
    let rec: {
      timestamp?: unknown;
      type?: unknown;
      payload?: { type?: unknown; rate_limits?: Record<string, unknown> | null };
    };
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (rec?.type !== 'event_msg' || rec.payload?.type !== 'token_count') continue;
    const limits = rec.payload.rate_limits;
    if (!limits || typeof limits !== 'object') continue;
    let fiveHour: QuotaWindow | undefined;
    let sevenDay: QuotaWindow | undefined;
    for (const key of ['primary', 'secondary']) {
      const w = limits[key] as
        | { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown }
        | null
        | undefined;
      if (!w || typeof w !== 'object') continue;
      const win = windowOf(w.used_percent, w.resets_at);
      if (!win) continue;
      if (w.window_minutes === FIVE_HOUR_MINUTES) fiveHour = win;
      else if (w.window_minutes === SEVEN_DAY_MINUTES) sevenDay = win;
      else if (key === 'primary') fiveHour = win;
      else sevenDay = win;
    }
    const at = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    const q = withWindows(fiveHour, sevenDay, Number.isFinite(at) ? at : 0);
    if (q) return q;
  }
  return null;
}

/** The status line JSON's `rate_limits` (Claude Code), stamped with `now`. */
export function claudeQuotaFromStatusInput(input: unknown, now: number): ProviderQuota | null {
  if (!input || typeof input !== 'object') return null;
  const limits = (input as { rate_limits?: unknown }).rate_limits;
  if (!limits || typeof limits !== 'object') return null;
  const pick = (name: string): QuotaWindow | undefined => {
    const w = (limits as Record<string, unknown>)[name] as
      { used_percentage?: unknown; resets_at?: unknown } | undefined;
    return w && typeof w === 'object' ? windowOf(w.used_percentage, w.resets_at) : undefined;
  };
  return withWindows(pick('five_hour'), pick('seven_day'), now);
}

/** Drop windows whose reset time has passed: their percentage no longer applies. */
export function dropExpired(q: ProviderQuota | null, now: number): ProviderQuota | null {
  if (!q) return null;
  const live = (w?: QuotaWindow) => (w && w.resetsAt > now ? w : undefined);
  const kept = withWindows(live(q.fiveHour), live(q.sevenDay), q.updatedAt);
  return kept && q.source ? { ...kept, source: q.source } : kept;
}

function parseWindow(v: unknown): QuotaWindow | undefined | false {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object') return false;
  const { usedPercent, resetsAt } = v as Record<string, unknown>;
  return finite(usedPercent) && finite(resetsAt) ? { usedPercent, resetsAt } : false;
}

/** The quota file our status line writer keeps; null when absent or malformed. */
export async function readClaudeQuota(file = claudeQuotaFile()): Promise<ProviderQuota | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fiveHour = parseWindow(r.fiveHour);
  const sevenDay = parseWindow(r.sevenDay);
  if (fiveHour === false || sevenDay === false || !finite(r.updatedAt)) return null;
  return withWindows(fiveHour, sevenDay, r.updatedAt);
}

/** The status line text: "5h 24% · 7d 41%", or "" before the first reading. */
export function statusLineText(q: ProviderQuota | null): string {
  if (!q) return '';
  const parts: string[] = [];
  if (q.fiveHour) parts.push(`5h ${Math.round(q.fiveHour.usedPercent)}%`);
  if (q.sevenDay) parts.push(`7d ${Math.round(q.sevenDay.usedPercent)}%`);
  return parts.join(' · ');
}

/** Store a Claude reading for the server: tmp file + rename, owner-only. */
export function writeClaudeQuota(file: string, q: ProviderQuota): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(q), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

async function listRollouts(dir: string, out: { file: string; mtime: number }[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listRollouts(p, out);
    else if (codexRolloutId(p)) {
      try {
        out.push({ file: p, mtime: (await stat(p)).mtimeMs });
      } catch {
        // moved between readdir and stat
      }
    }
  }
}

async function readTail(file: string): Promise<string[]> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift();
    return lines;
  } finally {
    await fh.close();
  }
}

/** Codex limits from the newest rollouts (live or archived). */
export async function readCodexQuota(root = codexDefaultRoot()): Promise<ProviderQuota | null> {
  const files: { file: string; mtime: number }[] = [];
  await listRollouts(path.join(root, 'sessions'), files);
  await listRollouts(path.join(root, 'archived_sessions'), files);
  files.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of files.slice(0, MAX_ROLLOUTS_TRIED)) {
    try {
      const q = codexQuotaFromLines(await readTail(file));
      if (q) return q;
    } catch {
      // unreadable rollout: try the next one
    }
  }
  return null;
}

function liveWindow(v: unknown): { w: QuotaWindow; mins?: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { usedPercent, resetsAt, windowDurationMins } = v as Record<string, unknown>;
  const w = windowOf(usedPercent, resetsAt);
  return w ? { w, mins: finite(windowDurationMins) ? windowDurationMins : undefined } : undefined;
}

/** `account/rateLimits/read` result → quota (the `codex` bucket when there are several). */
export function codexQuotaFromRateLimits(result: unknown, now: number): ProviderQuota | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as {
    rateLimits?: unknown;
    rateLimitsByLimitId?: Record<string, unknown> | null;
  };
  const snap = (r.rateLimitsByLimitId?.codex ?? r.rateLimits) as
    { primary?: unknown; secondary?: unknown } | undefined;
  if (!snap || typeof snap !== 'object') return null;
  let fiveHour: QuotaWindow | undefined;
  let sevenDay: QuotaWindow | undefined;
  for (const [slot, raw] of [
    ['primary', snap.primary],
    ['secondary', snap.secondary],
  ] as const) {
    const lw = liveWindow(raw);
    if (!lw) continue;
    if (lw.mins === FIVE_HOUR_MINUTES || (lw.mins === undefined && slot === 'primary'))
      fiveHour = lw.w;
    else if (lw.mins === SEVEN_DAY_MINUTES || (lw.mins === undefined && slot === 'secondary'))
      sevenDay = lw.w;
  }
  const q = withWindows(fiveHour, sevenDay, now);
  return q ? { ...q, source: 'live' } : null;
}

export interface AppServerChild {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  kill: () => unknown;
}

const spawnAppServer = (): AppServerChild =>
  nodeSpawn('codex', ['app-server'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  }) as unknown as AppServerChild;

/**
 * One read-only JSON-RPC exchange with a fresh `codex app-server`: initialize,
 * initialized, account/rateLimits/read. Nothing else is ever sent.
 */
export function fetchCodexRateLimits(
  spawn: () => AppServerChild = spawnAppServer,
  timeoutMs = 20_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let child: AppServerChild;
    try {
      child = spawn();
    } catch (err) {
      reject(err);
      return;
    }
    let buf = '';
    let done = false;
    const finish = (err: unknown, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // already gone
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('codex app-server timeout')), timeoutMs);
    const send = (m: Record<string, unknown>) => child.stdin.write(JSON.stringify(m) + '\n');
    child.stdout.on('error', (err) => finish(err));
    (child as unknown as { on?: (e: string, f: (x: unknown) => void) => void }).on?.(
      'error',
      (err) => finish(err),
    );
    child.stdout.on('data', (chunk: Buffer | string) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let m: { id?: unknown; result?: unknown; error?: unknown };
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 1) {
          if (m.error) return finish(new Error('codex app-server initialize failed'));
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read', params: null });
        } else if (m.id === 2) {
          if (m.error) return finish(new Error('codex rate limits unavailable'));
          return finish(null, m.result);
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'pixel-agents-quota', version: '1' } },
    });
  });
}

/** How often the Codex server is asked (each ask starts `codex app-server` for ~1 s). */
export const CODEX_LIVE_EVERY_MS = 5 * 60_000;

/** Live reading at most every 5 minutes; the newer of live and rollout wins. */
export function makeCodexQuotaReader(deps: {
  fetchLive: () => Promise<unknown>;
  readLog: () => Promise<ProviderQuota | null>;
  now: () => number;
  liveEveryMs?: number;
}): () => Promise<ProviderQuota | null> {
  let lastLive: ProviderQuota | null = null;
  let lastAsk = -Infinity;
  const every = deps.liveEveryMs ?? CODEX_LIVE_EVERY_MS;
  return async () => {
    const now = deps.now();
    if (now - lastAsk >= every) {
      lastAsk = now;
      try {
        lastLive = codexQuotaFromRateLimits(await deps.fetchLive(), now) ?? lastLive;
      } catch {
        // keep the last live reading; the rollouts may still have a newer one
      }
    }
    const fromLog = await deps.readLog().catch(() => null);
    const logQ = fromLog ? { ...fromLog, source: 'log' as const } : null;
    if (lastLive && (!logQ || lastLive.updatedAt >= logQ.updatedAt)) return lastLive;
    return logQ;
  };
}

export function quotaMessage(
  claude: ProviderQuota | null,
  codex: ProviderQuota | null,
): Record<string, unknown> {
  return {
    type: 'quotaStatus',
    ...(claude ? { claude } : {}),
    ...(codex ? { codex } : {}),
  };
}

export interface QuotaIO {
  readClaude: () => Promise<ProviderQuota | null>;
  readCodex: () => Promise<ProviderQuota | null>;
  now: () => number;
}

const defaultQuotaIO: QuotaIO = {
  readClaude: () => readClaudeQuota(),
  readCodex: makeCodexQuotaReader({
    fetchLive: () => fetchCodexRateLimits(),
    readLog: () => readCodexQuota(),
    now: () => Date.now(),
  }),
  now: () => Date.now(),
};

/** Polls both sources and broadcasts `quotaStatus` when the figures change. */
export class QuotaPoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private last: Record<string, unknown> | null = null;
  private lastKey = '';
  private running = false;

  constructor(
    private readonly broadcast: (message: Record<string, unknown>) => void,
    private readonly io: QuotaIO = defaultQuotaIO,
  ) {}

  /** The last message, for clients that connect later. */
  snapshot(): Record<string, unknown> | null {
    return this.last;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.io.now();
      // One broken source must not hide the other.
      const [claude, codex] = await Promise.all([
        this.io.readClaude().catch(() => null),
        this.io.readCodex().catch(() => null),
      ]);
      const msg = quotaMessage(dropExpired(claude, now), dropExpired(codex, now));
      const key = JSON.stringify(msg);
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.last = msg;
      this.broadcast(msg);
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
