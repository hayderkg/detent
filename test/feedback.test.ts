// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { haptics, tickSound, ticks } from '../src/feedback'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('haptics', () => {
  it('vibrates per tick, thinned to one pulse per interval', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    const h = haptics({ pattern: 10, interval: 30 })
    for (let i = 0; i < 10; i++) {
      h(i, 2)
      vi.advanceTimersByTime(10) // a tick every 10ms (fast spin)
    }
    expect(vibrate).toHaveBeenCalledTimes(4) // t = 0, 30, 60, 90
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('is a no-op where the Vibration API is missing (iOS Safari, SSR)', () => {
    vi.stubGlobal('navigator', {})
    expect(() => haptics()(0, 1)).not.toThrow()
  })
})

/** A Web Audio stand-in: counts contexts, records each click's gain. */
function fakeContext(gains: number[], filters: { frequency: { value: number }; Q: { value: number } }[] = []) {
  const node = () => ({ connect: (n: unknown) => n })
  return class FakeContext {
    static created = 0
    sampleRate = 48000
    state = 'running'
    destination = {}
    constructor() {
      FakeContext.created++
    }
    createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) })
    createBufferSource = () => ({ ...node(), buffer: null, start: () => {} })
    createBiquadFilter = () => {
      const f = { ...node(), type: '', frequency: { value: 0 }, Q: { value: 0 } }
      filters.push(f)
      return f
    }
    createGain = () => {
      const g = { ...node(), gain: { value: 0 } }
      queueMicrotask(() => gains.push(g.gain.value))
      return g
    }
  }
}

describe('tickSound', () => {
  it('is a no-op without Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => tickSound()(0, 1)).not.toThrow()
  })

  it('never starts audio from a tick: only after a gesture, once the wheel has been quiet, shared by every handler', async () => {
    vi.resetModules()
    const { tickSound } = await import('../src/feedback')
    const gains: number[] = []
    const Ctx = fakeContext(gains)
    const activation = { hasBeenActive: false }
    vi.stubGlobal('AudioContext', Ctx)
    vi.stubGlobal('navigator', { ...navigator, userActivation: activation })
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const a = tickSound({ volume: 1, fullAt: 2, interval: 0 })
    const b = tickSound()
    // A mouse wheel before any gesture: silent, and no context (it could not start yet, and starting one stalls).
    a(0, 1)
    vi.advanceTimersByTime(2000)
    expect(Ctx.created).toBe(0)
    // After a gesture, a spin keeps pushing the start back until it goes quiet.
    activation.hasBeenActive = true
    for (let i = 0; i < 10; i++) {
      a(i, 2)
      vi.advanceTimersByTime(i < 5 ? 100 : 600) // a coast ends with sparse ticks
    }
    expect(Ctx.created).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(Ctx.created).toBe(1)
    // Now it plays, louder the faster the wheel spins, and the other handler shares the context.
    a(0, 0.2)
    vi.advanceTimersByTime(1)
    a(1, 4)
    b(2, 1)
    expect(Ctx.created).toBe(1)
    await Promise.resolve()
    expect(gains.length).toBe(3)
    expect(gains[1]!).toBeGreaterThan(gains[0]!)
  })

  it('after an earlier gesture, starts on its own shortly after it is created', async () => {
    vi.resetModules()
    const { tickSound } = await import('../src/feedback')
    const Ctx = fakeContext([])
    vi.stubGlobal('AudioContext', Ctx)
    vi.stubGlobal('navigator', { ...navigator, userActivation: { hasBeenActive: true } })
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    tickSound()
    expect(Ctx.created).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(Ctx.created).toBe(1)
  })
})

describe('ticks', () => {
  it('fans one onTick out to several handlers and skips falsy ones', () => {
    const a = vi.fn()
    const b = vi.fn()
    ticks(a, false, b, null)(3, 1.5)
    expect(a).toHaveBeenCalledWith(3, 1.5)
    expect(b).toHaveBeenCalledWith(3, 1.5)
  })
})

describe('ticks options', () => {
  it('builds haptics from { haptics: true } and still accepts handlers', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    const mine = vi.fn()
    ticks({ haptics: true }, mine)(1, 1)
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(mine).toHaveBeenCalledWith(1, 1)
  })
})


it('dynamic timbre follows absolute velocity while the default timbre stays fixed', async () => {
  vi.resetModules()
  const { tickSound } = await import('../src/feedback')
  const filters: { frequency: { value: number }; Q: { value: number } }[] = []
  vi.stubGlobal('AudioContext', fakeContext([], filters))
  vi.stubGlobal('navigator', { ...navigator, userActivation: { hasBeenActive: true } })
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
  const dynamic = tickSound({ dynamicTimbre: true, interval: 0 })
  const plain = tickSound({ interval: 0 })
  vi.advanceTimersByTime(1000)
  dynamic(0, 0)
  dynamic(1, 4)
  dynamic(2, -4)
  plain(3, 0)
  plain(4, 4)
  expect(filters[1]!.frequency.value).toBeGreaterThan(filters[0]!.frequency.value)
  expect(filters[1]!.Q.value).toBeLessThan(filters[0]!.Q.value)
  expect(filters[2]!.frequency.value).toBe(filters[1]!.frequency.value)
  expect(filters.slice(3).map((f) => f.frequency.value)).toEqual([2400, 2400])
})
