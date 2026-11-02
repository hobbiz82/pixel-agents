/**
 * Archive / restore a session from the office (mptl fork).
 *
 * Unlike sessionMeta.ts this module DOES act on the machine, so every action is
 * single-target, refuses while the session is working, and proves the target's
 * identity right before acting:
 * - Claude: SIGTERM to the session's own pid, only after re-reading
 *   ~/.claude/sessions/<pid>.json (same sessionId), matching the process start
 *   time to the record's procStart (pid not reused) and checking the binary is
 *   claude. Never SIGKILL, never a process group.
 * - Codex: `codex archive <id>` / `codex unarchive <id>` via execFile (no shell).
 *
 * Every successful action is appended to ~/.pixel-agents/session-archive.jsonl;
 * the archived list shown in the office is that log folded.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { LAYOUT_FILE_DIR } from './constants.js';
import type { SessionMeta } from './types.js';

export type ArchiveProvider = 'claude' | 'codex';

export type ArchiveReason = 'busy' | 'waiting' | 'process_changed' | 'unknown' | 'failed';

export interface ArchiveTarget {
  sessionId: string;
  folder?: string;
  cwd?: string;
  /** Transcript the character watched; lets a restore lift its X-close dismissal. */
  file?: string;
  meta?: SessionMeta;
}

/** Fields of ~/.claude/sessions/<pid>.json this module trusts. */
export interface ClaudeRecord {
  pid: number;
  sessionId: string;
  status?: string;
  waitingFor?: string | null;
  procStart?: string;
  entrypoint?: string;
}

export interface ArchivedEntry {
  sessionId: string;
  provider: ArchiveProvider;
  name?: string;
  folder?: string;
  cwd?: string;
  entrypoint?: string;
  file?: string;
  archivedAt: number;
}

export type ArchiveLogEvent =
  | ({ kind: 'archived' } & ArchivedEntry)
  | { kind: 'restored'; sessionId: string; restoredAt: number };

export interface ArchiveIO {
  readClaudeRecord(pid: number): Promise<ClaudeRecord | null>;
  processStart(pid: number): Promise<string | null>;
  processName(pid: number): Promise<string | null>;
  signal(pid: number): void;
  runCodex(args: string[]): Promise<void>;
  appendLog(event: ArchiveLogEvent): Promise<void>;
  readLog(): Promise<ArchiveLogEvent[]>;
  now(): number;
}

export type ArchiveOutcome =
  { ok: true; entry: ArchivedEntry } | { ok: false; reason: ArchiveReason };
export type RestoreOutcome = { ok: true } | { ok: false; reason: ArchiveReason };

/** Working sessions are never archived: `busy` = running a turn, `waiting` = asking anh. */
function workingReason(status?: string, waitingFor?: string | null): ArchiveReason | null {
  if (status === 'busy') return 'busy';
  if (status === 'waiting' || waitingFor) return 'waiting';
  return null;
}

/** `ps -o lstart` pads single-digit days ("Nov  2"); compare word by word. */
function sameStart(a: string, b: string): boolean {
  return a.trim().split(/\s+/).join(' ') === b.trim().split(/\s+/).join(' ');
}

async function stopClaude(target: ArchiveTarget, io: ArchiveIO): Promise<ArchiveOutcome> {
  const pid = target.meta?.pid;
  if (!pid) return { ok: false, reason: 'unknown' };
  const rec = await io.readClaudeRecord(pid);
  if (!rec || rec.sessionId !== target.sessionId || !rec.procStart) {
    return { ok: false, reason: 'process_changed' };
  }
  const working = workingReason(rec.status, rec.waitingFor);
  if (working) return { ok: false, reason: working };
  const start = await io.processStart(pid);
  const name = await io.processName(pid);
  if (!start || !sameStart(start, rec.procStart) || !name || !/claude/i.test(path.basename(name))) {
    return { ok: false, reason: 'process_changed' };
  }
  try {
    io.signal(pid);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, entry: entryFor(target, 'claude', io.now(), rec.entrypoint) };
}

function entryFor(
  target: ArchiveTarget,
  provider: ArchiveProvider,
  archivedAt: number,
  entrypoint?: string,
): ArchivedEntry {
  return {
    sessionId: target.sessionId,
    provider,
    name: target.meta?.name,
    folder: target.folder,
    cwd: target.cwd,
    entrypoint,
    file: target.file,
    archivedAt,
  };
}

