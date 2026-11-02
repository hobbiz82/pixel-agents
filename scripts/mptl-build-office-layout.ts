#!/usr/bin/env node
/**
 * mptl fork: build webview-ui/public/assets/default-layout-2.json — a 3×2 grid
 * of copies of the upstream room (default-layout-1.json), so 20+ sessions get
 * a seat each instead of piling into one 14-seat room.
 *
 * Each copy keeps the upstream furniture. The first four rooms are Areas named
 * after project folders, so new characters from that folder sit there; the
 * last two rooms stay unzoned (shared). Floors get a hue shift per room so
 * rooms are easy to tell apart. Re-run after changing ROOM_LABELS:
 *
 *   npx tsx scripts/mptl-build-office-layout.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AREA_DEFAULT_COLORS } from '../webview-ui/src/constants.js';

const assetsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../webview-ui/public/assets',
);

/** One label per room, left→right then top→bottom; null = shared room. */
const ROOM_LABELS: Array<string | null> = [
  'mptl-kho',
  'local-ai-system',
  'skills',
  'zakka_crm2',
  null,
  null,
];
const GRID_COLS = 3;
const REVISION = 2;

const WALL = 0;
const VOID = 255;

interface Furniture {
  uid: string;
  type: string;
  col: number;
  row: number;
}
interface Color {
  h: number;
  s: number;
  b: number;
  c: number;
}
interface Layout {
  cols: number;
  rows: number;
  tiles: number[];
  tileColors?: Array<Color | null>;
  furniture: Furniture[];
}

const src = JSON.parse(
  fs.readFileSync(path.join(assetsDir, 'default-layout-1.json'), 'utf8'),
) as Layout;

// Crop the upstream room to the rows it uses: from the row its wall decor hangs
// on (one above the top wall) down to the last floor row. Columns stay whole —
// the trailing void column separates neighbouring rooms.
let firstRow = src.rows;
let lastRow = -1;
for (let r = 0; r < src.rows; r++) {
  for (let c = 0; c < src.cols; c++) {
    if (src.tiles[r * src.cols + c] !== VOID) {
      firstRow = Math.min(firstRow, r);
      lastRow = Math.max(lastRow, r);
    }
  }
}
const top = Math.min(firstRow - 1, ...src.furniture.map((f) => f.row));
const roomW = src.cols;
const roomH = lastRow - top + 1;
const gridRows = Math.ceil(ROOM_LABELS.length / GRID_COLS);
const cols = roomW * GRID_COLS;
const rows = roomH * gridRows;

const tiles = new Array<number>(cols * rows).fill(VOID);
const tileColors = new Array<Color | null>(cols * rows).fill(null);
const areaTiles = new Array<string | null>(cols * rows).fill(null);
const furniture: Furniture[] = [];

ROOM_LABELS.forEach((label, k) => {
  const dc = (k % GRID_COLS) * roomW;
  const dr = Math.floor(k / GRID_COLS) * roomH;
  for (let r = 0; r < roomH; r++) {
    for (let c = 0; c < roomW; c++) {
      const from = (r + top) * src.cols + c;
      const to = (r + dr) * cols + (c + dc);
      const t = src.tiles[from];
      tiles[to] = t;
      const color = src.tileColors?.[from] ?? null;
      tileColors[to] = color && t !== WALL ? { ...color, h: (color.h + k * 47) % 360 } : color;
      if (label && t !== WALL && t !== VOID) areaTiles[to] = label;
    }
  }
  for (const f of src.furniture) {
    furniture.push({ ...f, uid: `${f.uid}-r${k}`, col: f.col + dc, row: f.row - top + dr });
  }
});

const areas = ROOM_LABELS.filter((l): l is string => l !== null).map((label, i) => ({
  label,
  color: AREA_DEFAULT_COLORS[i % AREA_DEFAULT_COLORS.length],
}));

const out = {
  version: 1,
  cols,
  rows,
  layoutRevision: REVISION,
  tiles,
  tileColors,
  furniture,
  areas,
  areaTiles,
};
const dest = path.join(assetsDir, `default-layout-${REVISION}.json`);
fs.writeFileSync(dest, JSON.stringify(out) + '\n');
console.log(
  `${path.basename(dest)}: ${cols}×${rows}, ${furniture.length} furniture, ${areas.length} areas`,
);
