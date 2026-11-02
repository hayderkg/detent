// @vitest-environment happy-dom
/**
 * Replays real wheel recordings (owner's MX Master 2S and MacBook trackpad, Chrome on macOS) through the
 * engine with a fake clock, in the optimized mode ('auto') and in the old behaviour ('smooth').
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine, type WheelMode } from '../src'

interface Sample { t: number; dx: number; dy: number; mode: number; wdx: number | null; wdy: number | null }
interface Take { label: string; samples: Sample[] }
const dir = join(process.cwd(), 'test/fixtures/wheel')
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Take[]
const mouse = load('mx-master-2s-macos.json')
const trackpad = load('trackpad-macbook-macos.json')
const take = (list: Take[], label: string) => list.find((t) => t.label === label)!

const SIZE = 40
const START = 1000

function replay(t: Take, wheelMode: WheelMode = 'auto') {
  const el = document.createElement('div')
  document.body.append(el)
  const frames: { x: number; t: number }[] = []
  const rests: number[] = []
  // No onMode on purpose: the engine must track its mode without a listener (it used not to).
  const engine = createEngine(START, {
    count: 2000, itemSize: SIZE, visibleCount: 7, wheelMode,
    onRender: (x) => frames.push({ x, t: performance.now() }),
    onSettle: (i) => rests.push(i),
  })
  const detach = engine.attach(el)
  let now = 0
  for (const s of t.samples) {
    vi.advanceTimersByTime(Math.max(0, s.t - now))
    now = s.t
    const e = new WheelEvent('wheel', { deltaX: s.dx, deltaY: s.dy, deltaMode: s.mode, bubbles: true, cancelable: true })
    Object.defineProperty(e, 'timeStamp', { value: performance.now() })
    Object.defineProperty(e, 'wheelDeltaY', { value: s.wdy ?? undefined })
    Object.defineProperty(e, 'wheelDeltaX', { value: s.wdx ?? undefined })
    el.dispatchEvent(e)
  }
  for (let i = 0; i < 400 && engine.mode !== 'idle'; i++) vi.advanceTimersByTime(16)
  vi.advanceTimersByTime(200)
  detach()
  el.remove()
  let maxStep = 0
  for (let i = 1; i < frames.length; i++) maxStep = Math.max(maxStep, Math.abs(frames[i]!.x - frames[i - 1]!.x))
  return { final: engine.index, rests, maxStepRows: maxStep / SIZE, x: engine.x }
}

describe('wheel replay (real recordings)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  it('mouse slow clicks: one row per click (9 down, 9 up = back to the start)', () => {
    const r = replay(take(mouse, 'mouse slow clicks'))
    expect(Math.max(...r.rests)).toBe(START + 9)
    expect(r.final).toBe(START)
  })

  it('mouse slow clicks, old behaviour: clicks snapped back (9 clicks down never left the start row)', () => {
    const r = replay(take(mouse, 'mouse slow clicks'), 'smooth')
    expect(r.rests.slice(0, 9)).toEqual(Array(9).fill(START))
  })

  for (const label of ['mouse fast spin', 'mouse free-spin']) {
    it(`${label}: glides (no teleporting), covers a sane distance, lands on a row`, () => {
      const r = replay(take(mouse, label))
      expect(r.maxStepRows, 'rows per frame').toBeLessThan(3.5) // maxVelocity 8px/ms × 16ms / 40px ≈ 3.2
      expect(r.final - START).toBeGreaterThan(40)
      expect(r.final - START).toBeLessThan(250)
      expect(r.x % SIZE).toBe(0)
    })
    it(`${label}, old behaviour: jumped many rows per event`, () => {
      const r = replay(take(mouse, label), 'smooth')
      expect(r.maxStepRows).toBeGreaterThan(10)
    })
  }

  for (const t of trackpad) {
    it(`trackpad (${t.label}): followed 1:1, never a notch step, lands on the nearest row`, () => {
      const r = replay(t)
      const total = t.samples.reduce((s, x) => s + x.dy, 0) / SIZE
      expect(Math.abs(r.final - (START + total))).toBeLessThanOrEqual(1)
      expect(r.x % SIZE).toBe(0)
      // identical to the old behaviour: trackpads are untouched
      expect(replay(t, 'smooth').final).toBe(r.final)
    })
  }
})

/**
 * A fast mouse-wheel spin sends wheel events faster than frames (macOS: bursts every few ms). Each event must carry
 * the running motion forward from where it is now: if it restarts from the last painted frame, the motion's clock
 * keeps resetting and the wheel crawls until the events slow down. These check the motion DURING the burst.
 */
