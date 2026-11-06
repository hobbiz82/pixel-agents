/**
 * mptl fork (Đ3): room names sit on a sign board (dark plank, Area-coloured
 * frame, light text) so they read on any floor colour.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { AREA_DEFAULT_COLORS } from '../src/constants.js';
import { signBoardRects } from '../src/office/engine/areaLabels.js';
import { renderAreaLabels } from '../src/office/engine/renderer.js';

const RED = AREA_DEFAULT_COLORS[0];

describe('signBoardRects', () => {
  test('board wraps the text with padding; frame is one border wider all round', () => {
    const r = signBoardRects(100, 50, 60, 12, 2);
    // pad x = 12*0.6 = 7.2 → round 7, pad y = 12*0.35 = 4.2 → round 4, border = zoom = 2
    assert.deepEqual(r.board, { x: 63, y: 40, w: 74, h: 20 });
    assert.deepEqual(r.frame, { x: 61, y: 38, w: 78, h: 24 });
  });

  test('border never thinner than 1px at low zoom', () => {
    const r = signBoardRects(0, 0, 10, 12, 0.5);
    assert.equal(r.board.x - r.frame.x, 1);
  });
});

describe('renderAreaLabels sign board', () => {
  test('draws frame in the Area colour, then the board, then light text on top', () => {
    const calls: string[] = [];
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      globalAlpha: 1,
      fillStyle: '',
      save: () => {},
      restore: () => {},
      measureText: (t: string) => ({ width: t.length * 6 }),
      fillRect: function () {
        calls.push(`rect ${String(this.fillStyle)}`);
      },
      fillText: function (t: string) {
        calls.push(`text ${t} ${String(this.fillStyle)}`);
      },
    };
    renderAreaLabels(
      ctx as unknown as CanvasRenderingContext2D,
      ['a', 'a'],
      [{ label: 'a', color: RED, title: 'Kho' }],
      2,
      1,
      0,
      0,
      2,
      'top',
    );
    const frame = calls.indexOf(`rect ${RED}`);
    const text = calls.findIndex((c) => c.startsWith('text Kho'));
    assert.ok(frame >= 0, `no Area-coloured frame in ${calls.join(' | ')}`);
    assert.ok(text > frame + 1, `text not drawn after frame + board: ${calls.join(' | ')}`);
    assert.ok(!calls[text].endsWith(RED), 'text should be light, not the Area colour');
  });
});
