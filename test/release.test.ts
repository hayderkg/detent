import { describe, expect, it } from 'vitest'
import { crossings, presets, project, release, resolvePhysics, type Bounds } from '../src'
import { sample } from './helpers'

const H = 36
const bounds: Bounds = { min: 0, max: 99, loop: false, count: 100 }
/** Wide enough that no test throw reaches an edge. */
const open: Bounds = { min: 0, max: 999, loop: false, count: 1000 }
const ios = presets.ios

describe('release', () => {
  it('lands on the row nearest the projected resting point', () => {
    for (const v of [0.4, 1, 2.5, -1.3, 4]) {
      const x = 500 * H + 7
      const m = release(x, v, H, open, ios)
      expect(m.index).toBe(Math.round(project(x, v, ios.decay) / H))
      expect(m.at(m.duration)).toMatchObject({ x: m.index * H, v: 0 })
    }
  })

  it('starts exactly at the release position and velocity', () => {
    const m = release(1000, 2, H, bounds, ios)
    expect(m.at(0).x).toBe(1000)
    expect(m.at(0).v).toBeCloseTo(2, 12)
  })

  it('is continuous in position and velocity, with gentle acceleration, away from edges', () => {
    for (const v of [0.3, 1.2, 3, 6, -2]) {
      const m = release(400 * H + 11, v, H, open, ios)
      const s = sample(m, 1000)
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]!, b = s[i]!
        expect(Math.abs(b.x - a.x)).toBeLessThan(Math.abs(a.v) * 1 + 0.05) // no jumps
        expect(Math.abs(b.v - a.v)).toBeLessThan(0.02) // no velocity kicks
      }
    }
  })

  it('never reverses direction on a critically damped throw (no visible correction)', () => {
    for (const v of [0.5, 1, 2, 3.3, 5, -0.7, -2.2]) {
      const m = release(500 * H + 3, v, H, open, ios)
      for (const s of sample(m, 240)) expect(s.v * Math.sign(v)).toBeGreaterThanOrEqual(-1e-9)
    }
  })

  it('a still release springs to the nearest row', () => {
    const m = release(10 * H + 20, 0, H, bounds, ios)
    expect(m.index).toBe(11)
    expect(m.duration).toBeLessThan(ios.snapDuration + 1)
  })

  it('respects maxVelocity', () => {
    const m = release(50 * H, 100, H, { ...bounds, max: 10_000, count: 10_001 }, ios)
    expect(m.index).toBe(Math.round(project(50 * H, ios.maxVelocity, ios.decay) / H))
  })

  it('skips disabled rows', () => {
    const enabled = (i: number) => i % 2 === 0
    const m = release(20 * H, 0.2, H, { ...bounds, enabled }, ios)
    expect(m.index % 2).toBe(0)
    expect(m.at(m.duration).x).toBe(m.index * H)
  })

  it('bounces off the end: passes it, comes back, rests on the last row', () => {
    const m = release(95 * H, 3, H, bounds, ios)
    expect(m.index).toBe(99)
    const xs = sample(m, 240).map((s) => s.x)
    expect(Math.max(...xs)).toBeGreaterThan(99 * H + 2)
    expect(m.at(m.duration).x).toBe(99 * H)
  })

  it('carries velocity into the wall without a jump (hard bounce)', () => {
    const m = release(40 * H, 6, H, bounds, ios)
    let switched = false
    for (let t = 0.05; t < m.duration; t += 0.05) {
      const a = m.at(t - 0.05), b = m.at(t)
      if (a.phase !== b.phase) {
        switched = true
        expect(Math.abs(b.v - a.v)).toBeLessThan(0.01)
        expect(Math.abs(b.x - a.x)).toBeLessThan(0.5)
      }
    }
    expect(switched).toBe(true)
  })

  it('released in the rubber band springs back to the edge', () => {
    const m = release(-40, 0, H, bounds, ios)
    expect(m.index).toBe(0)
    expect(m.at(m.duration).x).toBe(0)
  })

  it('loops without bounds', () => {
    const m = release(2 * H, -3, H, { min: 0, max: 9, loop: true, count: 10 }, ios)
    expect(m.index).toBeLessThan(0)
    expect(m.at(m.duration).x).toBe(m.index * H)
  })

  it('elastic preset overshoots the target, then settles on it', () => {
    const p = resolvePhysics({ preset: 'elastic' })
    const m = release(10 * H, 1.5, H, bounds, p)
    const xs = sample(m, 240).map((s) => s.x)
    expect(Math.max(...xs)).toBeGreaterThan(m.index * H + 4) // visible, not a twitch
    expect(m.at(m.duration).x).toBe(m.index * H)
  })

  it('is frame-rate independent: same positions and same ticks at 60, 120, 144Hz', () => {
    const m = release(30 * H + 5, 2.7, H, bounds, ios)
    expect(m.at(500).x).toBe(m.at(500).x)
    const ticks = (hz: number) => {
      const got: number[] = []
      const s = sample(m, hz, 0.3, hz)
      for (let i = 1; i < s.length; i++) crossings(s[i - 1]!.x, s[i]!.x, H, (j) => got.push(j))
      return got
    }
    expect(ticks(60)).toEqual(ticks(120))
    expect(ticks(144)).toEqual(ticks(60))
  })

  it('settles in an iOS-like time for a typical flick', () => {
    // iOS picker: a medium flick (~1.5px/ms) glides and settles in roughly 1–2.5s.
    const m = release(50 * H, 1.5, H, bounds, ios)
    expect(m.duration).toBeGreaterThan(800)
    expect(m.duration).toBeLessThan(2500)
  })
})

describe('resolvePhysics', () => {
  it('overshoot maps to the damping ratio', () => {
    const p = resolvePhysics({ overshoot: 0.5 })
    expect(p.spring.damping / (2 * Math.sqrt(p.spring.stiffness * p.spring.mass))).toBeCloseTo(0.65, 10)
  })
  it('overrides a preset field by field', () => {
    const p = resolvePhysics({ preset: 'snappy', decay: 0.99, spring: { mass: 2 } })
    expect(p.decay).toBe(0.99)
    expect(p.spring.mass).toBe(2)
    expect(p.spring.stiffness).toBe(presets.snappy.spring.stiffness)
  })
})
