/**
 * Calls `cb` for every row index whose center is crossed moving from position a to b (px),
 * in order of crossing. The centered row is round(x / size).
 */
export function crossings(a: number, b: number, size: number, cb: (index: number) => void): void {
  let i = Math.round(a / size)
  const j = Math.round(b / size)
  while (i !== j) cb((i += i < j ? 1 : -1))
}
