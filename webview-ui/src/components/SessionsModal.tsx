import { Fragment, useEffect, useState } from 'react';

import { LONG_IDLE_COLOR } from '../constants.js';
import { useNow } from '../hooks/useNow.js';
import { type ArchivedSession, restoreHint } from '../office/sessionArchive.js';
import { providerTag } from '../office/sessionMetaLabels.js';
import type { SessionRow } from '../office/sessionRows.js';
import {
  applyQuery,
  DEFAULT_QUERY,
  distinct,
  groupByProject,
  IDLE_STEPS,
  PRESETS,
  type SortKey,
  type TableQuery,
} from '../office/sessionTable.js';
import {
  deleteView,
  loadLastQuery,
  loadViews,
  type SavedView,
  saveLastQuery,
  saveView,
  type StorageLike,
} from '../office/sessionTableStore.js';
import { MultiPick } from './MultiPick.js';
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
   *  office, which then shows no action column, no picking and no archive tab. */
  onArchive?: (row: SessionRow) => void;
  /** Lưu trữ for every picked row (opens one confirm for all of them). */
  onBulkArchive?: (rows: SessionRow[]) => void;
  archived?: ArchivedSession[];
  onRestore?: (session: ArchivedSession) => void;
  /** Bỏ vào Thùng rác for the picked archived sessions (opens the confirm). */
  onDeleteArchived?: (sessions: ArchivedSession[]) => void;
  /** mptl fork (Đ2): room names of the one-room-per-project office; with
   *  `onRenameRoom`, each project group gets a ✎ to rename its room. */
  roomTitles?: Record<string, string>;
  onRenameRoom?: (project: string, title: string) => void;
}

const ARCHIVED_AT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** window.localStorage, or undefined when even reading the property throws. */
function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function copy(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // clipboard blocked (http, old browser): the command stays visible to copy by hand
  }
}

const TOOL_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
];
const STATUS_OPTIONS = [
  { value: 'waiting', label: 'Chờ anh' },
  { value: 'busy', label: 'Đang chạy' },
  { value: 'idle', label: 'Rảnh' },
];
/** First click on these columns sorts the biggest first. */
const DESC_FIRST: SortKey[] = ['idle', 'ram'];

