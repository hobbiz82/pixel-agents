import { useState } from 'react';

import type { ArchivedSession } from '../office/sessionArchive.js';
import { deleteConfirmOk } from '../office/sessionInspection.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface DeleteArchivedModalProps {
  sessions: ArchivedSession[] | null;
  onCancel: () => void;
  onConfirm: (sessions: ArchivedSession[]) => void;
}

const WARN = { color: 'var(--color-status-error)' };

/**
 * mptl fork: asks twice before an archived session's history goes to the
 * macOS Trash — says exactly what moves, and anh types the number of sessions.
 */
export function DeleteArchivedModal({ sessions, onCancel, onConfirm }: DeleteArchivedModalProps) {
  const [typed, setTyped] = useState('');
  if (!sessions || sessions.length === 0) return null;
  const n = sessions.length;
  const ready = deleteConfirmOk(typed, n);
  const close = () => {
    setTyped('');
    onCancel();
  };
  return (
    <Modal isOpen onClose={close} title={`Bỏ ${n} phiên vào Thùng rác?`} zIndex={60}>
      <div className="px-10 pb-6 flex flex-col gap-8 max-w-[520px]" data-testid="delete-confirm">
        <ul className="m-0 p-0 list-none flex flex-col gap-2 max-h-[200px] overflow-y-auto">
          {sessions.map((s) => (
            <li key={s.sessionId} className="text-sm text-text truncate" data-testid="delete-item">
              {s.provider === 'claude' ? 'Claude' : 'Codex'} · {s.name || s.folder || s.sessionId}
            </li>
          ))}
        </ul>
        <div className="text-sm text-text flex flex-col gap-2" style={{ lineHeight: 1.4 }}>
          <span>Em chuyển vào Thùng rác của macOS (Finder):</span>
          <span className="text-text-muted">
            · Claude: file cuộc trò chuyện, thư mục phụ cùng tên và bản sao file đã sửa
          </span>
          <span className="text-text-muted">· Codex: file luồng trong mục lưu trữ của Codex</span>
          <span className="text-text-muted">Code trong thư mục project không bị đụng tới.</span>
          <span style={WARN}>
            Sau đó app Claude/Codex không mở lại được các phiên này. Muốn lấy lại: mở Thùng rác →
            chuột phải → Đưa trở lại. Đổ Thùng rác là mất hẳn.
          </span>
        </div>
        <label className="text-sm text-text flex flex-col gap-2">
          Gõ số {n} để xác nhận
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="numeric"
            className="px-6 py-2 bg-btn-bg border-2 border-border text-text text-base outline-none w-[120px]"
            data-testid="delete-confirm-input"
          />
        </label>
        <div className="flex justify-end gap-6">
          <Button variant="default" size="md" onClick={close} data-testid="delete-cancel">
            Hủy
          </Button>
          <Button
            variant={ready ? 'accent' : 'disabled'}
            size="md"
            disabled={!ready}
            aria-disabled={!ready}
            onClick={() => {
              if (!ready) return;
              setTyped('');
              onConfirm(sessions);
            }}
            data-testid="delete-confirm-button"
          >
            Bỏ vào Thùng rác
          </Button>
        </div>
      </div>
    </Modal>
  );
}
