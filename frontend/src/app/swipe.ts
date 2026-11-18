export interface SwipePoint {
  readonly x: number;
  readonly y: number;
}

export interface SwipeTouch {
  readonly clientX: number;
  readonly clientY: number;
}

export interface SwipeEventLike {
  readonly touches: ArrayLike<SwipeTouch>;
  readonly changedTouches: ArrayLike<SwipeTouch>;
  readonly target: EventTarget | null;
}

export type SwipeDirection = "left" | "right";

const MIN_HORIZONTAL = 56;
const MIN_VERTICAL = 70;
const AXIS_RATIO = 1.3;
const MOBILE_MAX_WIDTH = 1023;

export function pointOf(touch: SwipeTouch): SwipePoint {
  return { x: touch.clientX, y: touch.clientY };
}

export function swipeDirection(start: SwipePoint, end: SwipePoint): SwipeDirection | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < MIN_HORIZONTAL) return null;
  if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return null;
  return dx < 0 ? "left" : "right";
}

export function sheetDismissDirection(start: SwipePoint, end: SwipePoint): "down" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dy < MIN_VERTICAL) return null;
  if (dy < Math.abs(dx) * AXIS_RATIO) return null;
  return "down";
}

export function neighborPath(
  paths: readonly string[],
  current: string,
  direction: SwipeDirection,
): string | null {
  const index = paths.indexOf(current);
  if (index < 0) return null;
  return paths[index + (direction === "left" ? 1 : -1)] ?? null;
}

export function isMobileWidth(): boolean {
  return typeof window !== "undefined" && window.innerWidth > 0 && window.innerWidth <= MOBILE_MAX_WIDTH;
}

export function isHorizontalScrollable(target: Element | null): boolean {
  if (typeof window === "undefined" || target === null) return false;
  let node: Element | null = target;
  while (node !== null) {
    if (node instanceof HTMLElement) {
      const overflowX = window.getComputedStyle(node).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 4) {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export function blocksSwipe(target: Element | null): boolean {
  if (target === null) return false;
  if (target.closest("input, textarea, select, [contenteditable='true']") !== null) return true;
  return isHorizontalScrollable(target);
}
