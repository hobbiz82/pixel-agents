import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  type ProviderQuota,
  quotaLevel,
  type QuotaView,
  type QuotaWindow,
  resetLabel,
  worstPercent,
} from '../office/assistView.js';
import { Button } from './ui/Button.js';

const TEXT_LEVEL = {
  ok: 'text-status-success',
  warn: 'text-warning',
  high: 'text-danger',
} as const;
const BAR_LEVEL = { ok: 'bg-status-success', warn: 'bg-warning', high: 'bg-danger' } as const;

interface QuotaPanelProps {
  quota: QuotaView;
  readOnly: boolean;
  onSetClaudeReader: (enabled: boolean) => void;
}

function WindowRow({ label, w, now }: { label: string; w: QuotaWindow; now: number }) {
  const level = quotaLevel(w.usedPercent);
  const pct = Math.max(0, Math.min(100, w.usedPercent));
  return (
    <div className="flex flex-col gap-1" data-testid="quota-window">
      <div className="flex justify-between gap-4 text-xs">
        <span className="text-text-muted">{label}</span>
        <span>
          <span className={TEXT_LEVEL[level]}>{Math.round(w.usedPercent)}%</span>
          <span className="text-text-muted"> · {resetLabel(w.resetsAt, now)}</span>
        </span>
      </div>
      <div className="h-6 bg-bg-dark border border-border">
        <div className={`h-full ${BAR_LEVEL[level]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ProviderBlock({ q, now }: { q: ProviderQuota; now: number }) {
  return (
    <>
      {q.fiveHour && <WindowRow label="5 giờ" w={q.fiveHour} now={now} />}
      {q.sevenDay && <WindowRow label="7 ngày" w={q.sevenDay} now={now} />}
    </>
  );
}

/**
 * mptl fork (Đ3): usage limits of Claude and Codex. The toolbar button shows
 * the highest usage; the panel shows each window with its reset time.
 */
export function QuotaPanel({ quota, readOnly, onSetClaudeReader }: QuotaPanelProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed position from the button: the toolbar sits under the character
  // labels (z 41–43), so the panel is portalled above them.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    const onPress = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPress);
    return () => {
      clearInterval(timer);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  const worst = worstPercent(quota);
  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          if (r) setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 8 });
          setOpen(!open);
        }}
        title="Hạn mức Claude + Codex"
        data-testid="quota-button"
        variant={open ? 'active' : 'default'}
      >
        Quota
        {worst !== null && (
          <span className={`ml-4 ${TEXT_LEVEL[quotaLevel(worst)]}`}>{Math.round(worst)}%</span>
        )}
      </Button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50 w-[300px] max-w-[calc(100vw-32px)] flex flex-col gap-4 p-6 bg-bg border-2 border-border shadow-pixel text-sm break-words"
            style={{
              left: Math.max(8, Math.min(anchor.left, window.innerWidth - 308)),
              bottom: anchor.bottom,
            }}
            data-testid="quota-panel"
          >
            <div className="text-text">Claude</div>
            {quota.claude ? (
              <ProviderBlock q={quota.claude} now={now} />
            ) : (
              <div
                className="text-xs text-text-muted leading-snug"
                data-testid="quota-claude-empty"
              >
                {quota.claudeReader === 'other' &&
                  'Anh đang có status line riêng nên em không cài bộ đọc hạn mức Claude (không thay của anh).'}
                {quota.claudeReader === 'ours' &&
                  'Đã bật. Số liệu có khi 1 phiên Claude trả lời câu kế tiếp.'}
                {quota.claudeReader === 'none' &&
                  'Claude chỉ báo hạn mức cho "status line". Bật để em thêm 1 status line vào ~/.claude/settings.json; nó chỉ ghi % đã dùng + giờ reset vào ~/.pixel-agents. Tắt được ở đây.'}
              </div>
            )}
            {!readOnly && quota.claudeReader === 'none' && (
              <Button
                size="sm"
                onClick={() => onSetClaudeReader(true)}
                data-testid="quota-claude-enable"
              >
                Bật đọc hạn mức Claude
              </Button>
            )}
            {!readOnly && quota.claudeReader === 'ours' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onSetClaudeReader(false)}
                data-testid="quota-claude-disable"
              >
                Tắt đọc hạn mức Claude
              </Button>
            )}
            <div className="text-text pt-2">Codex</div>
            {quota.codex ? (
              <ProviderBlock q={quota.codex} now={now} />
            ) : (
              <div className="text-xs text-text-muted">Chưa có số liệu Codex.</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