export async function archiveSession(
  target: ArchiveTarget,
  io: ArchiveIO,
): Promise<ArchiveOutcome> {
  const provider = target.meta?.provider;
  if (provider !== 'claude' && provider !== 'codex') return { ok: false, reason: 'unknown' };
  const cached = workingReason(target.meta?.status);
  if (cached) return { ok: false, reason: cached };

  let out: ArchiveOutcome;
  if (provider === 'claude') {
    out = await stopClaude(target, io);
  } else {
    try {
      await io.runCodex(['archive', target.sessionId]);
    } catch {
      return { ok: false, reason: 'failed' };
    }
    out = { ok: true, entry: entryFor(target, 'codex', io.now()) };
  }
  if (out.ok) await io.appendLog({ kind: 'archived', ...out.entry });
  return out;
}

/**
 * Codex threads are unarchived by the CLI. A stopped Claude session cannot be
 * restarted from here (it belongs to the Claude app); restoring only drops it
 * from the archived list and the office shows how to reopen it.
 */
export async function restoreSession(
  target: { sessionId: string; provider: ArchiveProvider },
  io: ArchiveIO,
): Promise<RestoreOutcome> {
  if (target.provider === 'codex') {
    try {
      await io.runCodex(['unarchive', target.sessionId]);
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }
  await io.appendLog({ kind: 'restored', sessionId: target.sessionId, restoredAt: io.now() });
  return { ok: true };
}

/** Currently archived sessions, newest first. Malformed lines are skipped. */
export function foldArchiveLog(events: ArchiveLogEvent[]): ArchivedEntry[] {
  const current = new Map<string, ArchivedEntry>();
  for (const e of events) {
    if (!e || typeof e !== 'object' || typeof e.sessionId !== 'string' || !e.sessionId) continue;
    if (e.kind === 'archived') {
      if ((e.provider !== 'claude' && e.provider !== 'codex') || typeof e.archivedAt !== 'number') {
        continue;
      }
      const { kind: _kind, ...entry } = e;
      current.delete(e.sessionId);
      current.set(e.sessionId, entry);
    } else if (e.kind === 'restored') {
      current.delete(e.sessionId);
    }
  }
  return [...current.values()].sort((a, b) => b.archivedAt - a.archivedAt);
}

/** launchd starts the server without the user's PATH, so look in ~/.local/bin too. */
export function codexBinary(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  exists: (p: string) => boolean = existsSync,
): string {
  if (env.PIXEL_AGENTS_CODEX_BIN) return env.PIXEL_AGENTS_CODEX_BIN;
  const local = path.join(home, '.local', 'bin', 'codex');
  return exists(local) ? local : 'codex';
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      // English month names, UTC: the form Claude writes procStart in.
      { timeout: timeoutMs, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

function parseClaudeRecord(raw: unknown): ClaudeRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pid !== 'number' || typeof r.sessionId !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    pid: r.pid,
    sessionId: r.sessionId,
    status: str(r.status),
    waitingFor: str(r.waitingFor) ?? null,
    procStart: str(r.procStart),
    entrypoint: str(r.entrypoint),
  };
}

export function defaultArchiveIO(home: string = os.homedir()): ArchiveIO {
  const sessionsDir = path.join(home, '.claude', 'sessions');
  const logDir = path.join(home, LAYOUT_FILE_DIR);
  const logFile = path.join(logDir, 'session-archive.jsonl');
  const codex = codexBinary(process.env, home);
  return {
    readClaudeRecord: async (pid) => {
      try {
        const rec = parseClaudeRecord(
          JSON.parse(await readFile(path.join(sessionsDir, `${pid}.json`), 'utf8')),
        );
        return rec && rec.pid === pid ? rec : null;
      } catch {
        return null;
      }
    },
    processStart: async (pid) => {
      try {
        return (await run('ps', ['-o', 'lstart=', '-p', String(pid)], 5000)).trim() || null;
      } catch {
        return null;
      }
    },
    processName: async (pid) => {
      try {
        return (await run('ps', ['-o', 'comm=', '-p', String(pid)], 5000)).trim() || null;
      } catch {
        return null;
      }
    },
    signal: (pid) => {
      process.kill(pid, 'SIGTERM');
    },
    runCodex: async (args) => {
      await run(codex, args, 30_000);
    },
    appendLog: async (event) => {
      await mkdir(logDir, { recursive: true });
      await appendFile(logFile, JSON.stringify(event) + '\n', 'utf8');
    },
    readLog: async () => {
      let text: string;
      try {
        text = await readFile(logFile, 'utf8');
      } catch {
        return [];
      }
      const out: ArchiveLogEvent[] = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line) as ArchiveLogEvent);
        } catch {
          // torn last line; fold skips it
        }
      }
      return out;
    },
    now: () => Date.now(),
  };
}
