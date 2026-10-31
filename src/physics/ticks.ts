/**
 * Calls `cb` for every row index whose center is crossed moving from position a to b (px),
 * in order of crossing. The centered row is round(x / size).
 */
export function crossings(a: number, b: number, size: number, cb: (index: number) => void): void {
  let i = Math.round(a / size)
  const j = Math.round(b / size)
  if (!Number.isFinite(i) || !Number.isFinite(j)) return // a 0 or NaN size must not hang the page
  while (i !== j) cb((i += i < j ? 1 : -1))
}
