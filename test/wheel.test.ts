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
      expect(r.final - START).toBeGreaterThan(10)
      expect(r.final - START).toBeLessThan(150)
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
