/**
 * iOS rubber band: distance shown for an overscroll of `o` px, with dimension `d` and constant `c`.
 * f(o) = (1 − 1/(o·c/d + 1))·d. Slope c at 0, asymptote d.
 */
export const rubberband = (o: number, d: number, c: number): number =>
  c <= 0 || d <= 0 ? 0 : (1 - 1 / ((o * c) / d + 1)) * d

/** Map a raw position to what is displayed, rubber-banding outside [lo, hi]. */
export function rubberClamp(x: number, lo: number, hi: number, d: number, c: number): number {
  if (x < lo) return lo - rubberband(lo - x, d, c)
  if (x > hi) return hi + rubberband(x - hi, d, c)
  return x
}
