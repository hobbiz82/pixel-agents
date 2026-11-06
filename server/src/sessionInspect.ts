/**
 * mptl fork: what a session leaves behind, shown in the Lưu trữ confirm.
 *
 * Read-only. For a Claude session: the processes it started (its process tree,
 * MCP servers counted but not listed since they end with the session) and
 * orphans it likely left (parent gone, running in the session folder, started
 * after the session, not run by launchd), with the ports they listen on; the
 * git branch with changed and unpushed counts; the last prompt and reply.
 * Codex Desktop runs every thread in one app, so a Codex thread has no
 * processes of its own.
 *
 * verifyStopTargets re-checks, right before archiving, the processes anh
 * ticked: same pid AND same start time, still in the tree or still an orphan,
 * never launchd-run, never a claude process, never the session itself.
 */
import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import * as path from 'node:path';

export interface PsRow {
  pid: number;
  ppid: number;
  /** `ps -o lstart` in UTC, C locale. */
  start: string;
  /** First word of the process name, without folders. */
  name: string;
  /** An MCP server (or a launcher of one). */
  mcp: boolean;
}

export interface SessionProcess {
  pid: number;
  start: string;
  name: string;
  ports: number[];
  /** Open TCP connections; a dev server someone is using is not ticked. */
  inbound: number;
  /** Parent is gone (re-parented to launchd's pid 1). */
  orphan: boolean;
  /** Ticked by default in the confirm. */
  suggest: boolean;
  note?: string;
}

export interface GitState {
  branch: string;
  changed: number;
  /** Commits ahead of the upstream; null when the branch has no upstream. */
  unpushed: number | null;
}

export type GitError = 'not_repo' | 'blocked' | 'failed';

export interface SessionInspection {
  processes: SessionProcess[];
  mcpCount: number;
  git?: GitState;
  gitError?: GitError;
  lastPrompt?: string;
  lastReply?: string;
}

export interface InspectTarget {
  provider: 'claude' | 'codex';
  pid?: number;
  cwd?: string;
  /** Transcript (Claude) or rollout (Codex). */
  file?: string;
  /** Folders of the other live sessions: an orphan there may be theirs. */
  otherCwds: string[];
}

export interface InspectIO {
  /** `ps -axo pid=,ppid=,lstart=,args=` with TZ=UTC LC_ALL=C. The arguments are
   *  only searched for "mcp" here and never leave this module. */
  ps(): Promise<string>;
  /** `lsof -nP -iTCP -sTCP:LISTEN -Fpn`. */
  listening(): Promise<string>;
  /** `lsof -nP -iTCP -sTCP:ESTABLISHED -Fpn`. */
  established(): Promise<string>;
  /** `launchctl list`. */
  launchdPids(): Promise<string>;
  /** `lsof -a -d cwd -Fpn -p <pids>`. */
  cwds(pids: number[]): Promise<string>;
  git(cwd: string, args: string[]): Promise<string>;
  tail(file: string, bytes: number): Promise<string>;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/;

export function parsePsRows(out: string): Map<number, PsRow> {
  const rows = new Map<number, PsRow>();
  for (const line of out.split('\n')) {
    const m = PS_LINE.exec(line);
    if (!m) continue;
    const comm = m[4].trim();
    rows.set(Number(m[1]), {
      pid: Number(m[1]),
      ppid: Number(m[2]),
      start: m[3]
        .split(/\s+/)
        .join(' ')
        .replace(/ (\d) /, '  $1 '),
      name: path.basename(comm.split(/\s+/)[0]),
      mcp: /mcp/i.test(comm),
    });
  }
  return rows;
}

function normStart(s: string): string {
  return s.trim().split(/\s+/).join(' ');
}

function startMs(s: string): number {
  return Date.parse(`${normStart(s)} GMT`);
}

/** lsof -F output → pid → listening ports (connection lines "a->b" give none). */
export function parseLsofPorts(out: string): Map<number, number[]> {
  const map = new Map<number, number[]>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1));
      if (!map.has(pid)) map.set(pid, []);
    } else if (line.startsWith('n') && pid !== null && !line.includes('->')) {
      const port = Number(line.slice(1).split(':').pop());
      const list = map.get(pid) as number[];
      if (Number.isInteger(port) && port > 0 && !list.includes(port)) list.push(port);
    }
  }
  return map;
}

