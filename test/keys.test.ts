// @vitest-environment happy-dom
/** Holding an arrow key (keyAcceleration): progressive, predictable, and it stops when the key comes up. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngine, type EngineOptions } from '../src'

const REPEAT = 1000 / 30 // a typical OS key repeat
const SIZE = 40
/** Key repeats between `from` and `to` ms into a hold. */
const repeatsIn = (from: number, to: number) => (to < from ? 0 : Math.floor((to - from) / REPEAT + 1e-9) + 1)

function setup(options: Partial<EngineOptions>, reduced: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
  const el = document.createElement('div')
  el.tabIndex = 0
  document.body.append(el)
  const engine = createEngine(0, { count: 2000, itemSize: SIZE, visibleCount: 5, ...options })
  const detach = engine.attach(el)
  const key = (type: string, k: string, t: number, repeat = false) => {
    const e = new KeyboardEvent(type, { key: k, repeat, bubbles: true, cancelable: true })
    Object.defineProperty(e, 'timeStamp', { value: t })
    el.dispatchEvent(e)
  }
  /** Press `k` at `t0`, hold it for `ms` (repeats from 500ms on), and let go. */
  const hold = (k: string, ms: number, t0 = 0, up = true) => {
    key('keydown', k, t0)
    for (let i = 0; i < repeatsIn(500, ms); i++) key('keydown', k, t0 + 500 + i * REPEAT, true)
    if (up) key('keyup', k, t0 + ms)
  }
  return { el, engine, key, hold, detach }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('keyAcceleration (reduced motion: every step lands at once)', () => {
  const repeats = repeatsIn

  it('off: one row per key repeat, however long it is held', () => {
    const { engine, hold } = setup({ keyAcceleration: false }, true)
    hold('ArrowDown', 6000)
    expect(engine.index).toBe(1 + repeats(500, 6000))
  })

  it('on by default', () => {
    const a = setup({}, true)
    a.hold('ArrowDown', 6000)
    const b = setup({ keyAcceleration: true }, true)
    b.hold('ArrowDown', 6000)
    expect(a.engine.index).toBe(b.engine.index)
    expect(a.engine.index).toBeGreaterThan(1 + repeatsIn(500, 6000))
  })

  it('one row per repeat for 2 s, then ×1.5, then ×2.5', () => {
    const { engine, hold } = setup({ keyAcceleration: true }, true)
    hold('ArrowDown', 1990)
    const normal = engine.index
    expect(normal).toBe(1 + repeats(500, 1990))
    const b = setup({ keyAcceleration: true }, true)
    b.hold('ArrowDown', 6000)
    const rows = b.engine.index
    // 1 + (repeats before 2 s) + 1.5 × (2–4 s) + 2.5 × (4–6 s), give or take the carried fraction
    const expected = 1 + repeats(500, 1999) + 1.5 * (repeats(500, 3999) - repeats(500, 1999)) + 2.5 * (repeats(500, 6000) - repeats(500, 3999))
    expect(Math.abs(rows - expected)).toBeLessThan(2)
  })

  it('custom stages', () => {
    const { engine, hold } = setup({ keyAcceleration: [[0, 3]] }, true)
    hold('ArrowDown', 1000)
    expect(engine.index).toBe(1 + 3 * repeats(500, 1000))
  })

  it('a short press is one row', () => {
    const { engine, key } = setup({ keyAcceleration: true }, true)
    key('keydown', 'ArrowDown', 0)
    key('keyup', 'ArrowDown', 80)
    expect(engine.index).toBe(1)
  })

  it('starts over after the key comes up, on a change of direction, and when focus leaves', () => {
    const { engine, hold, el } = setup({ keyAcceleration: true }, true)
    hold('ArrowDown', 5000, 0, false)
    // A repeat of the other arrow (no keyup in between) is a new press: one row back, then normal speed.
    const at = engine.index
    hold('ArrowUp', 1000, 5000)
    expect(engine.index).toBe(at - 1 - repeats(5500, 6000))
    // Focus leaves mid-hold: the next repeat (if the OS sends one) counts as a fresh press.
    hold('ArrowDown', 5000, 7000, false)
    el.dispatchEvent(new FocusEvent('focusout'))
    const before = engine.index
    hold('ArrowDown', 1000, 12000)
    expect(engine.index - before).toBe(1 + repeats(12500, 13000))
  })

  it('accelerated steps still land only on enabled rows', () => {
    const enabled = (i: number) => i % 3 !== 0
    const { engine, key } = setup({ keyAcceleration: true, isEnabled: enabled }, true)
    const seen: number[] = []
    key('keydown', 'ArrowDown', 0)
    for (let i = 0; i < repeatsIn(500, 6000); i++) {
      key('keydown', 'ArrowDown', 500 + i * REPEAT, true)
      seen.push(engine.index)
    }
    expect(seen.every(enabled)).toBe(true)
    expect(new Set(seen).size).toBeGreaterThan(100)
  })

  it('Home/End and Page Up/Down are unchanged', () => {
    const { engine, key } = setup({ keyAcceleration: true }, true)
    key('keydown', 'PageDown', 0)
    expect(engine.index).toBe(4)
    key('keydown', 'PageDown', 600, true)
    expect(engine.index).toBe(8)
    key('keydown', 'End', 700)
    expect(engine.index).toBe(1999)
    key('keydown', 'Home', 800)
    expect(engine.index).toBe(0)
  })

  it('a horizontal right-to-left wheel accelerates on its own forward arrow (←)', () => {
    const { engine, hold } = setup({ keyAcceleration: true, orientation: 'horizontal', rtl: true }, true)
    hold('ArrowLeft', 3000)
    expect(engine.index).toBeGreaterThan(1 + repeats(500, 3000))
  })
})

describe('keyAcceleration (animated)', () => {
  it('stays a few rows ahead of the screen at most, so letting go settles at once', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'Date'] })
    const { engine, key } = setup({ keyAcceleration: true }, false)
    key('keydown', 'ArrowDown', 0)
    let lead = 0
    let at2 = 0
    for (let i = 0; i < repeatsIn(500, 6000); i++) {
      vi.advanceTimersByTime(REPEAT)
      key('keydown', 'ArrowDown', 500 + i * REPEAT, true)
      lead = Math.max(lead, engine.target - engine.x / SIZE)
      if (500 + i * REPEAT < 2000) at2 = engine.target
    }
    expect(lead).toBeLessThan(10) // under 2 + 2 × 2.5 rows ahead, plus one repeat (at most three rows)
    key('keyup', 'ArrowDown', 6000)
    const at = engine.target
    vi.advanceTimersByTime(450)
    expect(engine.mode).toBe('idle')
    expect(engine.index).toBe(at)
    // It did speed up: the last 4 s covered more than twice the rows of the first 2 s.
    expect(at - at2).toBeGreaterThan(2 * at2)
  })
})
