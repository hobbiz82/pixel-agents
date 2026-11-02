/**
 * mptl fork: attach the Claude Code session's own facts to each agent.
 *
 * Claude Code writes one ~/.claude/sessions/<pid>.json per running session
 * (name, cwd, status idle/busy/waiting, statusUpdatedAt). We read those plus
 * `ps` every few seconds, match on sessionId, and broadcast `agentSessionMeta`
 * when something changed. Codex Desktop sessions come from ~/.codex
 * (codexSessions.ts) and are tagged provider 'codex'.
 * Read-only: nothing here writes or signals a process.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentStateStore } from './agentStateStore.js';
import { type CodexSession, readCodexSessions } from './codexSessions.js';
import type { LiveSession } from './fileWatcher.js';
import type { SessionMeta } from './types.js';

export interface SessionRecord {
  pid: number;
  sessionId: string;
  name?: string;
  cwd?: string;
  status?: string;
  statusUpdatedAt?: number;
}

/** RAM changes smaller than this fraction are not worth a re-send. */
const RSS_CHANGE_RATIO = 0.05;

export function parseSessionRecord(raw: unknown): SessionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid)) return null;
  if (typeof r.sessionId !== 'string' || !r.sessionId) return null;
  const rec: SessionRecord = { pid: r.pid, sessionId: r.sessionId };
  if (typeof r.name === 'string') rec.name = r.name;
  if (typeof r.cwd === 'string') rec.cwd = r.cwd;
  if (typeof r.status === 'string') rec.status = r.status;
  if (typeof r.statusUpdatedAt === 'number') rec.statusUpdatedAt = r.statusUpdatedAt;
  return rec;
}

/** `ps -axo pid=,ppid=,rss=` → pid → RSS of the process and all descendants, in bytes. */
export function parsePsTree(out: string): Map<number, number> {
  const own = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    own.set(pid, Number(m[3]) * 1024);
    if (ppid !== pid) {
      const list = children.get(ppid);
      if (list) list.push(pid);
      else children.set(ppid, [pid]);
    }
  }
  const total = new Map<number, number>();
  for (const pid of own.keys()) {
    let sum = 0;
    const seen = new Set<number>();
    const stack = [pid];
    while (stack.length > 0) {
      const p = stack.pop() as number;
      if (seen.has(p)) continue;
      seen.add(p);
      sum += own.get(p) ?? 0;
      for (const c of children.get(p) ?? []) stack.push(c);
    }
    total.set(pid, sum);
  }
  return total;
}

/** sessionId → meta, for records whose process is still in the `ps` table. */
export function buildSessionMetas(
  records: SessionRecord[],
  rss: Map<number, number>,
): Map<string, SessionMeta> {
  const best = new Map<string, SessionRecord>();
  for (const rec of records) {
    if (!rss.has(rec.pid)) continue;
    const prev = best.get(rec.sessionId);
    if (!prev || (rec.statusUpdatedAt ?? 0) > (prev.statusUpdatedAt ?? 0)) {
      best.set(rec.sessionId, rec);
    }
  }
  const metas = new Map<string, SessionMeta>();
  for (const [sessionId, rec] of best) {
    metas.set(sessionId, {
      provider: 'claude',
      pid: rec.pid,
      name: rec.name,
      rssBytes: rss.get(rec.pid) as number,
      status: rec.status,
      statusSince: rec.statusUpdatedAt,
    });
  }
  return metas;
}

/**
 * ~/.claude/projects/<cwd with every non-alphanumeric char as '-'>/<sessionId>.jsonl,
 * the path Claude Code writes the session transcript to.
 */
