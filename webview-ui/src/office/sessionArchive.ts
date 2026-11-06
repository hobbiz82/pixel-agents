/**
 * mptl fork: wording and rules for archiving / restoring a session from the
 * office. The server re-checks everything (server/src/sessionArchive.ts); this
 * only decides what the buttons say and when they are offered.
 */
import type { SessionFacts } from './sessionMetaLabels.js';
import type { SessionRow } from './sessionRows.js';

export type ArchiveProvider = 'claude' | 'codex';

export interface ArchivedSession {
  sessionId: string;
  provider: ArchiveProvider;
  name?: string;
  folder?: string;
  archivedAt: number;
}

interface ArchiveInput {
  meta?: SessionFacts;
  attention?: boolean;
}

/** Why Lưu trữ is not offered for this session; null when it is. */
export function archiveBlock({ meta, attention }: ArchiveInput): string | null {
  if (attention || meta?.status === 'waiting') {
    return 'Đang chờ anh trả lời — xong việc rồi mới lưu trữ được';
  }
  if (meta?.status === 'busy') return 'Đang chạy — chờ phiên rảnh rồi mới lưu trữ được';
  if (meta?.provider === 'codex') return null;
  if (meta?.provider === 'claude' && meta.pid !== undefined) return null;
  return 'Chưa rõ phiên này chạy bằng gì — chưa lưu trữ được';
}

export function archiveConfirmText(provider: ArchiveProvider): string {
  return provider === 'claude'
    ? 'Phiên Claude này sẽ bị dừng (như bấm thoát) và nhân vật biến mất khỏi văn phòng. Cuộc trò chuyện không xóa: anh mở lại được trong app Claude, hoặc bằng lệnh ở tab "Đã lưu trữ".'
    : 'Luồng Codex này chuyển vào mục lưu trữ của Codex và nhân vật biến mất khỏi văn phòng. Không xóa gì: bấm Khôi phục ở tab "Đã lưu trữ" để đưa về.';
}

const ARCHIVE_REFUSAL: Record<string, string> = {
  busy: 'Chưa lưu trữ: phiên đang chạy.',
  waiting: 'Chưa lưu trữ: phiên đang chờ anh trả lời.',
  process_changed: 'Chưa lưu trữ: phiên đã đổi hoặc đã tắt, em không đụng vào.',
  unknown: 'Chưa lưu trữ: không tìm thấy phiên này.',
};

export function archiveResultText(r: { ok: boolean; reason?: string; provider?: string }): string {
  if (r.ok) return 'Đã lưu trữ phiên.';
  return ARCHIVE_REFUSAL[r.reason ?? ''] ?? 'Không lưu trữ được, anh thử lại sau.';
}

export function restoreResultText(r: { ok: boolean; reason?: string }): string {
  return r.ok ? 'Đã khôi phục.' : 'Không khôi phục được, anh thử lại sau.';
}

/** Claude sessions are reopened by anh; Codex threads by the Khôi phục button. */
export function restoreHint(s: ArchivedSession): { text: string; command: string | null } {
  return s.provider === 'claude'
    ? {
        text: 'Mở lại trong app Claude, hoặc chạy lệnh:',
        command: `claude --resume ${s.sessionId}`,
      }
    : { text: 'Bấm Khôi phục để đưa luồng về Codex.', command: null };
}

export function parseArchivedSessions(raw: unknown): ArchivedSession[] {
  if (!Array.isArray(raw)) return [];
  const out: ArchivedSession[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.sessionId !== 'string' || !r.sessionId) continue;
    if (r.provider !== 'claude' && r.provider !== 'codex') continue;
    if (typeof r.archivedAt !== 'number') continue;
    const s: ArchivedSession = {
      sessionId: r.sessionId,
      provider: r.provider,
      archivedAt: r.archivedAt,
    };
    if (typeof r.name === 'string') s.name = r.name;
    if (typeof r.folder === 'string') s.folder = r.folder;
    out.push(s);
  }
  return out;
}

/** Most sessions one bulk Lưu trữ sends; the server still checks each one. */
export const BULK_MAX = 20;

export interface BulkTarget {
  id: number;
  name: string;
  folder: string;
  provider: ArchiveProvider;
}

export interface BulkPlan {
  targets: BulkTarget[];
  skipped: { id: number; name: string; reason: string }[];
  /** Picked rows left out because of BULK_MAX. */
  over: number;
}

export function planBulkArchive(rows: SessionRow[]): BulkPlan {
  const plan: BulkPlan = { targets: [], skipped: [], over: 0 };
  for (const r of rows) {
    if (r.archiveBlock || !r.providerId) {
      plan.skipped.push({
        id: r.id,
        name: r.name,
        reason: r.archiveBlock ?? 'Chưa rõ phiên này chạy bằng gì',
      });
    } else if (plan.targets.length >= BULK_MAX) {
      plan.over++;
    } else {
      plan.targets.push({ id: r.id, name: r.name, folder: r.folder, provider: r.providerId });
    }
  }
  return plan;
}

const REFUSAL_SHORT: Record<string, string> = {
  busy: 'phiên đang chạy',
  waiting: 'phiên đang chờ anh trả lời',
  process_changed: 'phiên đã đổi hoặc đã tắt',
  unknown: 'không tìm thấy phiên',
  failed: 'lỗi khi lưu trữ',
};

export function bulkTallyText(t: {
  total: number;
  ok: number;
  refused: Record<string, number>;
}): string {
  const refusedCount = Object.values(t.refused).reduce((a, b) => a + b, 0);
  if (t.ok + refusedCount < t.total) return `Đang lưu trữ… ${t.ok + refusedCount}/${t.total}`;
  const head = `Đã lưu trữ ${t.ok}/${t.total} phiên.`;
  if (refusedCount === 0) return head;
  const entries = Object.entries(t.refused).filter(([, n]) => n > 0);
  const short = (reason: string) => REFUSAL_SHORT[reason] ?? 'lỗi khác';
  const why =
    entries.length === 1
      ? short(entries[0][0])
      : entries.map(([reason, n]) => `${n} ${short(reason)}`).join(', ');
  return `${head} ${refusedCount} phiên không lưu trữ: ${why}.`;
}

export interface BulkTally {
  total: number;
  ok: number;
  refused: Record<string, number>;
  /** Sessions of the batch with no result yet. */
  pending: number[];
}

export function newTally(ids: number[]): BulkTally {
  return { total: ids.length, ok: 0, refused: {}, pending: [...ids] };
}

export function inTally(t: BulkTally | null, id: number): boolean {
  return t !== null && t.pending.includes(id);
}

/** Count one archive result; results outside the batch or repeated are ignored. */
export function tallyAdd(t: BulkTally, r: { id: number; ok: boolean; reason?: string }): BulkTally {
  if (!t.pending.includes(r.id)) return t;
  const pending = t.pending.filter((x) => x !== r.id);
  if (r.ok) return { ...t, ok: t.ok + 1, pending };
  const reason = r.reason || 'failed';
  return { ...t, refused: { ...t.refused, [reason]: (t.refused[reason] ?? 0) + 1 }, pending };
}

export function tallyDone(t: BulkTally): boolean {
  return t.pending.length === 0;
}
