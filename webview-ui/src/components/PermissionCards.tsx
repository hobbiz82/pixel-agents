import { useEffect, useState } from 'react';

import { type HeldPrompt, secondsLeft } from '../office/assistView.js';
import { Button } from './ui/Button.js';

interface PermissionCardsProps {
  prompts: HeldPrompt[];
  /** Session name for a prompt (from the agent's meta), when known. */
  nameFor: (prompt: HeldPrompt) => string | undefined;
  onDecide: (requestId: string, decision: 'allow' | 'deny' | 'ask') => void;
}

/**
 * mptl fork (Đ3): Claude permission prompts held for the page. Cho phép /
 * Từ chối answer for anh; "Để app hỏi" (or the countdown running out) lets
 * the Claude app show its own prompt as usual.
 */
export function PermissionCards({ prompts, nameFor, onDecide }: PermissionCardsProps) {
  const [now, setNow] = useState(() => Date.now());
  const active = prompts.length > 0;
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const [sent, setSent] = useState<Record<string, true>>({});

  if (!active) return null;
  const decide = (requestId: string, d: 'allow' | 'deny' | 'ask') => {
    setSent((s) => ({ ...s, [requestId]: true }));
    onDecide(requestId, d);
  };

  return (
    <div
      className="fixed top-10 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-4 w-[420px] max-w-[calc(100vw-32px)]"
      data-testid="permission-cards"
    >
      {prompts.map((p) => {
        const name = nameFor(p);
        const busy = sent[p.requestId] === true;
        return (
          <div
            key={p.requestId}
            role="alertdialog"
            aria-label={`${name ?? 'Phiên'} cần anh duyệt`}
            className="flex flex-col gap-3 p-6 bg-bg border-2 border-status-permission shadow-pixel text-sm"
            data-testid="permission-card"
          >
            <div className="flex justify-between gap-4">
              <span className="text-text break-words">{name ?? 'Một phiên'} cần anh duyệt</span>
              <span className="text-text-muted shrink-0" data-testid="permission-countdown">
                còn {secondsLeft(p.expiresAt, now)} giây
              </span>
            </div>
            <div className="text-xs">
              <span className="text-status-permission">{p.toolName}</span>
              {p.cwd && <span className="text-text-muted"> · {p.cwd}</span>}
            </div>
            {p.summary && (
              <div
                className="p-3 bg-bg-dark border border-border text-xs whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto"
                data-testid="permission-summary"
              >
                {p.summary}
              </div>
            )}
            <div className="flex gap-4 flex-wrap">
              <Button
                size="sm"
                variant="accent"
                disabled={busy}
                onClick={() => decide(p.requestId, 'allow')}
                data-testid="permission-allow"
              >
                Cho phép
              </Button>
              <Button
                size="sm"
                disabled={busy}
                className="text-danger"
                onClick={() => decide(p.requestId, 'deny')}
                data-testid="permission-deny"
              >
                Từ chối
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => decide(p.requestId, 'ask')}
                data-testid="permission-ask"
              >
                Để app hỏi
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
