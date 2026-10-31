import { describe, expect, it } from 'vitest'
import { velocityTracker } from '../src'

describe('velocityTracker', () => {
  it('is exact for constant velocity at any sampling rate', () => {
    for (const hz of [60, 120, 240]) {
      const vt = velocityTracker()
      for (let t = 0; t <= 200; t += 1000 / hz) vt.push(t, 1.5 * t)
      expect(vt.get(200)).toBeCloseTo(1.5, 9)
    }
  })

  it('returns 0 when the finger stopped before release', () => {
    const vt = velocityTracker()
    for (let t = 0; t <= 100; t += 8) vt.push(t, 2 * t)
    expect(vt.get(150)).toBe(0)
  })

  it('ignores a stale history after a pause, using only the latest movement', () => {
    const vt = velocityTracker()
    for (let t = 0; t <= 100; t += 8) vt.push(t, 5 * t) // fast, long ago
    for (let t = 400; t <= 480; t += 8) vt.push(t, 500 + (t - 400) * 0.5) // slow, recent
    expect(vt.get(480)).toBeCloseTo(0.5, 6)
  })

  it('weights recent motion more when decelerating', () => {
    const vt = velocityTracker()
    // v(t) = 3 − 0.02t → at release (t=100) true velocity 1.
    for (let t = 0; t <= 100; t += 8) vt.push(t, 3 * t - 0.01 * t * t)
    const v = vt.get(100)
    expect(v).toBeGreaterThan(1)
    expect(v).toBeLessThan(2) // unweighted slope over the window would be 2
  })

  it('is robust to jittery sample timing', () => {
    const vt = velocityTracker()
    let t = 0
    for (let i = 0; i < 20; i++) { t += 6 + (i % 3) * 3; vt.push(t, -0.9 * t) }
    expect(vt.get(t)).toBeCloseTo(-0.9, 9)
  })

  it('needs two samples', () => {
    const vt = velocityTracker()
    expect(vt.get(0)).toBe(0)
    vt.push(0, 10)
    expect(vt.get(0)).toBe(0)
  })
})

describe('velocityTracker precision', () => {
  it('stays exact far from the origin (large timestamps and positions)', () => {
    const vt = velocityTracker()
    for (let t = 0; t <= 100; t += 8) vt.push(5e7 + t, 3e6 - 1.25 * t)
    expect(vt.get(5e7 + 100)).toBeCloseTo(-1.25, 9)
  })
})