function countByPid(out: string): Map<number, number> {
  const map = new Map<number, number>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) map.set(pid, (map.get(pid) ?? 0) + 1);
  }
  return map;
}

function cwdByPid(out: string): Map<number, string> {
  const map = new Map<number, string>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) map.set(pid, line.slice(1));
  }
  return map;
}

/** `launchctl list` → pids launchd runs. */
export function parseLaunchctl(out: string): Set<number> {
  const pids = new Set<number>();
  for (const line of out.split('\n').slice(1)) {
    const first = line.split('\t', 1)[0].trim();
    if (/^\d+$/.test(first)) pids.add(Number(first));
  }
  return pids;
}

function children(rows: Map<number, PsRow>): Map<number, number[]> {
  const kids = new Map<number, number[]>();
  for (const r of rows.values()) {
    if (r.ppid === r.pid) continue;
    const list = kids.get(r.ppid);
    if (list) list.push(r.pid);
    else kids.set(r.ppid, [r.pid]);
  }
  return kids;
}

/** Every process under `root` (not root itself); `skip` prunes a whole branch. */
function subtree(
  root: number,
  kids: Map<number, number[]>,
  skip: (pid: number) => boolean = () => false,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>([root]);
  const stack = [...(kids.get(root) ?? [])].reverse();
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (skip(pid)) continue;
    out.push(pid);
    stack.push(...[...(kids.get(pid) ?? [])].reverse());
  }
  return out;
}

/** launchd-run processes and everything under them: never touched. */
function managedSet(rows: Map<number, PsRow>, launchd: Set<number>): Set<number> {
  const kids = children(rows);
  const managed = new Set<number>();
  for (const pid of launchd) {
    if (!rows.has(pid)) continue;
    managed.add(pid);
    for (const p of subtree(pid, kids)) managed.add(p);
  }
  return managed;
}

function inside(dir: string, root: string): boolean {
  const r = root.replace(/\/+$/, '');
  return dir === r || dir.startsWith(`${r}/`);
}

export function parseGitStatus(out: string): GitState {
  let branch = '';
  let unpushed: number | null = null;
  let changed = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.ab ')) {
      const ahead = /\+(\d+)/.exec(line);
      unpushed = ahead ? Number(ahead[1]) : 0;
    } else if (line.trim() && !line.startsWith('#')) changed++;
  }
  return { branch, changed, unpushed };
}

const MAX_TEXT = 280;

function clean(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat || flat.startsWith('<')) return undefined;
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat;
}

function textOf(content: unknown, kinds: string[]): string | undefined {
  if (typeof content === 'string') return clean(content);
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter(
      (c): c is { type: string; text: string } =>
        !!c && typeof c === 'object' && kinds.includes(c.type) && typeof c.text === 'string',
    )
    .map((c) => c.text);
  return parts.length > 0 ? clean(parts.join(' ')) : undefined;
}