describe('wheel bursts faster than frames', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  /** `deltaY` every `gap` ms for `ms`, starting `phase` ms into a frame; the position (rows) every 50 ms. */
  function burst(wheelMode: WheelMode, gap: number, phase: number, ms = 1000, deltaY = 1000) {
    const el = document.createElement('div')
    document.body.append(el)
    const engine = createEngine(START, { count: 5000, itemSize: SIZE, visibleCount: 7, wheelMode })
    const detach = engine.attach(el)
    const modes = new Set<string>()
    vi.advanceTimersByTime(phase)
    const t0 = performance.now()
    const samples: number[] = []
    let events = 0
    while (performance.now() - t0 < ms) {
      const e = new WheelEvent('wheel', { deltaY, deltaMode: 0, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: performance.now() })
      el.dispatchEvent(e)
      events++
      modes.add(engine.mode)
      const before = Math.floor((performance.now() - t0) / 50)
      vi.advanceTimersByTime(gap)
      for (let k = before + 1; k <= Math.floor((performance.now() - t0) / 50); k++) samples.push(engine.x / SIZE - START)
    }
    const atEnd = engine.x / SIZE - START
    let tail = 0
    while (engine.mode !== 'idle' && tail < 5000) {
      vi.advanceTimersByTime(16)
      tail += 16
    }
    detach()
    el.remove()
    return { samples, events, atEnd, final: engine.index - START, tail, modes }
  }

  for (const gap of [1, 2, 4, 8, 16])
    for (const phase of [0, 5, 11]) {
      it(`auto: events every ${gap}ms (${phase}ms into a frame) move the wheel steadily while they come`, () => {
        const r = burst('auto', gap, phase)
        // Moving within the first 100 ms, and then every 50 ms of the burst (max speed is ~10 rows per 50 ms).
        expect(r.samples[1]!, 'rows after 100ms').toBeGreaterThan(8)
        for (let i = 3; i < r.samples.length; i++) expect(r.samples[i]! - r.samples[i - 1]!, `rows in window ${i}`).toBeGreaterThan(5)
        // And it settles on a row soon after the events stop.
        expect(r.tail).toBeLessThan(1400)
        expect(r.final).toBe(Math.round(r.final))
      })

      it(`step: events every ${gap}ms (${phase}ms into a frame) are one row each, never a throw`, () => {
        const r = burst('step', gap, phase, 300)
        expect(r.modes.has('coast'), 'no coasting in step mode').toBe(false)
        expect(r.final).toBe(r.events) // one row per event, however large its delta
        // The wheel follows the steps while they come: never more than a few frames behind.
        const rate = 50 / gap // rows per 50 ms
        for (let i = 2; i < r.samples.length; i++) expect(r.samples[i]! - r.samples[i - 1]!, `rows in window ${i}`).toBeGreaterThan(rate * 0.5)
        expect(r.tail).toBeLessThan(600)
      })
    }

  it('smooth still follows every delta 1:1 (trackpad behaviour)', () => {
    const r = burst('smooth', 16, 0, 200, 40)
    expect(r.atEnd).toBeCloseTo(r.events, 0)
  })
})

describe('wheel recordings: motion during the gesture', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  /** Replays a take and records the position (rows from the start) 500 ms in, and how long it takes to rest after. */
  function during(t: Take, wheelMode: WheelMode) {
    const el = document.createElement('div')
    document.body.append(el)
    const engine = createEngine(START, { count: 5000, itemSize: SIZE, visibleCount: 7, wheelMode })
    const detach = engine.attach(el)
    let now = 0
    let at500 = NaN
    const t0 = t.samples[0]!.t
    for (const s of t.samples) {
      vi.advanceTimersByTime(Math.max(0, s.t - now))
      now = s.t
      if (s.t - t0 >= 500 && at500 !== at500) at500 = engine.x / SIZE - START
      const e = new WheelEvent('wheel', { deltaX: s.dx, deltaY: s.dy, deltaMode: s.mode, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: performance.now() })
      Object.defineProperty(e, 'wheelDeltaY', { value: s.wdy ?? undefined })
      Object.defineProperty(e, 'wheelDeltaX', { value: s.wdx ?? undefined })
      el.dispatchEvent(e)
    }
    let tail = 0
    while (engine.mode !== 'idle' && tail < 5000) {
      vi.advanceTimersByTime(16)
      tail += 16
    }
    const events = t.samples.length
    detach()
    el.remove()
    return { at500, tail, final: engine.index - START, events }
  }

  // Measured on the MX Master 2S takes: ~53 and ~61 rows by 500 ms (they were ~29 and ~36 with the stalls).
  it('mouse fast spin (auto): well under way within half a second, rests promptly after the last event', () => {
    const r = during(take(mouse, 'mouse fast spin'), 'auto')
    expect(r.at500).toBeGreaterThan(45)
    expect(r.tail).toBeLessThan(500)
  })
  it('mouse free-spin (auto): well under way within half a second, rests promptly after the last event', () => {
    const r = during(take(mouse, 'mouse free-spin'), 'auto')
    expect(r.at500).toBeGreaterThan(50)
    expect(r.tail).toBeLessThan(500)
  })
  for (const label of ['mouse fast spin', 'mouse free-spin'])
    it(`${label} (step): one row per event`, () => {
      const t = take(mouse, label)
      const r = during(t, 'step')
      const down = t.samples.filter((s) => s.dy > 0).length - t.samples.filter((s) => s.dy < 0).length
      expect(r.final).toBe(down)
      expect(r.tail).toBeLessThan(500)
    })
})
