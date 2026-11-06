/**
 * mptl fork: what the Lưu trữ confirm shows about a session — git state, the
 * processes it started (ticked = stop them with the session), last prompt and
 * reply — and the wording of Bỏ vào Thùng rác. The server reads and re-checks
 * everything (server/src/sessionInspect.ts, sessionTrash.ts).
 */

export interface InspectedProcess {
  pid: number;
  start: string;
  name: string;
  ports: number[];
  inbound: number;
  orphan: boolean;
  suggest: boolean;
  note?: string;
}

export interface GitState {
  branch: string;
  changed: number;
  unpushed: number | null;
}

export interface Inspection {
  id: number;
  ok: boolean;
  processes: InspectedProcess[];
  mcpCount: number;
  git?: GitState;
  gitError?: string;
  lastPrompt?: string;
  lastReply?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseProcess(v: unknown): InspectedProcess | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!isNum(r.pid) || typeof r.start !== 'string' || typeof r.name !== 'string') return null;
  const p: InspectedProcess = {
    pid: r.pid,
    start: r.start,
    name: r.name,
    ports: Array.isArray(r.ports) ? r.ports.filter(isNum) : [],
    inbound: isNum(r.inbound) ? r.inbound : 0,
    orphan: r.orphan === true,
    suggest: r.suggest === true,
  };
  if (typeof r.note === 'string') p.note = r.note;
  return p;
}

export function parseInspection(msg: Record<string, unknown>): Inspection | null {
  if (msg.type !== 'sessionInspection' || !isNum(msg.id)) return null;
  const out: Inspection = {
    id: msg.id,
    ok: msg.ok === true,
    processes: Array.isArray(msg.processes)
      ? msg.processes.map(parseProcess).filter((p): p is InspectedProcess => p !== null)
      : [],
    mcpCount: isNum(msg.mcpCount) ? msg.mcpCount : 0,
  };
  const g = msg.git as Record<string, unknown> | undefined;
  if (g && typeof g.branch === 'string' && isNum(g.changed)) {
    out.git = {
      branch: g.branch,
      changed: g.changed,
      unpushed: isNum(g.unpushed) ? g.unpushed : null,
    };
  }
  if (typeof msg.gitError === 'string') out.gitError = msg.gitError;
  if (typeof msg.lastPrompt === 'string') out.lastPrompt = msg.lastPrompt;
  if (typeof msg.lastReply === 'string') out.lastReply = msg.lastReply;
  return out;
}

/** One line about unsaved work; warn = show it red. Null when nothing is known. */
export function gitLine(
  git: GitState | undefined,
  gitError?: string,
): { text: string; warn: boolean } | null {
  if (!git) {
    if (gitError === 'blocked') {
      return {
        text: 'Chưa đọc được git: macOS chặn quyền mở thư mục này',
        warn: true,
      };
    }
    if (gitError === 'not_repo') return { text: 'Thư mục không phải repo git', warn: false };
    if (gitError) return { text: 'Chưa đọc được git', warn: true };
    return null;
  }
  const parts = [`Nhánh ${git.branch || '(không rõ)'}`];
  if (git.changed > 0) parts.push(`${git.changed} file chưa commit`);
  if (git.unpushed === null) parts.push('chưa từng push');
  else if (git.unpushed > 0) parts.push(`${git.unpushed} commit chưa push`);
  const warn = git.changed > 0 || git.unpushed === null || git.unpushed > 0;
  if (!warn) parts.push('đã lưu hết');
  return { text: parts.join(' · '), warn };
}

export function processLabel(p: InspectedProcess): string {
  const bits = [p.name];
  if (p.ports.length > 0) bits.push(`cổng ${p.ports.join(', ')}`);
  if (p.note) bits.push(p.note);
  else if (p.orphan) bits.push('bị bỏ lại');
  return bits.join(' · ');
}

/** pids ticked by default: what the server suggests stopping. */
export function defaultStops(processes: InspectedProcess[]): number[] {
  return processes.filter((p) => p.suggest).map((p) => p.pid);
}

/** The typed confirmation for Bỏ vào Thùng rác: exactly the number of sessions. */
export function deleteConfirmOk(typed: string, count: number): boolean {
  return typed.trim() === String(count);
}

const DELETE_REFUSAL: Record<string, string> = {
  live: 'đang chạy lại nên không xóa',
  unknown: 'không còn trong danh sách lưu trữ',
  failed: 'lỗi khi bỏ vào Thùng rác',
};

export function deleteResultText(r: {
  total: number;
  ok: number;
  items: number;
  refused: Record<string, number>;
}): string {
  const reasons = Object.entries(r.refused)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} phiên ${DELETE_REFUSAL[k] ?? 'lỗi khác'}`);
  if (r.ok === 0) {
    const onlyFailed = Object.keys(r.refused).every((k) => k === 'failed');
    return onlyFailed
      ? `Không xóa được ${r.total} phiên, anh thử lại sau.`
      : `Không xóa phiên nào: ${reasons.join('; ')}.`;
  }
  if (reasons.length === 0) {
    return `Đã bỏ ${r.ok} phiên vào Thùng rác (${r.items} mục). Mở Thùng rác để lấy lại nếu cần.`;
  }
  return `Đã bỏ ${r.ok}/${r.total} phiên vào Thùng rác (${r.items} mục). ${reasons.join('; ')}.`;
}