/** Last real prompt and reply in a Claude transcript or Codex rollout tail. */
export function lastMessages(tail: string): { lastPrompt?: string; lastReply?: string } {
  let lastPrompt: string | undefined;
  let lastReply: string | undefined;
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // the first line of a tail is usually cut
    }
    if (e.type === 'user' && !e.isMeta && !e.isSidechain) {
      const msg = e.message as { content?: unknown } | undefined;
      const t = textOf(msg?.content, ['text']);
      if (t) lastPrompt = t;
    } else if (e.type === 'assistant' && !e.isSidechain) {
      const msg = e.message as { content?: unknown } | undefined;
      const t = textOf(msg?.content, ['text']);
      if (t) lastReply = t;
    } else if (e.type === 'response_item') {
      const p = e.payload as { type?: string; role?: string; content?: unknown } | undefined;
      if (p?.type !== 'message') continue;
      if (p.role === 'user') {
        const t = textOf(p.content, ['input_text']);
        if (t) lastPrompt = t;
      } else if (p.role === 'assistant') {
        const t = textOf(p.content, ['output_text']);
        if (t) lastReply = t;
      }
    }
  }
  const out: { lastPrompt?: string; lastReply?: string } = {};
  if (lastPrompt) out.lastPrompt = lastPrompt;
  if (lastReply) out.lastReply = lastReply;
  return out;
}

function gitError(err: unknown): GitError {
  const e = err as { stderr?: unknown; message?: unknown; code?: unknown };
  const text = `${String(e?.stderr ?? '')} ${String(e?.message ?? '')}`;
  if (/not a git repository/i.test(text)) return 'not_repo';
  if (/operation not permitted|EPERM|EACCES/i.test(text) || e?.code === 'EPERM') return 'blocked';
  return 'failed';
}

async function sessionProcesses(
  pid: number,
  cwd: string | undefined,
  otherCwds: string[],
  io: InspectIO,
): Promise<{ processes: SessionProcess[]; mcpCount: number }> {
  const [psOut, listenOut, estOut, launchdOut] = await Promise.all([
    io.ps(),
    io.listening().catch(() => ''),
    io.established().catch(() => ''),
    io.launchdPids().catch(() => ''),
  ]);
  const rows = parsePsRows(psOut);
  const session = rows.get(pid);
  if (!session) return { processes: [], mcpCount: 0 };
  const kids = children(rows);
  const ports = parseLsofPorts(listenOut);
  const conns = countByPid(estOut);
  const managed = managedSet(rows, parseLaunchctl(launchdOut));

  let mcpCount = 0;
  const tree = subtree(pid, kids, (p) => {
    if (rows.get(p)?.mcp) {
      mcpCount++;
      return true;
    }
    return false;
  });
  const describe = (r: PsRow, orphan: boolean, ambiguous: boolean): SessionProcess => {
    const inbound = conns.get(r.pid) ?? 0;
    const p: SessionProcess = {
      pid: r.pid,
      start: r.start,
      name: r.name,
      ports: ports.get(r.pid) ?? [],
      inbound,
      orphan,
      suggest: inbound === 0 && !ambiguous,
    };
    if (inbound > 0) p.note = 'Đang có kết nối';
    else if (ambiguous) p.note = 'Có thể của phiên khác cùng thư mục';
    return p;
  };
  const processes = tree
    .map((p) => rows.get(p) as PsRow)
    .filter((r) => r.name !== 'ps')
    .map((r) => describe(r, false, false));

  if (cwd) {
    const since = startMs(session.start);
    const candidates = [...rows.values()].filter(
      (r) =>
        r.ppid === 1 &&
        r.pid !== pid &&
        !managed.has(r.pid) &&
        !/claude/i.test(r.name) &&
        startMs(r.start) > since,
    );
    if (candidates.length > 0) {
      const where = cwdByPid(await io.cwds(candidates.map((r) => r.pid)).catch(() => ''));
      for (const r of candidates) {
        const dir = where.get(r.pid);
        if (!dir || !inside(dir, cwd)) continue;
        const ambiguous = otherCwds.some((o) => inside(dir, o));
        processes.push(describe(r, true, ambiguous));
      }
    }
  }
  return { processes, mcpCount };
}

