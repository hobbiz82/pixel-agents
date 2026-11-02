import { LONG_IDLE_COLOR } from '../constants.js';
import { useNow } from '../hooks/useNow.js';
import type { SessionRow } from '../office/sessionRows.js';
import { Modal } from './ui/Modal.js';

interface SessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sorted rows at `now` (waiting on anh, running, idle longest first). */
  rowsAt: (now: number) => SessionRow[];
  /** Row click: select and follow that character, then close. */
  onPick: (agentId: number) => void;
}

/**
 * mptl fork: every session in the office as one table — name, tool, folder,
 * status/idle and RAM — so stale sessions are easy to find and clean up.
 */
export function SessionsModal({ isOpen, onClose, rowsAt, onPick }: SessionsModalProps) {
  const now = useNow(isOpen);
  if (!isOpen) return null;
  const rows = rowsAt(now);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Phiên (${rows.length})`}>
      <div className="overflow-x-auto max-w-full">
        <table className="text-sm border-collapse" data-testid="sessions-table">
          <thead>
            <tr className="text-text-muted text-left">
              <th className="py-2 px-6 font-normal">Phiên</th>
              <th className="py-2 px-6 font-normal">Công cụ</th>
              <th className="py-2 px-6 font-normal">Thư mục</th>
              <th className="py-2 px-6 font-normal">Trạng thái</th>
              <th className="py-2 px-6 font-normal text-right">RAM</th>
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
                <td className="py-3 px-6 text-text-muted whitespace-nowrap">{row.folder || '—'}</td>
                <td
                  className={`py-3 px-6 whitespace-nowrap ${row.longIdle ? '' : 'text-text'}`}
                  style={row.longIdle ? { color: LONG_IDLE_COLOR } : undefined}
                >
                  {row.statusText || '—'}
                </td>
                <td className="py-3 px-6 text-text-muted text-right whitespace-nowrap">
                  {row.ramText || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
