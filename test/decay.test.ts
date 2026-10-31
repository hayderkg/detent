import { describe, expect, it } from 'vitest'
import { coast, coastTimeTo, project, tau } from '../src'

describe('decay', () => {
  it('iOS normal deceleration rate has τ ≈ 499.5ms', () => {
    expect(tau(0.998)).toBeCloseTo(499.5, 1)
  })

  it('matches discrete per-ms decay v·dⁿ', () => {
    const m = coast(0, 2, tau(0.998), Infinity)
    expect(m.at(100).v).toBeCloseTo(2 * 0.998 ** 100, 10)
    // Sum of per-ms steps ≈ integral.
    let x = 0, v = 2
    for (let i = 0; i < 1000; i++) { v *= 0.998; x += v }
    expect(m.at(1000).x).toBeCloseTo(x, -1)
  })

  it('converges to the projection x + v·τ', () => {
    const T = tau(0.998)
    expect(coast(10, 3, T, Infinity).at(1e6).x).toBeCloseTo(project(10, 3, 0.998), 6)
  })

  it('coastTimeTo inverts the trajectory', () => {
    const T = tau(0.998)
    const t = coastTimeTo(0, 2, T, 400)
    expect(coast(0, 2, T, Infinity).at(t).x).toBeCloseTo(400, 8)
    expect(coastTimeTo(0, 2, T, 2000)).toBeNaN() // beyond the projection: never reached
  })
})
