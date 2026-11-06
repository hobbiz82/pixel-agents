import { useState } from 'react';

import {
  archiveConfirmText,
  type ArchiveProvider,
  BULK_MAX,
  type BulkPlan,
} from '../office/sessionArchive.js';
import {
  defaultStops,
  gitLine,
  type Inspection,
  processLabel,
} from '../office/sessionInspection.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export interface ArchiveTarget {
  id: number;
  name: string;
  folder: string;
  provider: ArchiveProvider;
  /** Processes to stop with the session (pid + start time, re-checked by the server). */
  stop?: { pid: number; start: string }[];
}

interface ArchiveConfirmModalProps {
  /** One session (the row button) or several (the bulk bar). */
  plan: BulkPlan | null;
  /** What the server found for each target (arrives a moment after opening). */
  inspections: Record<number, Inspection>;
  onCancel: () => void;
  onConfirm: (targets: ArchiveTarget[]) => void;
}

const WARN = { color: 'var(--color-status-error)' };

/**
 * mptl fork: one confirm per Lưu trữ action. For each session: unsaved git
 * work (red), the last prompt and reply, and the processes it started with a
 * tick to stop them too (ticked by default unless someone is connected or it
 * may belong to another session). Lists the picked sessions it skips, and why.
 */
export function ArchiveConfirmModal({
  plan,
  inspections,
  onCancel,
  onConfirm,
}: ArchiveConfirmModalProps) {
  // Per session: the ticks anh changed; untouched sessions use the suggestion.
  const [ticks, setTicks] = useState<Record<number, number[]>>({});
  if (!plan) return null;
  const { targets, skipped, over } = plan;
  const tools = [...new Set(targets.map((t) => t.provider))];
  const single = targets.length === 1 && skipped.length === 0 && over === 0;
  const title = single ? 'Lưu trữ phiên?' : `Lưu trữ ${targets.length} phiên?`;
  const ticked = (id: number): number[] =>
    ticks[id] ?? defaultStops(inspections[id]?.processes ?? []);
  const toggle = (id: number, pid: number) =>
    setTicks((prev) => {
      const now = prev[id] ?? defaultStops(inspections[id]?.processes ?? []);
      return {
        ...prev,
        [id]: now.includes(pid) ? now.filter((p) => p !== pid) : [...now, pid],
      };
    });
  const unsaved = targets.filter((t) => {
    const i = inspections[t.id];
    return i ? (gitLine(i.git, i.gitError)?.warn ?? false) : false;
  }).length;
  const stopCount = targets.reduce((n, t) => n + ticked(t.id).length, 0);
  const close = () => {
    setTicks({});
    onCancel();
  };
  const confirm = () => {
    const out = targets.map((t) => {
      const procs = inspections[t.id]?.processes ?? [];
      const pick = ticked(t.id);
      const stop = procs
        .filter((p) => pick.includes(p.pid))
        .map((p) => ({
          pid: p.pid,
          start: p.start,
        }));
      return stop.length > 0 ? { ...t, stop } : t;
    });
    setTicks({});
    onConfirm(out);
  };

  return (
    <Modal isOpen onClose={close} title={title} zIndex={60}>
      <div className="px-10 pb-6 flex flex-col gap-8 max-w-[560px]" data-testid="archive-confirm">
        {unsaved > 0 && (
          <p className="text-sm m-0" style={WARN} data-testid="archive-confirm-unsaved">
            ⚠ {unsaved} phiên còn việc chưa lưu hoặc chưa đọc được git — xem kỹ bên dưới.
          </p>
        )}
        {targets.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col gap-6 max-h-[50vh] overflow-y-auto">
            {targets.map((t) => {
              const insp = inspections[t.id];
              const git = insp ? gitLine(insp.git, insp.gitError) : null;
              const pick = ticked(t.id);
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-2 border-b border-border pb-4"
                  data-testid="archive-confirm-item"
                >
                  <div className="text-base text-text truncate" data-testid="archive-confirm-name">
                    {t.name}
                  </div>
                  <div className="text-sm text-text-muted">
                    {t.provider === 'claude' ? 'Claude' : 'Codex'}
                    {t.folder && ` · ${t.folder}`}
                  </div>
                  {!insp && <div className="text-xs text-text-muted">Đang xem phiên…</div>}
                  {git && (
                    <div
                      className="text-sm"
                      style={git.warn ? WARN : undefined}
                      data-testid="archive-confirm-git"
                    >
                      {git.text}
                    </div>
                  )}
                  {insp?.lastPrompt && (
                    <div className="text-xs text-text-muted" data-testid="archive-confirm-prompt">
                      Anh hỏi cuối: {insp.lastPrompt}
                    </div>
                  )}
                  {insp?.lastReply && (
                    <div className="text-xs text-text-muted">Trả lời cuối: {insp.lastReply}</div>
                  )}
                  {insp && t.provider === 'claude' && (
                    <div className="flex flex-col gap-1" data-testid="archive-confirm-procs">
                      {insp.processes.length > 0 && (
                        <span className="text-xs text-text-muted">Tắt cùng phiên:</span>
                      )}
                      {insp.processes.map((p) => {
                        const on = pick.includes(p.pid);
                        return (
                          <button
                            key={p.pid}
                            role="checkbox"
                            aria-checked={on}
                            onClick={() => toggle(t.id, p.pid)}
                            className="flex items-center gap-6 bg-transparent border-none p-0 text-left text-sm text-text cursor-pointer"
                            data-testid="archive-confirm-proc"
                          >
                            <span
                              className={`w-12 h-12 border-2 border-white/50 shrink-0 ${on ? 'bg-accent' : ''}`}
                            />
                            {processLabel(p)}
                          </button>
                        );
                      })}
                      {insp.mcpCount > 0 && (
                        <span className="text-xs text-text-muted">
                          {insp.mcpCount} MCP server tự tắt theo phiên.
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
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
            style={WARN}
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
          <Button variant="default" size="md" onClick={close} data-testid="archive-cancel">
            Hủy
          </Button>
          <Button
            variant={targets.length > 0 ? 'accent' : 'disabled'}
            size="md"
            disabled={targets.length === 0}
            onClick={confirm}
            data-testid="archive-confirm-button"
          >
            {single ? 'Lưu trữ' : `Lưu trữ ${targets.length} phiên`}
            {stopCount > 0 ? ` + tắt ${stopCount} tiến trình` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
