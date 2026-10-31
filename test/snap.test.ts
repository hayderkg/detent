import { describe, expect, it } from 'vitest'
import { crossings, mod, nearest, rubberClamp, rubberband } from '../src'

const b = { min: 0, max: 9, loop: false, count: 10 }

describe('nearest', () => {
  it('clamps to bounds', () => {
    expect(nearest(-4, b)).toBe(0)
    expect(nearest(42, b)).toBe(9)
  })
  it('skips disabled rows to the closest enabled one', () => {
    const enabled = (i: number) => i !== 4 && i !== 5
    expect(nearest(4, { ...b, enabled })).toBe(3)
    expect(nearest(5, { ...b, enabled })).toBe(6)
  })
  it('breaks ties in the direction of travel', () => {
    const enabled = (i: number) => i !== 5
    expect(nearest(5, { ...b, enabled }, 1)).toBe(6)
    expect(nearest(5, { ...b, enabled }, -1)).toBe(4)
  })
  it('wraps when looping', () => {
    const enabled = (i: number) => mod(i, 10) !== 0
    expect(nearest(-20, { ...b, loop: true, enabled }, 1)).toBe(-19)
    expect(nearest(137, { ...b, loop: true })).toBe(137)
  })
  it('returns NaN when nothing is enabled', () => {
    expect(nearest(3, { ...b, enabled: () => false })).toBeNaN()
  })
})

describe('rubberband', () => {
  it('has slope c at 0 and asymptote d', () => {
    expect(rubberband(0.001, 200, 0.55) / 0.001).toBeCloseTo(0.55, 3)
    expect(rubberband(1e9, 200, 0.55)).toBeLessThan(200)
    expect(rubberband(1e9, 200, 0.55)).toBeGreaterThan(199)
  })
  it('is monotonic and continuous at the edges', () => {
    let prev = -Infinity
    for (let x = -300; x <= 600; x += 1) {
      const y = rubberClamp(x, 0, 300, 180, 0.55)
      expect(y).toBeGreaterThan(prev)
      prev = y
    }
    expect(rubberClamp(-1e-9, 0, 300, 180, 0.55)).toBeCloseTo(0, 6)
  })
  it('0 means a hard stop', () => {
    expect(rubberClamp(-50, 0, 300, 180, 0)).toBe(0)
  })
})

describe('crossings', () => {
  it('reports every row crossed, in order, both ways', () => {
    const got: number[] = []
    crossings(0, 130, 36, (i) => got.push(i))
    expect(got).toEqual([1, 2, 3, 4])
    got.length = 0
    crossings(130, -40, 36, (i) => got.push(i))
    expect(got).toEqual([3, 2, 1, 0, -1])
  })
})
