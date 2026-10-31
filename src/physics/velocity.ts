/**
 * Release-velocity estimator over recent pointer samples.
 *
 * Weighted least-squares slope of x(t) over the last `window` ms, with weights (1 − age/(1.5·window))²
 * so recent motion dominates without letting one noisy sample decide. If the newest sample is older
 * than `stale` ms at release, the finger had stopped: velocity is 0.
 */
export interface VelocityTracker {
  push(t: number, x: number): void
  reset(): void
  /** px/ms at time `now`. */
  get(now: number): number
}

export function velocityTracker(window = 100, stale = 40, size = 16): VelocityTracker {
  const ts: number[] = []
  const xs: number[] = []
  return {
    push(t, x) {
      ts.push(t)
      xs.push(x)
      if (ts.length > size) {
        ts.shift()
        xs.shift()
      }
    },
    reset() {
      ts.length = xs.length = 0
    },
    get(now) {
      const n = ts.length
      const last = ts[n - 1]
      if (n < 2 || last === undefined || now - last > stale) return 0
      // Use samples inside the window, but always at least the last two (sparse input).
      let i = n - 1
      while (i > 0 && (now - ts[i - 1]! <= window || i > n - 2)) i--
      // One-pass weighted least squares. Times are taken relative to `now` (|t| ≤ ~150ms), so the
      // Σt² − (Σt)² form has no cancellation problem.
      let sw = 0, st = 0, sx = 0, stt = 0, stx = 0
      for (let j = i; j < n; j++) {
        const t = ts[j]! - now
        const x = xs[j]! - xs[n - 1]! // centered too: positions can be ~1e6px
        const w = (1 - Math.min(1, -t / (window * 1.5))) ** 2 + 1e-6
        sw += w; st += w * t; sx += w * x; stt += w * t * t; stx += w * t * x
      }
      const den = sw * stt - st * st
      return den > 1e-9 ? (sw * stx - st * sx) / den : 0
    },
  }
}
