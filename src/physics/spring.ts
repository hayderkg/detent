import type { Motion, SpringConfig } from './types'

/**
 * Default rest thresholds: half a CSS px and 0.01px/ms (10px/s). Below both, the motion lands exactly
 * on its target. Pass `restDelta = 0.5 / devicePixelRatio` so the final jump is under half a device
 * pixel: invisible, and it cuts the sub-pixel creep that reads as blurry text.
 */
export const REST_DELTA = 0.5
export const REST_SPEED = 0.01
const STEP = 4 // ms, settle-time search resolution
const MAX_T = 10_000

export const dampingRatio = ({ stiffness: k, damping: c, mass: m }: SpringConfig): number =>
  c / (2 * Math.sqrt(k * m))

/** Damping that gives damping ratio ζ for this stiffness and mass. */
export const dampingFor = (zeta: number, stiffness: number, mass: number): number =>
  2 * zeta * Math.sqrt(stiffness * mass)

/**
 * Closed-form damped harmonic oscillator. Returns Δ(t) = x − to (px) and v (px/ms) for t in ms.
 * Evaluated analytically, so it is exact at any frame rate (no integration error, no dt).
 */
function solver(d0: number, v0: number, w0: number, z: number) {
  const V0 = v0 * 1000 // px/s; the spring constants are in seconds
  if (z < 1 - 1e-6) {
    const wd = w0 * Math.sqrt(1 - z * z)
    const B = (V0 + z * w0 * d0) / wd
    return (ms: number): [number, number] => {
      const t = ms / 1000
      const e = Math.exp(-z * w0 * t)
      const c = Math.cos(wd * t)
      const s = Math.sin(wd * t)
      const d = e * (d0 * c + B * s)
      return [d, (e * (B * wd * c - d0 * wd * s) - z * w0 * d) / 1000]
    }
  }
  if (z <= 1 + 1e-6) {
    const B = V0 + w0 * d0
    return (ms: number): [number, number] => {
      const t = ms / 1000
      const e = Math.exp(-w0 * t)
      return [(d0 + B * t) * e, ((B - w0 * (d0 + B * t)) * e) / 1000]
    }
  }
  const q = Math.sqrt(z * z - 1)
  const r1 = -w0 * (z - q)
  const r2 = -w0 * (z + q)
  const B = (V0 - r1 * d0) / (r2 - r1)
  const A = d0 - B
  return (ms: number): [number, number] => {
    const t = ms / 1000
    const e1 = A * Math.exp(r1 * t)
    const e2 = B * Math.exp(r2 * t)
    return [e1 + e2, (r1 * e1 + r2 * e2) / 1000]
  }
}

function settle(f: (ms: number) => [number, number], restDelta: number): number {
  for (let t = 0; t < MAX_T; t += STEP) {
    const [d, v] = f(t)
    if (Math.abs(d) < restDelta && Math.abs(v) < REST_SPEED) return t
  }
  return MAX_T
}

/**
 * A spring from `from` (with initial velocity v0, px/ms) to `to`.
 * `maxDuration` caps settle time by speeding the spring up while keeping its damping ratio,
 * so the character of the motion (overshoot) is preserved, just faster.
 */
export function spring(
  from: number,
  to: number,
  v0: number,
  config: SpringConfig,
  maxDuration = Infinity,
  restDelta = REST_DELTA,
): Motion {
  const z = dampingRatio(config)
  let w0 = Math.sqrt(config.stiffness / config.mass)
  let f = solver(from - to, v0, w0, z)
  let duration = settle(f, restDelta)
  for (let i = 0; i < 4 && duration > maxDuration; i++) {
    w0 *= (duration / maxDuration) * 1.05
    f = solver(from - to, v0, w0, z)
    duration = settle(f, restDelta)
  }
  return {
    to,
    duration,
    at(t) {
      if (t >= duration) return { x: to, v: 0, phase: 'spring' }
      const [d, v] = f(Math.max(0, t))
      return { x: to + d, v, phase: 'spring' }
    },
  }
}
