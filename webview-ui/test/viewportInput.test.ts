/**
 * mptl fork (Đ2.1): mouse navigation of the office — wheel zooms, Shift+wheel
 * moves up/down, Ctrl+wheel moves left/right, left-drag moves the view.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { DragPan, wheelIntent } from '../src/office/viewportInput.js';

const wheel = (o: Partial<Parameters<typeof wheelIntent>[0]>) => ({
  deltaX: 0,
  deltaY: 0,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...o,
});

describe('wheelIntent', () => {
  test('a plain wheel zooms', () => {
    assert.deepEqual(wheelIntent(wheel({ deltaY: 100 }), false), { kind: 'zoom', amount: 100 });
  });

  test('Shift+wheel moves up/down, also when macOS turns the wheel into deltaX', () => {
    assert.deepEqual(wheelIntent(wheel({ deltaY: 40, shiftKey: true }), false), {
      kind: 'pan',
      dx: 0,
      dy: 40,
    });
    assert.deepEqual(wheelIntent(wheel({ deltaX: -30, shiftKey: true }), false), {
      kind: 'pan',
      dx: 0,
      dy: -30,
    });
  });

  test('Ctrl+wheel (the key really held) moves left/right', () => {
    assert.deepEqual(wheelIntent(wheel({ deltaY: 25, ctrlKey: true }), true), {
      kind: 'pan',
      dx: 25,
      dy: 0,
    });
  });

  test('a trackpad pinch (ctrlKey without the key held) still zooms', () => {
    assert.deepEqual(wheelIntent(wheel({ deltaY: -8, ctrlKey: true }), false), {
      kind: 'zoom',
      amount: -8,
    });
  });

  test('Cmd+wheel zooms', () => {
    assert.deepEqual(wheelIntent(wheel({ deltaY: 5, metaKey: true }), false), {
      kind: 'zoom',
      amount: 5,
    });
  });

  test('a sideways trackpad swipe moves left/right instead of zooming', () => {
    assert.deepEqual(wheelIntent(wheel({ deltaX: 20, deltaY: 3 }), false), {
      kind: 'pan',
      dx: 20,
      dy: 0,
    });
  });
});

describe('DragPan', () => {
  test('a press that barely moves is a click, not a drag', () => {
    const d = new DragPan(4);
    d.start(100, 100);
    assert.equal(d.move(102, 101), null);
    assert.equal(d.end(), false);
  });

  test('past the threshold it reports the offset from the press point', () => {
    const d = new DragPan(4);
    d.start(100, 100);
    assert.deepEqual(d.move(110, 95), { dx: 10, dy: -5 });
    assert.deepEqual(d.move(103, 101), { dx: 3, dy: 1 });
    assert.equal(d.end(), true);
  });

  test('move without a press does nothing; end resets', () => {
    const d = new DragPan(4);
    assert.equal(d.move(50, 50), null);
    d.start(0, 0);
    d.move(20, 0);
    d.end();
    assert.equal(d.active, false);
    assert.equal(d.move(40, 0), null);
  });
});
