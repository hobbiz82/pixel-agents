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
