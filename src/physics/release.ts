import { coast, coastTimeTo, tau } from './decay'
import { nearest, type Bounds } from './snap'
import { dampingFor, dampingRatio, spring } from './spring'
import type { Motion, SpringConfig } from './types'

export interface ReleaseOptions {
  /** Per-ms velocity retention of the coast (iOS: 0.998). */
  decay: number
  spring: SpringConfig
  /** px/ms cap on release speed. */
  maxVelocity: number
  /** ms cap on each spring phase. */
  snapDuration: number
  /** Coast → spring handoff distance, in rows. */
  handoff?: number
  /** Rest when within this many px of the target (use 0.5 / devicePixelRatio). */
  restDelta?: number
  /**
   * How hard the row pulls the wheel in at the end of a throw (≥ 1). A spring speeds the coast up
   * when ω₀ > 2ζ/τ', which reads as a magnetic tug; the settle spring is softened to at most
   * magnet × 2ζ/τ'. 1 = pure glide, ~1.1 = imperceptible, 2+ = a noticeable click. Default 1.1.
   */
  magnet?: number
}

export interface Release extends Motion {
  /** Row the motion rests on. */
  readonly index: number
}

/** τ' may differ from τ by this much: friction retuned to land on a row stays imperceptible. */
const TAU_MIN = 0.6
const TAU_MAX = 1.6

/** Run `a` until `t1`, then `b` (which starts at its own t = 0). */
function then(a: Motion, t1: number, b: Motion): Motion {
  const duration = t1 + b.duration
  return {
    to: b.to,
    duration,
    at: (t) => (t < t1 ? a.at(t) : b.at(t >= duration ? b.duration : t - t1)),
  }
}

/**
 * Plan the motion after a release (or after trackpad momentum ends) at position x with velocity v.
 *
 * 1. Project the natural resting point x∞ = x + v·τ.
 * 2. Snap it to the nearest enabled row X.
 * 3. Retune friction so the coast lands exactly on X: τ' = (X − x)/v. Within [0.6τ, 1.6τ] this is
 *    invisible, so the glide simply ends on a row with no correction.
 * 4. Hand off to the spring for the last `handoff` rows, carrying position and velocity (continuous).
 * 5. Throws past an edge coast into it and bounce back with the spring (iOS edge bounce).
 * 6. Anything else (tiny throws, released in the rubber band): spring from (x, v) to X.
 */
export function release(x: number, v: number, size: number, b: Bounds, o: ReleaseOptions): Release {
  v = Math.max(-o.maxVelocity, Math.min(o.maxVelocity, v))
  const T = tau(o.decay)
  const projected = x + v * T
  let index = nearest(Math.round(projected / size), b, v)
  if (index !== index) index = Math.round(x / size) // nothing enabled: settle on the nearest row
  const X = index * size
  const lo = b.min * size
  const hi = b.max * size
  const inside = b.loop || (x >= lo && x <= hi)
  const springTo = (x0: number, v0: number) => spring(x0, X, v0, o.spring, o.snapDuration, o.restDelta)
  const done = (m: Motion): Release => ({ ...m, index })

  // Edge bounce: thrown past the end from inside → coast to the wall, spring back from it.
  if (!b.loop && inside && ((v > 0 && projected > hi + size / 2) || (v < 0 && projected < lo - size / 2))) {
    const tc = coastTimeTo(x, v, T, X)
    if (tc > 0) {
      const c = coast(x, v, T, tc)
      return done(then(c, tc, springTo(X, c.at(tc).v)))
    }
  }

  const d = X - x
  const T2 = d / v
  const handoff = (o.handoff ?? 0.5) * size
  if (inside && v !== 0 && T2 >= TAU_MIN * T && T2 <= TAU_MAX * T && Math.abs(d) > handoff) {
    const th = T2 * Math.log(Math.abs(d) / handoff)
    const c = coast(x, v, T2, th)
    const s = c.at(th)
    const { stiffness: k, mass: m } = o.spring
    const z = dampingRatio(o.spring)
    const w = Math.min(Math.sqrt(k / m), ((o.magnet ?? 1.1) * 2 * z * 1000) / T2)
    const soft = { stiffness: w * w * m, damping: dampingFor(z, w * w * m, m), mass: m }
    return done(then(c, th, spring(s.x, X, s.v, soft, o.snapDuration, o.restDelta)))
  }
  return done(springTo(x, v))
}
