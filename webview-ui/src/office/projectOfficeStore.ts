/**
 * mptl fork (Đ2): per-browser memory for the one-room-per-project office —
 * whether it is on, the room order and anh's renamed titles. Storage can be
 * missing or throw (private window, blocked site data): every access is
 * guarded and falls back to the default (on, no order, no titles).
 */
import type { StorageLike } from './sessionTableStore.js';

const AUTO_KEY = 'mptl.office.autoRooms';
const ORDER_KEY = 'mptl.office.roomOrder';
const TITLES_KEY = 'mptl.office.roomTitles';
export const MAX_TITLE_LENGTH = 40;
const MAX_ORDER = 200;

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
    // storage full or blocked: the office still works, it just forgets
  }
}

export function loadAutoRooms(s: StorageLike | undefined): boolean {
  return read(s, AUTO_KEY) !== false;
}

export function saveAutoRooms(s: StorageLike | undefined, on: boolean): void {
  write(s, AUTO_KEY, on);
}

export function loadRoomOrder(s: StorageLike | undefined): string[] {
  const raw = read(s, ORDER_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v !== '').slice(0, MAX_ORDER);
}

export function saveRoomOrder(s: StorageLike | undefined, order: string[]): void {
  write(s, ORDER_KEY, order.slice(0, MAX_ORDER));
}

export function loadRoomTitles(s: StorageLike | undefined): Record<string, string> {
  const raw = read(s, TITLES_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, MAX_TITLE_LENGTH);
  }
  return out;
}

/** Set (or, with an empty title, clear) one room's title; returns the new map. */
export function renameRoom(
  s: StorageLike | undefined,
  titles: Record<string, string>,
  key: string,
  title: string,
): Record<string, string> {
  const next = { ...titles };
  const t = title.trim().slice(0, MAX_TITLE_LENGTH);
  if (t) next[key] = t;
  else delete next[key];
  write(s, TITLES_KEY, next);
  return next;
}

/** Projects of the live sessions (characters with session facts; sub-agents have none). */
export function liveProjects(
  chars: Iterable<{ directoryName?: string; sessionMeta?: { project?: string } }>,
): string[] {
  const out: string[] = [];
  for (const ch of chars) {
    if (!ch.sessionMeta) continue;
    const key = ch.sessionMeta.project || ch.directoryName || '';
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}
