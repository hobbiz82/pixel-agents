import { useState } from 'react';

import { LONG_IDLE_COLOR } from '../constants.js';
import { useNow } from '../hooks/useNow.js';
import { type ArchivedSession, restoreHint } from '../office/sessionArchive.js';
import { providerTag } from '../office/sessionMetaLabels.js';
import type { SessionRow } from '../office/sessionRows.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface SessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sorted rows at `now` (waiting on anh, running, idle longest first). */
  rowsAt: (now: number) => SessionRow[];
  /** Row click: select and follow that character, then close. */
  onPick: (agentId: number) => void;
  /** mptl fork: Lưu trữ for one row (opens the confirm). Absent in a read-only
   *  office, which then shows no action column and no archive tab. */
  onArchive?: (row: SessionRow) => void;
  archived?: ArchivedSession[];
  onRestore?: (session: ArchivedSession) => void;
}

const ARCHIVED_AT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function copy(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // clipboard blocked (http, old browser): the command stays visible to copy by hand
  }
}

/**
 * mptl fork: every session in the office as one table — name, tool, folder,
 * status/idle and RAM — so stale sessions are easy to find and clean up.
 */
export function SessionsModal({
  isOpen,
  onClose,
  rowsAt,
  onPick,
  onArchive,
  archived = [],
  onRestore,
}: SessionsModalProps) {
  const now = useNow(isOpen);
  const [tab, setTab] = useState<'live' | 'archived'>('live');
  if (!isOpen) return null;
  const rows = rowsAt(now);
  const canArchive = onArchive !== undefined;
  const showArchived = canArchive && tab === 'archived';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Phiên (${rows.length})`}>
      {canArchive && (
        <div className="flex gap-4 px-6 pb-4" role="tablist">
          <Button
            variant={tab === 'live' ? 'active' : 'default'}
            size="sm"
            role="tab"
            aria-selected={tab === 'live'}
            onClick={() => setTab('live')}
            data-testid="sessions-tab-live"
          >
            Đang mở ({rows.length})
          </Button>
          <Button
            variant={tab === 'archived' ? 'active' : 'default'}
            size="sm"
            role="tab"
            aria-selected={tab === 'archived'}
            onClick={() => setTab('archived')}
            data-testid="sessions-tab-archived"
          >
            Đã lưu trữ ({archived.length})
          </Button>
        </div>
      )}
      <div className="overflow-x-auto max-w-full">
        {showArchived ? (
          <ArchivedTable archived={archived} onRestore={onRestore} />
        ) : (
          <table className="text-sm border-collapse" data-testid="sessions-table">
            <thead>
              <tr className="text-text-muted text-left">
                <th className="py-2 px-6 font-normal">Phiên</th>
                <th className="py-2 px-6 font-normal">Công cụ</th>
                <th className="py-2 px-6 font-normal">Thư mục</th>
                <th className="py-2 px-6 font-normal">Trạng thái</th>
                <th className="py-2 px-6 font-normal text-right">RAM</th>
                {canArchive && <th className="py-2 px-6 font-normal" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-border hover:bg-btn-hover"
                  onClick={() => onPick(row.id)}
                  title="Bấm để tới nhân vật này"
                  data-testid="sessions-row"
                >
                  <td className="py-3 px-6 text-text max-w-[360px] truncate">{row.name}</td>
                  <td className="py-3 px-6 whitespace-nowrap">
                    {row.provider ? (
                      <span style={{ color: row.provider.color }}>{row.provider.label}</span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-3 px-6 text-text-muted whitespace-nowrap">
                    {row.folder || '—'}
                  </td>
                  <td
                    className={`py-3 px-6 whitespace-nowrap ${row.longIdle ? '' : 'text-text'}`}
                    style={row.longIdle ? { color: LONG_IDLE_COLOR } : undefined}
                  >
                    {row.statusText || '—'}
                  </td>
                  <td className="py-3 px-6 text-text-muted text-right whitespace-nowrap">
                    {row.ramText || '—'}
                  </td>
                  {canArchive && (
                    <td className="py-2 px-6 whitespace-nowrap">
                      <Button
                        variant={row.archiveBlock ? 'disabled' : 'default'}
                        size="sm"
                        aria-disabled={row.archiveBlock !== null}
                        title={row.archiveBlock ?? 'Lưu trữ phiên này (có hỏi lại)'}
                        data-testid="sessions-archive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!row.archiveBlock) onArchive(row);
                        }}
                      >
                        Lưu trữ
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

function ArchivedTable({
  archived,
  onRestore,
}: {
  archived: ArchivedSession[];
  onRestore?: (session: ArchivedSession) => void;
}) {
  if (archived.length === 0) {
    return (
      <p className="text-sm text-text-muted px-6 py-8 m-0" data-testid="archived-empty">
        Chưa lưu trữ phiên nào.
      </p>
    );
  }
  return (
    <table className="text-sm border-collapse" data-testid="archived-table">
      <thead>
        <tr className="text-text-muted text-left">
          <th className="py-2 px-6 font-normal">Phiên</th>
          <th className="py-2 px-6 font-normal">Công cụ</th>
          <th className="py-2 px-6 font-normal">Thư mục</th>
          <th className="py-2 px-6 font-normal">Lưu lúc</th>
          <th className="py-2 px-6 font-normal">Mở lại</th>
        </tr>
      </thead>
      <tbody>
        {archived.map((s) => {
          const tag = providerTag(s);
          const hint = restoreHint(s);
          return (
            <tr key={s.sessionId} className="border-t border-border" data-testid="archived-row">
              <td className="py-3 px-6 text-text max-w-[300px] truncate">
                {s.name || s.folder || s.sessionId}
              </td>
              <td className="py-3 px-6 whitespace-nowrap">
                {tag && <span style={{ color: tag.color }}>{tag.label}</span>}
              </td>
              <td className="py-3 px-6 text-text-muted whitespace-nowrap">{s.folder || '—'}</td>
              <td className="py-3 px-6 text-text-muted whitespace-nowrap">
                {ARCHIVED_AT.format(s.archivedAt)}
              </td>
              <td className="py-2 px-6">
                <div className="flex flex-col gap-2 items-start">
                  <span className="text-xs text-text-muted">{hint.text}</span>
                  {hint.command && (
                    <span className="flex items-center gap-4">
                      <code className="text-xs text-text select-all" data-testid="archived-command">
                        {hint.command}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Chép lệnh"
                        onClick={() => copy(hint.command as string)}
                      >
                        Chép
                      </Button>
                    </span>
                  )}
                  {onRestore && (
                    <Button
                      variant="default"
                      size="sm"
                      title={
                        s.provider === 'codex'
                          ? 'Đưa luồng về Codex'
                          : 'Bỏ khỏi danh sách này (phiên mở lại bằng app Claude hoặc lệnh trên)'
                      }
                      data-testid="archived-restore"
                      onClick={() => onRestore(s)}
                    >
                      {s.provider === 'codex' ? 'Khôi phục' : 'Bỏ khỏi danh sách'}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
