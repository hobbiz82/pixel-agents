import { useEffect, useRef } from 'react';

import { characterMenuActions } from '../office/cardBarQuery.js';
import type { SessionRow } from '../office/sessionRows.js';
import { Button } from './ui/Button.js';

const MENU_WIDTH_PX = 280;
const MENU_HEIGHT_PX = 260;

interface CharacterMenuProps {
  row: SessionRow;
  /** Where anh right-clicked, in viewport px. */
  x: number;
  y: number;
  readOnly: boolean;
  onArchive: (agentId: number) => void;
  onOpenSessions: () => void;
  onClose: () => void;
}

/**
 * mptl fork (Đ2.1): right-click menu of a character — the session's facts and
 * what can be done with it. Lưu trữ goes through the usual confirm; Thùng rác
 * only exists for archived sessions, so here it says how to get there.
 */
export function CharacterMenu({
  row,
  x,
  y,
  readOnly,
  onArchive,
  onOpenSessions,
  onClose,
}: CharacterMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const actions = characterMenuActions(row, readOnly);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPress = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH_PX - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT_PX - 8));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Phiên ${row.name}`}
      className="fixed z-[60] flex flex-col gap-2 p-4 bg-bg border-2 border-border shadow-pixel text-sm"
      style={{ left, top, width: MENU_WIDTH_PX }}
      data-testid="character-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="text-text break-words" data-testid="character-menu-name">
        {row.name}
      </div>
      <div className="text-xs leading-snug">
        {row.provider && <span style={{ color: row.provider.color }}>{row.provider.label}</span>}
        {row.provider && row.statusText && <span className="text-text-muted"> · </span>}
        <span className={row.longIdle ? undefined : 'text-text-muted'}>{row.statusText}</span>
        {row.ramText && <span className="text-text-muted"> · RAM {row.ramText}</span>}
      </div>
      {row.whereText && (
        <div className="text-xs text-text-muted" data-testid="session-where">
          {row.whereText}
        </div>
      )}
      {row.project && <div className="text-xs text-text-muted">Project: {row.project}</div>}
      {row.folder && row.folder !== row.project && (
        <div className="text-xs text-text-muted break-all">Thư mục: {row.folder}</div>
      )}
      <div className="flex flex-col gap-2 pt-2">
        <Button
          size="sm"
          variant={actions.archive.enabled ? 'default' : 'disabled'}
          disabled={!actions.archive.enabled}
          title={actions.archive.reason ?? 'Lưu trữ phiên này (có bước xác nhận)'}
          role="menuitem"
          data-testid="character-menu-archive"
          onClick={() => {
            onClose();
            onArchive(row.id);
          }}
        >
          Lưu trữ…
        </Button>
        {actions.archive.reason && (
          <div
            className="text-xs text-text-muted leading-snug"
            data-testid="character-menu-archive-reason"
          >
            {actions.archive.reason}
          </div>
        )}
        <Button
          size="sm"
          variant="disabled"
          disabled
          title={actions.trash.reason ?? undefined}
          role="menuitem"
          data-testid="character-menu-trash"
        >
          Bỏ vào Thùng rác
        </Button>
        <div className="text-xs text-text-muted leading-snug">{actions.trash.reason}</div>
        <Button
          size="sm"
          role="menuitem"
          data-testid="character-menu-sessions"
          onClick={() => {
            onClose();
            onOpenSessions();
          }}
        >
          Mở bảng Phiên
        </Button>
      </div>
    </div>
  );
}
