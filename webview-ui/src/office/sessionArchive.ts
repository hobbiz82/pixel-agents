/**
 * mptl fork: wording and rules for archiving / restoring a session from the
 * office. The server re-checks everything (server/src/sessionArchive.ts); this
 * only decides what the buttons say and when they are offered.
 */
import type { SessionFacts } from './sessionMetaLabels.js';

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