export async function inspectSession(
  target: InspectTarget,
  io: InspectIO,
): Promise<SessionInspection> {
  const out: SessionInspection = { processes: [], mcpCount: 0 };
  const work: Promise<void>[] = [];
  if (target.provider === 'claude' && target.pid) {
    work.push(
      sessionProcesses(target.pid, target.cwd, target.otherCwds, io).then(
        (r) => {
          out.processes = r.processes;
          out.mcpCount = r.mcpCount;
        },
        () => undefined,
      ),
    );
  }
  if (target.cwd) {
    work.push(
      io.git(target.cwd, ['status', '--porcelain=v2', '--branch']).then(
        (s) => {
          out.git = parseGitStatus(s);
        },
        (err: unknown) => {
          out.gitError = gitError(err);
        },
      ),
    );
  }
  if (target.file) {
    const file = target.file;
    work.push(
      (async () => {
        // Long tool output can push the last prompt far back: widen once.
        let found = lastMessages(await io.tail(file, 256 * 1024));
        if (!found.lastPrompt) found = lastMessages(await io.tail(file, 4 * 1024 * 1024));
        Object.assign(out, found);
      })().catch(() => undefined),
    );
  }
  await Promise.all(work);
  return out;
}

/** The ticked processes that are still what anh saw: pid + start time, in the tree or orphaned. */
export function verifyStopTargets(
  picked: { pid: number; start: string }[],
  ctx: { sessionPid: number; rows: Map<number, PsRow>; launchd: Set<number> },
): number[] {
  const managed = managedSet(ctx.rows, ctx.launchd);
  const tree = new Set(subtree(ctx.sessionPid, children(ctx.rows)));
  const ok: number[] = [];
  for (const { pid, start } of picked) {
    const r = ctx.rows.get(pid);
    if (!r || pid === ctx.sessionPid || normStart(r.start) !== normStart(start)) continue;
    if (managed.has(pid) || /claude/i.test(r.name)) continue;
    if (!tree.has(pid) && r.ppid !== 1) continue;
    if (!ok.includes(pid)) ok.push(pid);
  }
  return ok;
}

function run(file: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd,
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      },
      (err, stdout, stderr) =>
        err ? reject(Object.assign(err, { stderr: String(stderr) })) : resolve(stdout),
    );
  });
}

/**
 * One machine snapshot (ps, lsof, launchctl) shared by a burst of inspections:
 * opening the confirm for 20 sessions runs each command once, not 20 times.
 * Per-session reads (git, tail, cwd) are not shared. Failures are not kept.
 */
export function sharedSnapshots(
  io: InspectIO,
  ttlMs = 3000,
  now: () => number = Date.now,
): InspectIO {
  const memo = <K extends 'ps' | 'listening' | 'established' | 'launchdPids'>(key: K) => {
    let at = -Infinity;
    let value: Promise<string> | null = null;
    return (): Promise<string> => {
      if (value && now() - at <= ttlMs) return value;
      at = now();
      const p = io[key]();
      value = p;
      p.catch(() => {
        if (value === p) value = null;
      });
      return p;
    };
  };
  return {
    ...io,
    ps: memo('ps'),
    listening: memo('listening'),
    established: memo('established'),
    launchdPids: memo('launchdPids'),
  };
}

export function defaultInspectIO(): InspectIO {
  return {
    ps: () => run('ps', ['-axo', 'pid=,ppid=,lstart=,args=']),
    // lsof exits 1 when nothing matches: that is an empty answer, not an error.
    listening: () => run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).catch(() => ''),
    established: () => run('lsof', ['-nP', '-iTCP', '-sTCP:ESTABLISHED', '-Fpn']).catch(() => ''),
    launchdPids: () => run('launchctl', ['list']),
    cwds: (pids) => run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')]).catch(() => ''),
    // --no-optional-locks: a read must not refresh (write) the repo's index.
    git: (cwd, args) => run('git', ['--no-optional-locks', '-C', cwd, ...args]),
    tail: async (file, bytes) => {
      const fh = await open(file, 'r');
      try {
        const { size } = await fh.stat();
        const len = Math.min(size, bytes);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, size - len);
        return buf.toString('utf8');
      } finally {
        await fh.close();
      }
    },
  };
}
