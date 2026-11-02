import { archiveConfirmText, type ArchiveProvider } from '../office/sessionArchive.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export interface ArchiveTarget {
  id: number;
  name: string;
  folder: string;
  provider: ArchiveProvider;
}

interface ArchiveConfirmModalProps {
  target: ArchiveTarget | null;
  onCancel: () => void;
  onConfirm: (target: ArchiveTarget) => void;
}

/** mptl fork: one session, one confirm — says what Lưu trữ does for this tool. */
export function ArchiveConfirmModal({ target, onCancel, onConfirm }: ArchiveConfirmModalProps) {
  if (!target) return null;
  return (
    <Modal isOpen onClose={onCancel} title="Lưu trữ phiên?" zIndex={60}>
      <div className="px-10 pb-6 flex flex-col gap-8 max-w-[480px]" data-testid="archive-confirm">
        <div className="text-base text-text">
          <div className="truncate" data-testid="archive-confirm-name">
            {target.name}
          </div>
          <div className="text-sm text-text-muted">
            {target.provider === 'claude' ? 'Claude' : 'Codex'}
            {target.folder && ` · ${target.folder}`}
          </div>
        </div>
        <p className="text-sm text-text m-0" style={{ lineHeight: 1.4 }}>
          {archiveConfirmText(target.provider)}
        </p>
        <div className="flex justify-end gap-6">
          <Button variant="default" size="md" onClick={onCancel} data-testid="archive-cancel">
            Hủy
          </Button>
          <Button
            variant="accent"
            size="md"
            onClick={() => onConfirm(target)}
            data-testid="archive-confirm-button"
          >
            Lưu trữ
          </Button>
        </div>
      </div>
    </Modal>
  );
}
