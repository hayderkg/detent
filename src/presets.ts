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

/**
 * The default: a picker that feels like iOS. Heavier than a scroll view (between UIScrollView's .fast 0.99
 * and .normal 0.998 deceleration), with a slightly underdamped settle.
 */
export const ios: Physics = { decay: 0.995, spring: s(450, 0.85), rubberBand: 1, maxVelocity: 8, snapDuration: 900, handoff: 1, magnet: 1.1 }

/** Tuned bundles. Pass one as `preset` (e.g. `preset: presets.snappy`); unused ones are tree-shaken. */
export const presets: Record<PresetName, Physics> = /* @__PURE__ */ (() => ({
  ios,
  /** UIScrollView .normal deceleration: long, list-like glides. */
  scroll: { decay: 0.998, spring: s(450, 0.85), rubberBand: 1, maxVelocity: 8, snapDuration: 900, handoff: 1, magnet: 1.1 },
  snappy: { decay: 0.993, spring: s(600, 0.85), rubberBand: 0.8, maxVelocity: 7, snapDuration: 500, handoff: 0.5, magnet: 1.6 },
  heavy: { decay: 0.9985, spring: s(140, 1, 1.6), rubberBand: 0.6, maxVelocity: 5, snapDuration: 1200, handoff: 0.5, magnet: 1 },
  elastic: { decay: 0.998, spring: s(220, 0.55), rubberBand: 1, maxVelocity: 8, snapDuration: 1400, handoff: 2, magnet: 100 },
  linear: { decay: 0.99, spring: s(500, 1), rubberBand: 0.4, maxVelocity: 6, snapDuration: 300, handoff: 0.5, magnet: 3 },
}))()

export interface PhysicsOptions extends Partial<Omit<Physics, 'spring'>> {
  /** Base physics (default `ios`), e.g. `presets.snappy`. Individual options below override it. */
  preset?: Physics
  spring?: Partial<SpringConfig>
  /** 0–1 shorthand for an underdamped settle: ζ = 1 − 0.7·overshoot. Overrides spring.damping. */
  overshoot?: number
}

const fields = ['decay', 'rubberBand', 'maxVelocity', 'snapDuration', 'handoff', 'magnet'] as const

export function resolvePhysics(o: PhysicsOptions = {}): Physics {
  const base = o.preset ?? ios
  const spring = { ...base.spring, ...o.spring }
  if (o.overshoot != null) spring.damping = dampingFor(1 - 0.7 * o.overshoot, spring.stiffness, spring.mass)
  const r = { ...base, spring }
  for (const f of fields) if (o[f] != null) r[f] = o[f]!
  return r
}
