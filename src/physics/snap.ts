export interface Bounds {
  /** First selectable-or-restable index (can be negative for header rows). Ignored when looping. */
  min: number
  /** Last index. Ignored when looping. */
  max: number
  loop: boolean
  /** Number of distinct items; bounds the search when looping. */
  count: number
  /** Whether a (raw, unwrapped) index can be rested on. Defaults to all. */
  enabled?: (index: number) => boolean
}

export const mod = (i: number, n: number): number => ((i % n) + n) % n

/**
 * The enabled index nearest to `i`. On a tie, prefers the side of `dir` (sign of velocity).
 * Returns NaN when nothing is enabled.
 */
export function nearest(i: number, b: Bounds, dir = 0): number {
  const start = b.loop ? i : Math.min(b.max, Math.max(b.min, i))
  const span = b.loop ? b.count : b.max - b.min
  const ok = (j: number) => (b.loop || (j >= b.min && j <= b.max)) && (!b.enabled || b.enabled(j))
  const first = dir < 0 ? -1 : 1
  for (let d = 0; d <= span; d++) {
    if (ok(start + first * d)) return start + first * d
    if (ok(start - first * d)) return start - first * d
  }
  return NaN
}
