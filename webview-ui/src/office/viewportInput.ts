/**
 * mptl fork (Đ2.1): mouse navigation of the office, as pure rules.
 *
 * Wheel: plain = zoom, Shift = up/down, Ctrl = left/right, Cmd = zoom.
 * A trackpad pinch reaches the page as a wheel event with ctrlKey set while
 * Ctrl is not held, so the caller passes whether the key is really down and a
 * pinch keeps zooming. macOS turns Shift+wheel into deltaX, so either axis
 * counts as the amount for the Shift and Ctrl moves.
 */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type WheelIntent =
  { kind: 'zoom'; amount: number } | { kind: 'pan'; dx: number; dy: number };

/** The larger of the two deltas, sign kept. */
function dominant(e: WheelLike): number {
  return Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
}

export function wheelIntent(e: WheelLike, ctrlHeld: boolean): WheelIntent {
  if (e.ctrlKey && ctrlHeld) return { kind: 'pan', dx: dominant(e), dy: 0 };
  if (e.shiftKey) return { kind: 'pan', dx: 0, dy: dominant(e) };
  if (e.ctrlKey || e.metaKey) return { kind: 'zoom', amount: e.deltaY };
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return { kind: 'pan', dx: e.deltaX, dy: 0 };
  return { kind: 'zoom', amount: e.deltaY };
}

/**
 * Left-button drag that moves the view. Under `threshold` CSS px it stays a
 * click; past it, `move` gives the offset from the press point and `end`
 * returns true so the caller can swallow the click that follows.
 */
export class DragPan {
  private x = 0;
  private y = 0;
  private pressed = false;
  private dragging = false;
  private readonly threshold: number;

  constructor(threshold = 4) {
    this.threshold = threshold;
  }

  get active(): boolean {
    return this.dragging;
  }

  start(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.pressed = true;
    this.dragging = false;
  }

  move(x: number, y: number): { dx: number; dy: number } | null {
    if (!this.pressed) return null;
    const dx = x - this.x;
    const dy = y - this.y;
    if (!this.dragging && Math.hypot(dx, dy) < this.threshold) return null;
    this.dragging = true;
    return { dx, dy };
  }

  end(): boolean {
    const was = this.dragging;
    this.pressed = false;
    this.dragging = false;
    return was;
  }
}
