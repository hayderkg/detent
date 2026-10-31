import type { Motion } from './types'

/** Time constant (ms) of exponential decay with per-ms retention `decay` (iOS: 0.998 → ~499.5ms). */
export const tau = (decay: number): number => -1 / Math.log(decay)

/** Resting point of a coast: x∞ = x₀ + v₀·τ. */
export const project = (x: number, v: number, decay: number): number => x + v * tau(decay)

/**
 * Exponential coast: v(t) = v₀·e^(−t/τ), x(t) = x₀ + v₀·τ·(1 − e^(−t/τ)).
 * Never at rest on its own, so `duration` is the caller's handoff time.
 */
export function coast(x0: number, v0: number, T: number, duration: number): Motion {
  return {
    to: x0 + v0 * T,
    duration,
    at(t) {
      const e = Math.exp(-t / T)
      return { x: x0 + v0 * T * (1 - e), v: v0 * e, phase: 'coast' }
    },
  }
}

/** Time at which a coast reaches position `x` (NaN if it never does). */
export function coastTimeTo(x0: number, v0: number, T: number, x: number): number {
  const r = 1 - (x - x0) / (v0 * T)
  return r > 0 && r <= 1 ? -T * Math.log(r) : NaN
}