function sameQuery(a: TableQuery, b: TableQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when the query narrows the rows (sort and grouping do not count). */
function narrows(q: TableQuery): boolean {
  return !sameQuery({ ...q, sort: 'default', dir: 'asc', group: false }, DEFAULT_QUERY);
}

/**
 * mptl fork: every session in the office as one table — name, tool, project,
 * folder, status/idle and RAM — with filters, sorting, grouping by project and
 * picking several rows for one Lưu trữ, so stale sessions are easy to clean up.
 */
export function SessionsModal({
  isOpen,
  onClose,
  rowsAt,
  onPick,
  onArchive,
  onBulkArchive,
  archived = [],
  onRestore,
  onDeleteArchived,
  roomTitles = {},
  onRenameRoom,
}: SessionsModalProps) {
  const now = useNow(isOpen);
  const [tab, setTab] = useState<'live' | 'archived'>('live');
  const [query, setQuery] = useState<TableQuery>(() => loadLastQuery(browserStorage()));
  const [views, setViews] = useState<SavedView[]>(() => loadViews(browserStorage()));
  const [naming, setNaming] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    saveLastQuery(browserStorage(), query);
  }, [query]);

  if (!isOpen) return null;
  const all = rowsAt(now);
  const rows = applyQuery(all, query);
  const canArchive = onArchive !== undefined;
  const showArchived = canArchive && tab === 'archived';
  const set = (over: Partial<TableQuery>) => setQuery((q) => ({ ...q, ...over }));
  const visibleIds = new Set(rows.map((r) => r.id));
  const pickedRows = rows.filter((r) => picked.has(r.id));
  // Picking only ever applies to rows on screen: hidden rows drop out.
  const togglePick = (ids: number[]) =>
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const sortBy = (key: SortKey) =>
    setQuery((q) =>
      q.sort === key
        ? { ...q, dir: q.dir === 'asc' ? 'desc' : 'asc' }
        : { ...q, sort: key, dir: DESC_FIRST.includes(key) ? 'desc' : 'asc' },
    );
  const arrow = (key: SortKey) => (query.sort === key ? (query.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const groups = query.group ? groupByProject(rows) : [{ project: '', label: '', rows }];
  const cols = canArchive ? 8 : 6;
  const title =
    rows.length === all.length ? `Phiên (${all.length})` : `Phiên (${rows.length}/${all.length})`;

  const head = (key: SortKey, label: string, right = false) => (
    <th
      className={`py-2 px-6 font-normal ${right ? 'text-right' : ''}`}
      aria-sort={query.sort === key ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        className="bg-transparent border-none p-0 cursor-pointer text-text-muted hover:text-text"
        onClick={() => sortBy(key)}
        data-testid={`sessions-sort-${key}`}
      >
        {label}
        {arrow(key)}
      </button>
    </th>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
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
            Đang mở ({all.length})
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
      {!showArchived && (
        <div className="flex flex-col gap-4 px-6 pb-6" data-testid="sessions-filters">
          <div className="flex flex-wrap gap-4 items-center">
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                variant={sameQuery(query, p.query) ? 'active' : 'default'}
                size="sm"
                onClick={() => setQuery(p.query)}
                data-testid={`sessions-preset-${p.id}`}
              >
                {p.label}
              </Button>
            ))}
            {views.map((v) => (
              <span key={v.name} className="flex items-center">
                <Button
                  variant={sameQuery(query, v.query) ? 'active' : 'default'}
                  size="sm"
                  onClick={() => setQuery(v.query)}
                  data-testid="sessions-view"
                >
                  {v.name}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title={`Bỏ bộ lọc "${v.name}"`}
                  onClick={() => {
                    deleteView(browserStorage(), v.name);
                    setViews(loadViews(browserStorage()));
                  }}
                >
                  ×
                </Button>
              </span>
            ))}
            {naming === null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNaming('')}
                data-testid="sessions-save-view"
              >
                + Lưu bộ lọc này
              </Button>
            ) : (
              <form
                className="flex gap-2 items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveView(browserStorage(), naming, query);
                  setViews(loadViews(browserStorage()));
                  setNaming(null);
                }}
              >
                <input
                  autoFocus
                  value={naming}
                  maxLength={40}
                  onChange={(e) => setNaming(e.target.value)}
                  placeholder="Tên bộ lọc"
                  aria-label="Tên bộ lọc"
                  className="px-6 py-1 bg-btn-bg border-2 border-border text-text text-sm outline-none w-[140px]"
                />
                <Button
                  variant={naming.trim() ? 'default' : 'disabled'}
                  size="sm"
                  type="submit"
                  disabled={!naming.trim()}
                >
                  Lưu
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => setNaming(null)}>
                  Hủy
                </Button>
              </form>
            )}
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            <input
              value={query.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Tìm tên, thư mục, project…"
              aria-label="Tìm phiên"
              className="px-6 py-1 bg-btn-bg border-2 border-border text-text text-sm outline-none w-[min(220px,100%)]"
              data-testid="sessions-search"
            />
            <MultiPick
              label="Công cụ"
              options={TOOL_OPTIONS}
              selected={query.providers}
              onChange={(v) => set({ providers: v as TableQuery['providers'] })}
              testId="sessions-filter-tool"
            />
            <MultiPick
              label="Trạng thái"
              options={STATUS_OPTIONS}
              selected={query.statuses}
              onChange={(v) => set({ statuses: v as TableQuery['statuses'] })}
              testId="sessions-filter-status"
            />
            <select
              value={query.idleAtLeastMs ?? ''}
              onChange={(e) =>
                set({ idleAtLeastMs: e.target.value ? Number(e.target.value) : null })
              }
              className="px-4 py-1 bg-btn-bg border-2 border-border text-text text-sm"
              aria-label="Rảnh bao lâu"
              data-testid="sessions-filter-idle"
            >
              {IDLE_STEPS.map((s) => (
                <option key={s.label} value={s.ms ?? ''}>
                  {s.label}
                </option>
              ))}
            </select>
            <MultiPick
              label="Project"
              options={distinct(all, (r) => r.project).map((p) => ({ value: p, label: p }))}
              selected={query.projects}
              onChange={(v) => set({ projects: v })}
              searchable
              testId="sessions-filter-project"
            />
            <MultiPick
              label="Tên phiên"
              options={distinct(all, (r) => r.name).map((n) => ({ value: n, label: n }))}
              selected={query.names}
              onChange={(v) => set({ names: v })}
              searchable
              testId="sessions-filter-name"
            />
            <Button
              variant={query.group ? 'active' : 'default'}
              size="sm"
              aria-pressed={query.group}
              onClick={() => set({ group: !query.group })}
              data-testid="sessions-group"
            >
              Gom theo project
            </Button>
            {narrows(query) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setQuery((q) => ({ ...DEFAULT_QUERY, sort: q.sort, dir: q.dir, group: q.group }))
                }
                data-testid="sessions-clear"
              >
                Bỏ lọc
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="overflow-x-auto max-w-full">
        {showArchived ? (
          <ArchivedTable archived={archived} onRestore={onRestore} onDelete={onDeleteArchived} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted px-6 py-8 m-0" data-testid="sessions-empty">
            Không có phiên nào khớp bộ lọc.
          </p>
        ) : (
          <table className="text-sm border-collapse" data-testid="sessions-table">
            <thead>
              <tr className="text-text-muted text-left">
                {canArchive && (
                  <th className="py-2 pl-6 font-normal">
                    <PickBox
                      on={rows.every((r) => picked.has(r.id))}
                      some={pickedRows.length > 0}
                      label="Chọn mọi phiên đang hiện"
                      onToggle={() => togglePick(rows.map((r) => r.id))}
                      testId="sessions-pick-all"
                    />
                  </th>
                )}
                {head('name', 'Phiên')}
                {head('tool', 'Công cụ')}
                {head('project', 'Project')}
                <th className="py-2 px-6 font-normal">Thư mục</th>
                {head('idle', 'Trạng thái')}
                {head('ram', 'RAM', true)}
                {canArchive && <th className="py-2 px-6 font-normal" />}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.project || '__none'}>
                  {query.group && (
                    <tr className="border-t-2 border-border" data-testid="sessions-group-row">
                      <td colSpan={cols} className="pt-6 pb-2 px-6 text-accent-bright">
                        <span className="flex items-center gap-6">
                          {canArchive && (
                            <PickBox
                              on={g.rows.every((r) => picked.has(r.id))}
                              some={g.rows.some((r) => picked.has(r.id))}
                              label={`Chọn mọi phiên của ${g.label}`}
                              onToggle={() => togglePick(g.rows.map((r) => r.id))}
                            />
                          )}
                          {g.label} ({g.rows.length})
                          {onRenameRoom && g.project && (
                            <RoomTitle
                              project={g.project}
                              title={roomTitles[g.project] ?? ''}
                              onSave={(t) => onRenameRoom(g.project, t)}
                            />
                          )}
                        </span>
                      </td>
                    </tr>
                  )}
                  {g.rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border hover:bg-btn-hover"
                      onClick={() => onPick(row.id)}
                      title="Bấm để tới nhân vật này"
                      data-testid="sessions-row"
                    >
                      {canArchive && (
                        <td className="py-3 pl-6" onClick={(e) => e.stopPropagation()}>
                          <PickBox
                            on={picked.has(row.id)}
                            label={`Chọn ${row.name}`}
                            onToggle={() => togglePick([row.id])}
                            testId="sessions-pick"
                          />
                        </td>
                      )}
                      <td className="py-3 px-6 text-text max-w-[320px] truncate">{row.name}</td>
                      <td className="py-3 px-6 whitespace-nowrap">
                        {row.provider ? (
                          <span style={{ color: row.provider.color }}>{row.provider.label}</span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-3 px-6 text-text-muted whitespace-nowrap">
                        {row.project || '—'}
                      </td>
                      <td className="py-3 px-6 text-text-muted whitespace-nowrap">
                        {row.folder || '—'}
                        {row.whereText && (
                          <div className="text-xs" data-testid="session-where">
                            {row.whereText}
                          </div>
                        )}
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
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canArchive && !showArchived && pickedRows.length > 0 && (
        <div
          className="sticky bottom-0 bg-bg border-t-2 border-border flex flex-wrap items-center gap-6 px-6 py-4 mt-4"
          data-testid="sessions-bulk-bar"
        >
          <span className="text-sm text-text">Đã chọn {pickedRows.length} phiên</span>
          {onBulkArchive && (
            <Button
              variant="accent"
              size="sm"
              onClick={() => onBulkArchive(pickedRows)}
              data-testid="sessions-bulk-archive"
            >
              Lưu trữ đã chọn…
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** "Phòng: <name> ✎" on a project group; ✎ turns it into a field (Enter saves,
 *  Esc cancels, empty = back to the project name). */
function RoomTitle({
  project,
  title,
  onSave,
}: {
  project: string;
  title: string;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <span className="text-sm text-text-muted flex items-center gap-4">
        · Phòng: {title || project}
        <button
          onClick={() => setDraft(title || project)}
          className="bg-transparent border-none p-0 text-text-muted hover:text-text cursor-pointer"
          aria-label={`Đổi tên phòng của ${project}`}
          title="Đổi tên phòng"
          data-testid="room-rename"
        >
          ✎
        </button>
      </span>
    );
  }
  const save = () => {
    onSave(draft === project ? '' : draft);
    setDraft(null);
  };
  return (
    <input
      autoFocus
      value={draft}
      maxLength={40}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') setDraft(null);
      }}
      onBlur={save}
      aria-label={`Tên phòng của ${project}`}
      className="px-4 py-1 bg-btn-bg border-2 border-border text-text text-sm outline-none w-[200px]"
      data-testid="room-rename-input"
    />
  );
}

function PickBox({
  on,
  some = false,
  label,
  onToggle,
  testId,
}: {
  on: boolean;
  some?: boolean;
  label: string;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={on ? true : some ? 'mixed' : false}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`w-14 h-14 border-2 border-white/50 p-0 cursor-pointer flex items-center justify-center text-2xs leading-none text-white ${on ? 'bg-accent' : 'bg-transparent'}`}
      data-testid={testId}
    >
      {on ? 'x' : some ? '–' : ''}
    </button>
  );
}

function ArchivedTable({
  archived,
  onRestore,
  onDelete,
}: {
  archived: ArchivedSession[];
  onRestore?: (session: ArchivedSession) => void;
  onDelete?: (sessions: ArchivedSession[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const present = archived.filter((s) => picked.has(s.sessionId));
  const toggle = (ids: string[]) =>
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => archived.some((s) => s.sessionId === id)));
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  if (archived.length === 0) {
    return (
      <p className="text-sm text-text-muted px-6 py-8 m-0" data-testid="archived-empty">
        Chưa lưu trữ phiên nào.
      </p>
    );
  }
  return (
    <>
      <table className="text-sm border-collapse" data-testid="archived-table">
        <thead>
          <tr className="text-text-muted text-left">
            {onDelete && (
              <th className="py-2 pl-6 font-normal">
                <PickBox
                  on={archived.every((s) => picked.has(s.sessionId))}
                  some={present.length > 0}
                  label="Chọn mọi phiên đã lưu trữ"
                  onToggle={() => toggle(archived.map((s) => s.sessionId))}
                  testId="archived-pick-all"
                />
              </th>
            )}
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
                {onDelete && (
                  <td className="py-3 pl-6">
                    <PickBox
                      on={picked.has(s.sessionId)}
                      label={`Chọn ${s.name || s.sessionId}`}
                      onToggle={() => toggle([s.sessionId])}
                      testId="archived-pick"
                    />
                  </td>
                )}
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
                        <code
                          className="text-xs text-text select-all"
                          data-testid="archived-command"
                        >
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
      {onDelete && present.length > 0 && (
        <div
          className="sticky bottom-0 bg-bg border-t-2 border-border flex flex-wrap items-center gap-6 px-6 py-4 mt-4"
          data-testid="archived-bulk-bar"
        >
          <span className="text-sm text-text">Đã chọn {present.length} phiên</span>
          <Button
            variant="accent"
            size="sm"
            onClick={() => onDelete(present)}
            data-testid="archived-bulk-delete"
          >
            Bỏ vào Thùng rác…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}
    </>
  );
}
