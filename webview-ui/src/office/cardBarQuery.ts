/**
 * mptl fork (Đ2.1): search / filter / sort for the right-hand card bar (same
 * rules as the "Phiên" table, sessionTable.ts) and what the right-click menu
 * of a character offers. Pure; the bar keeps the query per browser.
 */
import type { SessionRow } from './sessionRows.js';
import {
  applyQuery,
  DEFAULT_QUERY,
  parseQuery,
  type SortDir,
  type SortKey,
  type TableQuery,
} from './sessionTable.js';
import type { StorageLike } from './sessionTableStore.js';

const QUERY_KEY = 'mptl.cardBar.query';

export const CARD_SORTS: { value: SortKey; dir: SortDir; label: string }[] = [
  { value: 'default', dir: 'asc', label: 'Mặc định' },
  { value: 'status', dir: 'asc', label: 'Trạng thái' },
  { value: 'idle', dir: 'desc', label: 'Rảnh lâu nhất' },
  { value: 'ram', dir: 'desc', label: 'Tốn RAM nhất' },
  { value: 'name', dir: 'asc', label: 'Tên A→Z' },
  { value: 'project', dir: 'asc', label: 'Project A→Z' },
];

function filtering(q: TableQuery): boolean {
  return (
    q.providers.length > 0 ||
    q.statuses.length > 0 ||
    q.idleAtLeastMs !== null ||
    q.projects.length > 0 ||
    q.names.length > 0 ||
    q.search.trim() !== ''
  );
}

export function cardQueryActive(q: TableQuery): boolean {
  return filtering(q) || q.sort !== 'default';
}

/**
 * Card ids to show, in order. `pinned` (the character anh right-clicked)
 * stays visible on top when the query would hide it.
 */
export function visibleCardIds(
  ids: number[],
  rowFor: (id: number) => SessionRow | undefined,
  q: TableQuery,
  pinned: number | null,
): number[] {
  if (!cardQueryActive(q)) return ids;
  const rows: SessionRow[] = [];
  const rowless: number[] = [];
  for (const id of ids) {
    const r = rowFor(id);
    if (r) rows.push(r);
    else rowless.push(id);
  }
  const out = applyQuery(rows, q).map((r) => r.id);
  if (!filtering(q)) out.push(...rowless);
  if (pinned !== null && ids.includes(pinned) && !out.includes(pinned)) out.unshift(pinned);
  return out;
}

export function loadCardQuery(s: StorageLike | undefined): TableQuery {
  try {
    const raw = s?.getItem(QUERY_KEY);
    return raw ? parseQuery(JSON.parse(raw)) : DEFAULT_QUERY;
  } catch {
    return DEFAULT_QUERY;
  }
}

export function saveCardQuery(s: StorageLike | undefined, q: TableQuery): void {
  try {
    s?.setItem(QUERY_KEY, JSON.stringify(q));
  } catch {
    // blocked storage: the bar still filters, it just forgets
  }
}

export interface MenuAction {
  enabled: boolean;
  /** Why it is off; null when enabled. */
  reason: string | null;
}

export function characterMenuActions(
  row: SessionRow,
  readOnly: boolean,
): { archive: MenuAction; trash: MenuAction } {
  let archive: MenuAction = { enabled: true, reason: null };
  if (readOnly) {
    archive = { enabled: false, reason: 'Trang chỉ xem — mở trang có mã để lưu trữ.' };
  } else if (row.archiveBlock) {
    archive = { enabled: false, reason: row.archiveBlock };
  } else if (!row.providerId) {
    archive = { enabled: false, reason: 'Chưa rõ phiên này chạy bằng gì — chưa lưu trữ được' };
  }
  return {
    archive,
    trash: {
      enabled: false,
      reason:
        'Chỉ phiên đã lưu trữ mới bỏ vào Thùng rác được: lưu trữ trước, rồi vào Phiên → Đã lưu trữ.',
    },
  };
}