export function transcriptPathFor(projectsRoot: string, rec: SessionRecord): string | null {
  if (!rec.cwd) return null;
  return path.join(projectsRoot, rec.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${rec.sessionId}.jsonl`);
}

/** Codex metas carry what the rollout tells: name and turn status. */
export function codexMeta(s: CodexSession): SessionMeta {
  const meta: SessionMeta = { provider: 'codex' };
  if (s.name !== undefined) meta.name = s.name;
  if (s.status !== undefined) meta.status = s.status;
  if (s.statusSince !== undefined) meta.statusSince = s.statusSince;
  return meta;
}

export function sameMeta(a: SessionMeta | undefined, b: SessionMeta): boolean {
  if (!a) return false;
  if (a.provider !== b.provider || a.pid !== b.pid || a.name !== b.name) return false;
  if (a.status !== b.status || a.statusSince !== b.statusSince) return false;
  if (a.rssBytes === undefined || b.rssBytes === undefined) return a.rssBytes === b.rssBytes;
  const base = Math.max(a.rssBytes, 1);
  return Math.abs(b.rssBytes - a.rssBytes) / base < RSS_CHANGE_RATIO;
}

export interface SessionMetaIO {
  readRecords: () => Promise<SessionRecord[]>;
  readPs: () => Promise<string>;
  /** Codex sessions open recently; absent = Codex not watched. */
  readCodex?: () => Promise<CodexSession[]>;
}

export function sessionMetaMessage(id: number, meta: SessionMeta): Record<string, unknown> {
  return { type: 'agentSessionMeta', id, ...meta };
}

export class SessionMetaPoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private live: LiveSession[] = [];

  constructor(
    private readonly store: AgentStateStore,
    private readonly io: SessionMetaIO = defaultIO(),
    private readonly projectsRoot = path.join(os.homedir(), '.claude', 'projects'),
  ) {}

  /** Every session alive at the last tick: Claude by pid, Codex by recent rollout. */
  liveSessions(): LiveSession[] {
    return this.live;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const [records, psOut, codex] = await Promise.all([
        this.io.readRecords(),
        this.io.readPs(),
        // A broken ~/.codex must not take the Claude sessions down with it.
        this.io.readCodex?.().catch(() => [] as CodexSession[]) ?? Promise.resolve([]),
      ]);
      const rss = parsePsTree(psOut);
      const metas = buildSessionMetas(records, rss);
      const live: LiveSession[] = records.flatMap((rec) => {
        const file = rss.has(rec.pid) ? transcriptPathFor(this.projectsRoot, rec) : null;
        return file && rec.cwd
          ? [{ file, cwd: rec.cwd, sessionId: rec.sessionId, provider: 'claude' as const }]
          : [];
      });
      for (const c of codex) {
        metas.set(c.sessionId, codexMeta(c));
        live.push({ file: c.file, cwd: c.cwd, sessionId: c.sessionId, provider: 'codex' });
      }
      this.live = live;
      for (const [id, agent] of this.store) {
        const meta = metas.get(agent.sessionId);
        if (!meta || sameMeta(agent.sessionMeta, meta)) continue;
        agent.sessionMeta = meta;
        this.store.broadcast(sessionMetaMessage(id, meta));
      }
    } catch {
      // Unreadable folder or failed `ps`: keep the last known meta.
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 15_000): void {
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

export function defaultIO(
  sessionsDir = path.join(os.homedir(), '.claude', 'sessions'),
): SessionMetaIO {
  return {
    readRecords: async () => {
      const names = (await readdir(sessionsDir)).filter((n) => n.endsWith('.json'));
      const out: SessionRecord[] = [];
      for (const n of names) {
        try {
          const rec = parseSessionRecord(
            JSON.parse(await readFile(path.join(sessionsDir, n), 'utf8')),
          );
          if (rec) out.push(rec);
        } catch {
          // half-written or removed between readdir and readFile
        }
      }
      return out;
    },
    readPs: () =>
      new Promise((resolve, reject) => {
        execFile(
          'ps',
          ['-axo', 'pid=,ppid=,rss='],
          { maxBuffer: 8 * 1024 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
      }),
    readCodex: () => readCodexSessions(),
  };
}
