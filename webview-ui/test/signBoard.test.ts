/**
 * mptl fork (Đ3): room names sit on a sign board (dark plank, Area-coloured
 * frame, light text) so they read on any floor colour.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  AREA_DEFAULT_COLORS,
  AREA_SIGN_BOARD_COLOR,
  AREA_SIGN_TEXT_COLOR,
} from '../src/constants.js';
import type { SignBoardCtx } from '../src/office/engine/areaLabels.js';
import { drawSignBoard, signBoardRects } from '../src/office/engine/areaLabels.js';

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

describe('drawSignBoard', () => {
  test('draws frame in the Area colour, then the board, then light text on top', () => {
    const calls: string[] = [];
    const ctx: SignBoardCtx = {
      globalAlpha: 1,
      fillStyle: '',
      fillRect() {
        calls.push(`rect ${String(ctx.fillStyle)}`);
      },
      fillText(t: string) {
        calls.push(`text ${t} ${String(ctx.fillStyle)}`);
      },
    };
    drawSignBoard(ctx, 'Kho', signBoardRects(20, 10, 18, 12, 2), RED, 2);
    const frame = calls.indexOf(`rect ${RED}`);
    const text = calls.findIndex((c) => c.startsWith('text Kho'));
    assert.ok(frame >= 0, `no Area-coloured frame in ${calls.join(' | ')}`);
    assert.ok(text > frame + 1, `text not drawn after frame + board: ${calls.join(' | ')}`);
    assert.ok(calls.includes(`rect ${AREA_SIGN_BOARD_COLOR}`), 'no dark plank');
    assert.equal(
      calls[text],
      `text Kho ${AREA_SIGN_TEXT_COLOR}`,
      'text should be the light sign colour',
    );
  });
});
