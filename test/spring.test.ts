import { describe, expect, it } from 'vitest'
import { dampingFor, dampingRatio, REST_DELTA, spring, type SpringConfig } from '../src'
import { rk4, sample } from './helpers'

const cfg = (k: number, zeta: number, m = 1): SpringConfig => ({ stiffness: k, damping: dampingFor(zeta, k, m), mass: m })

describe('spring', () => {
  for (const zeta of [0.3, 0.7, 1, 1.6]) {
    it(`matches numerical integration (ζ=${zeta})`, () => {
      const c = cfg(170, zeta)
      const m = spring(0, 100, -0.8, c)
      for (const t of [0, 16, 50, 120, 300, 600]) {
        const ref = rk4(0, 100, -0.8, c.stiffness, c.damping, c.mass, t)
        const s = m.at(t)
        expect(s.x).toBeCloseTo(ref.x, 4)
        expect(s.v).toBeCloseTo(ref.v, 6)
      }
    })
  }

  it('starts exactly at the initial position and velocity', () => {
    const s = spring(10, 200, 1.7, cfg(170, 1)).at(0)
    expect(s.x).toBe(10)
    expect(s.v).toBeCloseTo(1.7, 12)
  })

  it('reports velocity consistent with position (finite difference)', () => {
    const m = spring(0, 300, 2, cfg(220, 0.55))
    for (const t of [10, 80, 200]) {
      const fd = (m.at(t + 0.001).x - m.at(t - 0.001).x) / 0.002
      expect(m.at(t).v).toBeCloseTo(fd, 4)
    }
  })

  it('rests exactly on the target after duration', () => {
    const m = spring(0, 36, 0, cfg(170, 1))
    expect(m.duration).toBeGreaterThan(100)
    expect(m.duration).toBeLessThan(1000)
    expect(m.at(m.duration)).toMatchObject({ x: 36, v: 0 })
    const before = m.at(m.duration - 4)
    expect(Math.abs(before.x - 36)).toBeLessThan(REST_DELTA * 4)
  })

  it('critically damped from rest never overshoots', () => {
    const m = spring(0, 100, 0, cfg(170, 1))
    for (const s of sample(m, 240)) expect(s.x).toBeLessThanOrEqual(100 + 1e-9)
  })

  it('underdamped overshoots', () => {
    const m = spring(0, 100, 0, cfg(170, 0.4))
    expect(Math.max(...sample(m, 240).map((s) => s.x))).toBeGreaterThan(110)
  })

  it('caps settle time while keeping the damping ratio', () => {
    const c = cfg(60, 0.5)
    const slow = spring(0, 500, 0, c)
    const capped = spring(0, 500, 0, c, 400)
    expect(slow.duration).toBeGreaterThan(400)
    expect(capped.duration).toBeLessThanOrEqual(400)
    // Same character: overshoot ratio identical.
    const peak = (m: typeof slow) => Math.max(...sample(m, 1000).map((s) => s.x))
    expect(peak(capped)).toBeCloseTo(peak(slow), 0)
  })

  it('zero distance and velocity is already at rest', () => {
    expect(spring(5, 5, 0, cfg(170, 1)).duration).toBe(0)
  })

  it('dampingRatio inverts dampingFor', () => {
    expect(dampingRatio(cfg(300, 0.63, 2))).toBeCloseTo(0.63, 12)
  })
})
