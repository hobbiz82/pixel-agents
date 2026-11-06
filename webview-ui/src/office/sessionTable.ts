/**
 * mptl fork: filter, sort, group and saved views for the "Phiên" table.
 * Pure: rows come from buildSessionRows; the component keeps the query in
 * state and remembers it per browser (sessionTableStore.ts).
 */
import type { RowStatus, SessionRow } from './sessionRows.js';

export type SortKey = 'default' | 'name' | 'tool' | 'project' | 'idle' | 'ram' | 'status';
export type SortDir = 'asc' | 'desc';
type Provider = 'claude' | 'codex';
type FilterStatus = Exclude<RowStatus, 'unknown'>;

export interface TableQuery {
  /** Empty = every tool. */
  providers: Provider[];
  /** Empty = every status. */
  statuses: FilterStatus[];
  /** Keep only idle rows idle at least this long; null = no limit. */
  idleAtLeastMs: number | null;
  /** Empty = every project. */
  projects: string[];
  /** Sessions picked by name in the dropdown; empty = every name. */
  names: string[];
  /** Free text over name, folder and project; case and marks ignored. */
  search: string;
  sort: SortKey;
  dir: SortDir;
  /** Show rows under one heading per project. */
  group: boolean;
}

export const DEFAULT_QUERY: TableQuery = {
  providers: [],
  statuses: [],
  idleAtLeastMs: null,
  projects: [],
  names: [],
  search: '',
  sort: 'default',
  dir: 'asc',
  group: false,
};

const DAY = 24 * 3_600_000;

export const IDLE_STEPS: { label: string; ms: number | null }[] = [
  { label: 'Mọi thời gian', ms: null },
  { label: 'Rảnh ≥ 1 giờ', ms: 3_600_000 },
  { label: 'Rảnh ≥ 1 ngày', ms: DAY },
  { label: 'Rảnh ≥ 3 ngày', ms: 3 * DAY },
  { label: 'Rảnh ≥ 7 ngày', ms: 7 * DAY },
];

export interface Preset {
  id: string;
  label: string;
  query: TableQuery;
}

export const PRESETS: Preset[] = [
  { id: 'all', label: 'Tất cả', query: DEFAULT_QUERY },
  { id: 'waiting', label: 'Chờ anh', query: { ...DEFAULT_QUERY, statuses: ['waiting'] } },
  {
    id: 'idle3d',
    label: 'Rảnh ≥ 3 ngày',
    query: { ...DEFAULT_QUERY, idleAtLeastMs: 3 * DAY, sort: 'idle', dir: 'desc' },
  },
  {
    id: 'ram',
    label: 'Tốn RAM nhất',
    query: { ...DEFAULT_QUERY, providers: ['claude'], sort: 'ram', dir: 'desc' },
  },
];

/** Lower case, Vietnamese marks dropped (đ → d), for search and matching. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

function keep(row: SessionRow, q: TableQuery): boolean {
  if (q.providers.length > 0 && (!row.providerId || !q.providers.includes(row.providerId))) {
    return false;
  }
  if (q.statuses.length > 0 && (row.status === 'unknown' || !q.statuses.includes(row.status))) {
    return false;
  }
  if (q.idleAtLeastMs !== null && (row.idleMs === null || row.idleMs < q.idleAtLeastMs)) {
    return false;
  }
  if (q.projects.length > 0 && !q.projects.includes(row.project)) return false;
  if (q.names.length > 0 && !q.names.includes(row.name)) return false;
  const needle = foldText(q.search.trim());
  if (needle && !foldText(`${row.name} ${row.folder} ${row.project}`).includes(needle)) {
    return false;
  }
  return true;
}

const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
const TOOL_ORDER: Record<string, number> = { claude: 0, codex: 1 };
const STATUS_ORDER: Record<RowStatus, number> = { waiting: 0, busy: 1, idle: 2, unknown: 3 };

/** Compare two values where null always sorts last, whatever the direction. */
function nullsLast(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function compare(a: SessionRow, b: SessionRow, sort: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (sort) {
    case 'name':
      return sign * collator.compare(a.name, b.name);
    case 'project':
      return sign * collator.compare(a.project, b.project);
    case 'tool':
      return nullsLast(
        a.providerId ? TOOL_ORDER[a.providerId] : null,
        b.providerId ? TOOL_ORDER[b.providerId] : null,
        dir,
      );
    case 'status':
      return sign * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    case 'idle':
      return nullsLast(a.idleMs, b.idleMs, dir);
    case 'ram':
      return nullsLast(a.rssBytes, b.rssBytes, dir);
    default:
      return 0;
  }
}

/** Filtered rows; a stable sort keeps the given order for ties. */
export function applyQuery(rows: SessionRow[], q: TableQuery): SessionRow[] {
  const kept = rows.filter((r) => keep(r, q));
  if (q.sort === 'default') return kept;
  return kept
    .map((row, i) => ({ row, i }))
    .sort((a, b) => compare(a.row, b.row, q.sort, q.dir) || a.i - b.i)
    .map(({ row }) => row);
}

export interface ProjectGroup {
  project: string;
  label: string;
  rows: SessionRow[];
}

/** One group per project, by project name; sessions without a project last. */
export function groupByProject(rows: SessionRow[]): ProjectGroup[] {
  const map = new Map<string, SessionRow[]>();
  for (const r of rows) {
    const list = map.get(r.project);
    if (list) list.push(r);
    else map.set(r.project, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : collator.compare(a, b)))
    .map(([project, list]) => ({
      project,
      label: project || 'Không rõ project',
      rows: list,
    }));
}

/** Distinct values for the dropdowns, in Vietnamese order. */
export function distinct(rows: SessionRow[], pick: (r: SessionRow) => string): string[] {
  return [...new Set(rows.map(pick).filter(Boolean))].sort(collator.compare);
}

const SORTS: SortKey[] = ['default', 'name', 'tool', 'project', 'idle', 'ram', 'status'];

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** A stored query back from localStorage: anything invalid falls back to the default. */
export function parseQuery(raw: unknown): TableQuery {
  if (!raw || typeof raw !== 'object') return DEFAULT_QUERY;
  const r = raw as Record<string, unknown>;
  const ms = r.idleAtLeastMs;
  return {
    providers: strings(r.providers).filter((p): p is Provider => p === 'claude' || p === 'codex'),
    statuses: strings(r.statuses).filter(
      (s): s is FilterStatus => s === 'waiting' || s === 'busy' || s === 'idle',
    ),
    idleAtLeastMs: typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : null,
    projects: strings(r.projects),
    names: strings(r.names),
    search: typeof r.search === 'string' ? r.search : '',
    sort: SORTS.includes(r.sort as SortKey) ? (r.sort as SortKey) : 'default',
    dir: r.dir === 'desc' ? 'desc' : 'asc',
    group: r.group === true,
  };
}
