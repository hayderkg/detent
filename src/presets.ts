import { dampingFor } from './physics/spring'
import type { SpringConfig } from './physics/types'

export interface Physics {
  decay: number
  spring: SpringConfig
  /** 0–1 resistance past the ends (0 = hard stop). */
  rubberBand: number
  maxVelocity: number
  snapDuration: number
  /** Rows before the target where the coast hands off to the spring. Larger = more spring character. */
  handoff: number
  /** How hard the row pulls the wheel in at the end of a throw (≥ 1; 1 = pure glide). */
  magnet: number
}

export type PresetName = 'ios' | 'scroll' | 'snappy' | 'heavy' | 'elastic' | 'linear'

const s = (stiffness: number, zeta: number, mass = 1): SpringConfig => ({
  stiffness,
  damping: dampingFor(zeta, stiffness, mass),
  mass,
})

export const presets: Record<PresetName, Physics> = {
  /**
   * PROVISIONAL. UIPickerView feels heavier than a scroll view: somewhere between UIScrollView's
   * .fast (0.99, τ≈100ms) and .normal (0.998, τ≈500ms). To be decided side by side with a real
   * iOS picker on device.
   */
  ios: { decay: 0.995, spring: s(450, 0.85), rubberBand: 1, maxVelocity: 8, snapDuration: 900, handoff: 1, magnet: 1.1 },
  /** UIScrollView .normal deceleration: long, list-like glides. */
  scroll: { decay: 0.998, spring: s(450, 0.85), rubberBand: 1, maxVelocity: 8, snapDuration: 900, handoff: 1, magnet: 1.1 },
  snappy: { decay: 0.993, spring: s(600, 0.85), rubberBand: 0.8, maxVelocity: 7, snapDuration: 500, handoff: 0.5, magnet: 1.6 },
  heavy: { decay: 0.9985, spring: s(140, 1, 1.6), rubberBand: 0.6, maxVelocity: 5, snapDuration: 1200, handoff: 0.5, magnet: 1 },
  elastic: { decay: 0.998, spring: s(220, 0.55), rubberBand: 1, maxVelocity: 8, snapDuration: 1400, handoff: 2, magnet: 100 },
  linear: { decay: 0.99, spring: s(500, 1), rubberBand: 0.4, maxVelocity: 6, snapDuration: 300, handoff: 0.5, magnet: 3 },
}

export interface PhysicsOptions extends Partial<Omit<Physics, 'spring'>> {
  preset?: PresetName
  spring?: Partial<SpringConfig>
  /** 0–1 shorthand for an underdamped settle: ζ = 1 − 0.7·overshoot. Overrides spring.damping. */
  overshoot?: number
}

export function resolvePhysics(o: PhysicsOptions = {}): Physics {
  const base = presets[o.preset ?? 'ios']
  const sp = { ...base.spring, ...o.spring }
  if (o.overshoot != null) sp.damping = dampingFor(1 - 0.7 * o.overshoot, sp.stiffness, sp.mass)
  return {
    decay: o.decay ?? base.decay,
    spring: sp,
    rubberBand: o.rubberBand ?? base.rubberBand,
    maxVelocity: o.maxVelocity ?? base.maxVelocity,
    snapDuration: o.snapDuration ?? base.snapDuration,
    handoff: o.handoff ?? base.handoff,
    magnet: o.magnet ?? base.magnet,
  }
}
