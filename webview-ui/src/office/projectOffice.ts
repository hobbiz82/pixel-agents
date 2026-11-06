/**
 * mptl fork (Đ2): build the office from the live sessions — one copy of the
 * upstream room per project (worktrees are folded into their repo by the
 * server) plus a shared room for sessions without a project room.
 *
 * Rooms sit in a grid of up to 3 columns. Seat and furniture uids get the
 * room's key as a suffix (`<uid>@<project>`), so a session keeps its seat when
 * other rooms come and go. The result is marked `generated` and is never
 * saved: the server refuses it and the layout editor stays off while it is up.
 */
import type { ColorValue } from '../components/ui/types.js';
import { AREA_DEFAULT_COLORS } from '../constants.js';
import type { OfficeLayout, PlacedFurniture } from './types.js';
import { TileType } from './types.js';

/** Area label of the shared room. A colon never appears in a repo folder name we show. */
export const SHARED_ROOM = ':shared';
export const SHARED_ROOM_TITLE = 'Phòng chung';
/** 14 project rooms + the shared room = 15 rooms of 21×12 in 3×5 = 63×60 (editor max 64×64). */
export const MAX_PROJECT_ROOMS = 14;
const GRID_COLS = 3;

/** Saved order first, then projects not seen before, by name. */
export function mergeRoomOrder(saved: string[], projects: string[]): string[] {
  const out: string[] = [];
  for (const p of saved) if (p && !out.includes(p)) out.push(p);
  const fresh = [...new Set(projects.filter((p) => p && !out.includes(p)))].sort((a, b) =>
    a.localeCompare(b),
  );
  return [...out, ...fresh];
}

/** Live projects in room order, at most MAX_PROJECT_ROOMS. */
export function pickRooms(projects: string[], order: string[]): string[] {
  const live = new Set(projects);
  return mergeRoomOrder(order, projects)
    .filter((p) => live.has(p))
    .slice(0, MAX_PROJECT_ROOMS);
}

export function roomTitle(key: string, titles: Record<string, string>): string {
  if (key === SHARED_ROOM) return titles[SHARED_ROOM] || SHARED_ROOM_TITLE;
  return titles[key]?.trim() || key;
}

/** Small stable hash, so a project keeps its floor colour wherever its room lands. */
function hashOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

interface RoomCrop {
  top: number;
  roomW: number;
  roomH: number;
}

/**
 * The upstream room uses only part of its grid: from one row above the top
 * wall (where wall decor hangs) down to the last floor row. Columns stay whole —
 * the trailing void column separates neighbouring rooms.
 */
function cropOf(base: OfficeLayout): RoomCrop {
  let firstRow = base.rows;
  let lastRow = -1;
  for (let r = 0; r < base.rows; r++) {
    for (let c = 0; c < base.cols; c++) {
      if (base.tiles[r * base.cols + c] !== TileType.VOID) {
        firstRow = Math.min(firstRow, r);
        lastRow = Math.max(lastRow, r);
      }
    }
  }
  const top = Math.max(0, Math.min(firstRow - 1, ...base.furniture.map((f) => f.row)));
  return { top, roomW: base.cols, roomH: lastRow - top + 1 };
}

/** `rooms` are project keys in order; the shared room is always added last. */
export function buildProjectOffice(
  base: OfficeLayout,
  rooms: string[],
  titles: Record<string, string>,
): OfficeLayout {
  const keys = [
    ...rooms.filter((k) => k && k !== SHARED_ROOM).slice(0, MAX_PROJECT_ROOMS),
    SHARED_ROOM,
  ];
  const { top, roomW, roomH } = cropOf(base);
  const gridCols = Math.min(GRID_COLS, keys.length);
  const cols = roomW * gridCols;
  const rows = roomH * Math.ceil(keys.length / gridCols);

  const tiles = new Array<TileType>(cols * rows).fill(TileType.VOID);
  const tileColors = new Array<ColorValue | null>(cols * rows).fill(null);
  const areaTiles = new Array<string | null>(cols * rows).fill(null);
  const furniture: PlacedFurniture[] = [];

  keys.forEach((key, k) => {
    const dc = (k % gridCols) * roomW;
    const dr = Math.floor(k / gridCols) * roomH;
    const hue = key === SHARED_ROOM ? 0 : (hashOf(key) % 8) * 45;
    for (let r = 0; r < roomH; r++) {
      for (let c = 0; c < roomW; c++) {
        const from = (r + top) * base.cols + c;
        const to = (r + dr) * cols + (c + dc);
        const t = base.tiles[from] ?? TileType.VOID;
        tiles[to] = t;
        const color = base.tileColors?.[from] ?? null;
        tileColors[to] =
          color && t !== TileType.WALL ? { ...color, h: (color.h + hue) % 360 } : color;
        if (t !== TileType.WALL && t !== TileType.VOID) areaTiles[to] = key;
      }
    }
    for (const f of base.furniture) {
      furniture.push({ ...f, uid: `${f.uid}@${key}`, col: f.col + dc, row: f.row - top + dr });
    }
  });

  return {
    version: 1,
    cols,
    rows,
    tiles,
    tileColors,
    furniture,
    ...(base.layoutRevision !== undefined ? { layoutRevision: base.layoutRevision } : {}),
    areas: keys.map((key) => ({
      label: key,
      title: roomTitle(key, titles),
      color:
        AREA_DEFAULT_COLORS[(key === SHARED_ROOM ? 0 : hashOf(key)) % AREA_DEFAULT_COLORS.length],
    })),
    areaTiles,
    generated: 'projects',
  };
}
