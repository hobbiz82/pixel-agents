/**
 * mptl fork: Codex Desktop sessions, read straight from ~/.codex.
 *
 * Codex has no per-session pid file like ~/.claude/sessions, so "live" means
 * "the rollout was written in the last CODEX_RECENT_MS". Each rollout lives at
 * ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<time>-<id>.jsonl; its first line
 * (session_meta) carries the cwd, ~/.codex/session_index.jsonl the thread name,
 * and the last task_started / task_complete event says busy or idle.
 * Read-only: nothing here writes to ~/.codex.
 */
import { open, readdir, readFile, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** A rollout written within this window counts as an open Codex session. */
export const CODEX_RECENT_MS = 24 * 3_600_000;

/** session_meta embeds the base instructions (~20 KB); stop looking past this. */
const FIRST_LINE_MAX_BYTES = 1 << 20;
/** Enough of the tail to find the last turn event behind token/bookkeeping lines. */
const TAIL_BYTES = 256 << 10;

const ROLLOUT_RE =
  /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export interface CodexSession {
  sessionId: string;
  file: string;
  cwd: string;
  name?: string;
  status?: 'busy' | 'idle';
  statusSince?: number;
}

export function codexDefaultRoot(): string {
  return path.join(os.homedir(), '.codex');
}

export function codexRolloutId(file: string): string | null {
  return ROLLOUT_RE.exec(path.basename(file))?.[1] ?? null;
}

/** busy/idle from the last turn event in these transcript lines (oldest first). */
export function codexStatusFromLines(
  lines: string[],
): Pick<CodexSession, 'status' | 'statusSince'> {
  for (let i = lines.length - 1; i >= 0; i--) {
    let rec: { type?: unknown; payload?: { type?: unknown }; timestamp?: unknown };
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (rec?.type !== 'event_msg') continue;
    const kind = rec.payload?.type;
    if (kind !== 'task_started' && kind !== 'task_complete') continue;
    const since = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    return {
      status: kind === 'task_started' ? 'busy' : 'idle',
      ...(Number.isFinite(since) ? { statusSince: since } : {}),
    };
  }
  return {};
}

async function listRollouts(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listRollouts(p, out);
    else if (codexRolloutId(p)) out.push(p);
  }
}

async function readHeadAndTail(
  file: string,
  size: number,
): Promise<{ cwd?: string; subagent: boolean; tail: string[] }> {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(size, FIRST_LINE_MAX_BYTES));
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    const firstText = head.subarray(0, bytesRead).toString('utf8');
    const nl = firstText.indexOf('\n');
    let cwd: string | undefined;
    let subagent = false;
    if (nl > 0) {
      try {
        const meta = JSON.parse(firstText.slice(0, nl)) as {
          payload?: { cwd?: unknown; source?: unknown; parent_thread_id?: unknown };
        };
        if (typeof meta.payload?.cwd === 'string') cwd = meta.payload.cwd;
        // Sub-agent threads (e.g. Guardian review) run inside a parent thread
        // and never show up in the Codex sidebar on their own.
        const source = meta.payload?.source;
        subagent =
          (typeof source === 'object' && source !== null && 'subagent' in source) ||
          typeof meta.payload?.parent_thread_id === 'string';
      } catch {
        // half-written first line: no cwd
      }
    }
    const tailLen = Math.min(size, TAIL_BYTES);
    const tailBuf = Buffer.alloc(tailLen);
    await fh.read(tailBuf, 0, tailLen, size - tailLen);
    const tail = tailBuf.toString('utf8').split('\n');
    // The first piece is usually a cut line; keep it only when we read from 0.
    if (tailLen < size) tail.shift();
    return { cwd, subagent, tail };
  } finally {
    await fh.close();
  }
}

async function readThreadNames(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let text: string;
  try {
    text = await readFile(path.join(root, 'session_index.jsonl'), 'utf8');
  } catch {
    return names;
  }
  for (const l of text.split('\n')) {
    if (!l) continue;
    try {
      const j = JSON.parse(l) as { id?: unknown; thread_name?: unknown };
      // Later lines are renames: the last one wins.
      if (typeof j.id === 'string' && typeof j.thread_name === 'string' && j.thread_name) {
        names.set(j.id, j.thread_name);
      }
    } catch {
      // skip a bad line
    }
  }
  return names;
}

/** Codex sessions whose rollout was written within CODEX_RECENT_MS of `now`. */
export async function readCodexSessions(
  root = codexDefaultRoot(),
  now = Date.now(),
): Promise<CodexSession[]> {
  const files: string[] = [];
  await listRollouts(path.join(root, 'sessions'), files);
  const recent: { file: string; size: number }[] = [];
  for (const file of files) {
    try {
      const st = await stat(file);
      if (now - st.mtimeMs <= CODEX_RECENT_MS) recent.push({ file, size: st.size });
    } catch {
      // moved to archived_sessions between readdir and stat
    }
  }
  if (recent.length === 0) return [];
  const names = await readThreadNames(root);
  const out: CodexSession[] = [];
  for (const { file, size } of recent) {
    const sessionId = codexRolloutId(file) as string;
    let head: { cwd?: string; subagent: boolean; tail: string[] };
    try {
      head = await readHeadAndTail(file, size);
    } catch {
      continue;
    }
    if (!head.cwd || head.subagent) continue;
    const session: CodexSession = { sessionId, file, cwd: head.cwd };
    const name = names.get(sessionId);
    if (name) session.name = name;
    Object.assign(session, codexStatusFromLines(head.tail));
    out.push(session);
  }
  return out;
}
