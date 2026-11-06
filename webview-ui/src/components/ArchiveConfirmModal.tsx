import {
  archiveConfirmText,
  type ArchiveProvider,
  BULK_MAX,
  type BulkPlan,
} from '../office/sessionArchive.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export interface ArchiveTarget {
  id: number;
  name: string;
  folder: string;
  provider: ArchiveProvider;
}

interface ArchiveConfirmModalProps {
  /** One session (the row button) or several (the bulk bar). */
  plan: BulkPlan | null;
  onCancel: () => void;
  onConfirm: (targets: ArchiveTarget[]) => void;
}

/**
 * mptl fork: one confirm per Lưu trữ action — says what Lưu trữ does for each
 * tool, lists the sessions it acts on and the picked ones it skips, and why.
 */
export function ArchiveConfirmModal({ plan, onCancel, onConfirm }: ArchiveConfirmModalProps) {
  if (!plan) return null;
  const { targets, skipped, over } = plan;
  const tools = [...new Set(targets.map((t) => t.provider))];
  const single = targets.length === 1 && skipped.length === 0 && over === 0;
  const title = single ? 'Lưu trữ phiên?' : `Lưu trữ ${targets.length} phiên?`;
  return (
    <Modal isOpen onClose={onCancel} title={title} zIndex={60}>
      <div className="px-10 pb-6 flex flex-col gap-8 max-w-[520px]" data-testid="archive-confirm">
        {targets.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col gap-2 max-h-[220px] overflow-y-auto">
            {targets.map((t) => (
              <li key={t.id} className="text-base text-text" data-testid="archive-confirm-item">
                <div className="truncate" data-testid="archive-confirm-name">
                  {t.name}
                </div>
                <div className="text-sm text-text-muted">
                  {t.provider === 'claude' ? 'Claude' : 'Codex'}
                  {t.folder && ` · ${t.folder}`}
                </div>
              </li>
            ))}
          </ul>
        )}
        {tools.map((p) => (
          <p key={p} className="text-sm text-text m-0" style={{ lineHeight: 1.4 }}>
            {archiveConfirmText(p)}
          </p>
        ))}
        {(skipped.length > 0 || over > 0) && (
          <div
            className="text-sm flex flex-col gap-2"
            style={{ color: 'var(--color-status-error)' }}
            data-testid="archive-confirm-skipped"
          >
            {skipped.length > 0 && <span>Bỏ qua {skipped.length} phiên:</span>}
            {skipped.map((s) => (
              <span key={s.id} className="truncate text-text-muted">
                · {s.name} — {s.reason}
              </span>
            ))}
            {over > 0 && (
              <span>
                Mỗi lần tối đa {BULK_MAX} phiên: {over} phiên còn lại để lần sau.
              </span>
            )}
          </div>
        )}
        <div className="flex justify-end gap-6">
          <Button variant="default" size="md" onClick={onCancel} data-testid="archive-cancel">
            Hủy
          </Button>
          <Button
            variant={targets.length > 0 ? 'accent' : 'disabled'}
            size="md"
            disabled={targets.length === 0}
            onClick={() => onConfirm(targets)}
            data-testid="archive-confirm-button"
          >
            {single ? 'Lưu trữ' : `Lưu trữ ${targets.length} phiên`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
