import type { AreaDefinition } from '../types.js';

export interface AreaLabelSpot {
  label: string;
  /** What to draw: the Area's title when it has one, else its label. */
  text: string;
  /** Centre of the text, in tiles (fractional). */
  col: number;
  row: number;
}

/**
 * Where to draw each Area's name, in tile units.
 *  - 'middle': the centroid of the Area (hand-made Areas, upstream behaviour).
 *  - 'top' (mptl fork, generated project rooms): centred on the Area's first
 *    row, so the room name sits under the top wall instead of on the desks.
 * Areas are returned in the order their first tile appears (row-major).
 */
export function areaLabelSpots(
  areaTiles: Array<string | null>,
  areas: AreaDefinition[],
  cols: number,
  rows: number,
  placement: 'middle' | 'top',
): AreaLabelSpot[] {
  const defs = new Map(areas.map((a) => [a.label, a]));
  const acc = new Map<
    string,
    { sumX: number; sumY: number; count: number; top: number; minC: number; maxC: number }
  >();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = areaTiles[r * cols + c];
      if (!label || !defs.has(label)) continue;
      const a = acc.get(label);
      if (!a) {
        acc.set(label, { sumX: c, sumY: r, count: 1, top: r, minC: c, maxC: c });
        continue;
      }
      a.sumX += c;
      a.sumY += r;
      a.count += 1;
      if (r === a.top) {
        a.minC = Math.min(a.minC, c);
        a.maxC = Math.max(a.maxC, c);
      }
    }
  }
  return [...acc].map(([label, a]) => ({
    label,
    text: defs.get(label)?.title || label,
    ...(placement === 'top'
      ? { col: (a.minC + a.maxC) / 2 + 0.5, row: a.top + 0.5 }
      : { col: a.sumX / a.count + 0.5, row: a.sumY / a.count + 0.5 }),
  }));
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * mptl fork (Đ3): the sign board behind a room name, in screen pixels.
 * `board` is the plank that holds the text; `frame` is the Area-coloured
 * border around it (one border width bigger on every side). Rounded to whole
 * pixels so the board stays crisp at every zoom.
 */
export function signBoardRects(
  cx: number,
  cy: number,
  textWidth: number,
  fontSize: number,
  zoom: number,
): { board: PixelRect; frame: PixelRect } {
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.35);
  const border = Math.max(1, Math.round(zoom));
  const w = Math.round(textWidth) + padX * 2;
  const h = Math.round(fontSize) + padY * 2;
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  return {
    board: { x, y, w, h },
    frame: { x: x - border, y: y - border, w: w + border * 2, h: h + border * 2 },
  };
}
