/**
 * mptl fork: delete an ARCHIVED session's history by moving it to the macOS
 * Trash (/usr/bin/trash, macOS 15+), so Finder can still put it back until the
 * Trash is emptied. Never a hard delete, never a running session.
 *
 * What moves, and only from these folders:
 * - Claude: ~/.claude/projects/<folder>/<id>.jsonl (the conversation), the
 *   side folder ~/.claude/projects/<folder>/<id>/ (sub-agents, tool output)
 *   and ~/.claude/file-history/<id>/ (backups of files it edited).
 * - Codex: ~/.codex/archived_sessions/rollout-<time>-<id>.jsonl[.zst].
 * Code in the project folders is never touched.
 */
import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { LAYOUT_FILE_DIR } from './constants.js';
import type { ArchivedEntry, ArchiveLogEvent } from './sessionArchive.js';

/** Most sessions one delete request handles. */
export const MAX_TRASH = 50;

export type TrashReason = 'live' | 'failed';

export interface TrashIO {
  /** 'file' / 'dir' for a real entry; null when missing or a symlink. */
  kind(p: string): Promise<'file' | 'dir' | null>;
  list(dir: string): Promise<string[]>;
  /** The session is running again (Claude reopened it, Codex unarchived it). */
  isLive(sessionId: string): Promise<boolean>;
  trash(paths: string[]): Promise<void>;
  appendLog(event: ArchiveLogEvent): Promise<void>;
  now(): number;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The history files of one archived session that exist and may be moved. */
export async function trashPathsFor(
  entry: ArchivedEntry,
  home: string,
  io: Pick<TrashIO, 'kind' | 'list'>,
): Promise<string[]> {
  const id = entry.sessionId;
  if (!SESSION_ID.test(id)) return [];
  const out: string[] = [];
  const add = async (p: string) => {
    if (await io.kind(p)) out.push(p);
  };

  if (entry.provider === 'claude') {
    if (!entry.file) return [];
    const projects = path.join(home, '.claude', 'projects');
    const file = path.resolve(entry.file);
    // Exactly ~/.claude/projects/<one folder>/<id>.jsonl, nothing else.
    if (path.dirname(path.dirname(file)) !== projects || path.basename(file) !== `${id}.jsonl`) {
      return [];
    }
    if ((await io.kind(file)) === 'file') out.push(file);
    const side = path.join(path.dirname(file), id);
    if ((await io.kind(side)) === 'dir') out.push(side);
    await add(path.join(home, '.claude', 'file-history', id));
    return out;
  }

  const dir = path.join(home, '.codex', 'archived_sessions');
  const name = new RegExp(`^rollout-[0-9T:-]+-${escapeRe(id)}\\.jsonl(\\.zst)?$`);
  for (const n of (await io.list(dir).catch(() => [] as string[])).sort()) {
    if (!name.test(n)) continue;
    const p = path.join(dir, n);
    if ((await io.kind(p)) === 'file') out.push(p);
  }
  return out;
}

export async function trashArchived(
  entry: ArchivedEntry,
  home: string,
  io: TrashIO,
): Promise<{ ok: true; items: number } | { ok: false; reason: TrashReason }> {
  if (await io.isLive(entry.sessionId)) return { ok: false, reason: 'live' };
  const paths = await trashPathsFor(entry, home, io);
  if (paths.length > 0) {
    try {
      await io.trash(paths);
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }
  await io.appendLog({ kind: 'deleted', sessionId: entry.sessionId, deletedAt: io.now() });
  return { ok: true, items: paths.length };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function defaultTrashIO(home: string = os.homedir()): TrashIO {
  const sessionsDir = path.join(home, '.claude', 'sessions');
  const codexLive = path.join(home, '.codex', 'sessions');
  const logDir = path.join(home, LAYOUT_FILE_DIR);
  return {
    kind: async (p) => {
      try {
        const st = await lstat(p);
        if (st.isSymbolicLink()) return null;
        return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
      } catch {
        return null;
      }
    },
    list: (dir) => readdir(dir),
    isLive: async (sessionId) => {
      // Claude reopened it: a session record with this id whose process is alive.
      for (const n of await readdir(sessionsDir).catch(() => [] as string[])) {
        if (!n.endsWith('.json')) continue;
        try {
          const r = JSON.parse(await readFile(path.join(sessionsDir, n), 'utf8')) as {
            pid?: unknown;
            sessionId?: unknown;
          };
          if (r.sessionId === sessionId && typeof r.pid === 'number' && alive(r.pid)) return true;
        } catch {
          // half-written record
        }
      }
      // Codex unarchived it: its rollout is back under ~/.codex/sessions.
      const found = await new Promise<boolean>((resolve) => {
        execFile(
          'find',
          [codexLive, '-name', `*${sessionId}.jsonl*`, '-print', '-quit'],
          { timeout: 10_000 },
          (err, stdout) => resolve(!err && stdout.trim() !== ''),
        );
      });
      return found;
    },
    trash: (paths) =>
      new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/trash', ['-s', ...paths], { timeout: 60_000 }, (err) =>
          err ? reject(err) : resolve(),
        );
      }),
    appendLog: async (event) => {
      await mkdir(logDir, { recursive: true });
      await appendFile(path.join(logDir, 'session-archive.jsonl'), JSON.stringify(event) + '\n');
    },
    now: () => Date.now(),
  };
}
