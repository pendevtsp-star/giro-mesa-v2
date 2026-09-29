export function productSwipeStep(horizontal: number, vertical: number): -1 | 0 | 1 {
  if (Math.abs(horizontal) < 48 || Math.abs(horizontal) <= Math.abs(vertical) * 1.5) {
    return 0;
  }
  return horizontal < 0 ? 1 : -1;
}
