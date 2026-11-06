/**
 * mptl fork: per-browser memory for the "Phiên" table — the last query and
 * anh's named views. Storage can be missing or throw (private window, blocked
 * site data): every access is guarded and falls back to the default.
 */
import { DEFAULT_QUERY, parseQuery, type TableQuery } from './sessionTable.js';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedView {
  name: string;
  query: TableQuery;
}

export const MAX_VIEWS = 10;
const QUERY_KEY = 'mptl.sessions.query';
const VIEWS_KEY = 'mptl.sessions.views';

function read(s: StorageLike | undefined, key: string): unknown {
  try {
    const raw = s?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(s: StorageLike | undefined, key: string, value: unknown): void {
  try {
    s?.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the table still works, it just forgets
  }
}

export function loadLastQuery(s: StorageLike | undefined): TableQuery {
  const raw = read(s, QUERY_KEY);
  return raw ? parseQuery(raw) : DEFAULT_QUERY;
}

export function saveLastQuery(s: StorageLike | undefined, q: TableQuery): void {
  write(s, QUERY_KEY, q);
}

export function loadViews(s: StorageLike | undefined): SavedView[] {
  const raw = read(s, VIEWS_KEY);
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim()) continue;
    out.push({ name: r.name, query: parseQuery(r.query) });
  }
  return out.slice(-MAX_VIEWS);
}

export function saveView(s: StorageLike | undefined, name: string, q: TableQuery): void {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  const views = loadViews(s).filter((v) => v.name !== clean);
  views.push({ name: clean, query: q });
  write(s, VIEWS_KEY, views.slice(-MAX_VIEWS));
}

export function deleteView(s: StorageLike | undefined, name: string): void {
  write(
    s,
    VIEWS_KEY,
    loadViews(s).filter((v) => v.name !== name),
  );
}
