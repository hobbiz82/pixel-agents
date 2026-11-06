import { useEffect, useRef, useState } from 'react';

import { foldText } from '../office/sessionTable.js';
import { Button } from './ui/Button.js';

interface Option {
  value: string;
  label: string;
}

interface MultiPickProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Show a search box above the list (long lists: names, projects). */
  searchable?: boolean;
  testId?: string;
}

/**
 * mptl fork: a small multi-select dropdown for the "Phiên" filters. Nothing
 * picked = no filter. The search box ignores case and Vietnamese marks.
 */
export function MultiPick({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  testId,
}: MultiPickProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const needle = foldText(text.trim());
  const shown = needle ? options.filter((o) => foldText(o.label).includes(needle)) : options;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div className="relative" ref={box}>
      <Button
        variant={selected.length > 0 ? 'active' : 'default'}
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ''} ▾
      </Button>
      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-20 bg-bg border-2 border-border shadow-pixel w-[min(280px,80vw)] flex flex-col"
          role="listbox"
          aria-multiselectable
        >
          {searchable && (
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Gõ để tìm…"
              className="m-4 px-6 py-2 bg-btn-bg border-2 border-border text-text text-sm outline-none"
              data-testid={testId ? `${testId}-search` : undefined}
            />
          )}
          <div className="max-h-[260px] overflow-y-auto">
            {shown.length === 0 && (
              <div className="px-8 py-4 text-sm text-text-muted">Không có kết quả</div>
            )}
            {shown.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(o.value)}
                  className="w-full flex items-center gap-6 px-8 py-3 bg-transparent border-none text-left text-sm text-text cursor-pointer hover:bg-btn-hover"
                >
                  <span
                    className={`w-12 h-12 border-2 border-white/50 shrink-0 ${on ? 'bg-accent' : ''}`}
                  />
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <Button variant="ghost" size="sm" className="self-end m-2" onClick={() => onChange([])}>
              Bỏ chọn
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
