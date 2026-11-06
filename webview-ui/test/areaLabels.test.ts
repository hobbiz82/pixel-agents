/**
 * mptl fork (Đ2): where Area names are drawn. Hand-made Areas keep the label
 * at the middle of the Area; generated project rooms show their (renamed)
 * title on the first floor row, so it does not sit on the desks.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { AREA_DEFAULT_COLORS } from '../src/constants.js';
import { areaLabelSpots } from '../src/office/engine/areaLabels.js';

// 4×3 grid: area "a" fills rows 1–2 of columns 0–1, area "b" column 3 rows 0–2.
const tiles = ['', '', null, 'b', 'a', 'a', null, 'b', 'a', 'a', null, 'b'].map((t) =>
  t === '' ? null : t,
);

describe('areaLabelSpots', () => {
  test('middle of the Area, label text, for hand-made Areas', () => {
    const spots = areaLabelSpots(
      tiles,
      [{ label: 'a', color: AREA_DEFAULT_COLORS[0] }],
      4,
      3,
      'middle',
    );
    assert.deepEqual(
      spots.find((s) => s.label === 'a'),
      { label: 'a', text: 'a', col: 1, row: 2 },
    );
  });

  test('top row of the Area and its title, for generated rooms', () => {
    const spots = areaLabelSpots(
      tiles,
      [
        { label: 'a', color: AREA_DEFAULT_COLORS[0], title: 'Kho' },
        { label: 'b', color: AREA_DEFAULT_COLORS[0] },
      ],
      4,
      3,
      'top',
    );
    assert.deepEqual(spots, [
      { label: 'b', text: 'b', col: 3.5, row: 0.5 },
      { label: 'a', text: 'Kho', col: 1, row: 1.5 },
    ]);
  });

  test('labels with no Area definition are skipped', () => {
    assert.deepEqual(areaLabelSpots(tiles, [], 4, 3, 'top'), []);
  });
});
