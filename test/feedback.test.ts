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

describe('tickSound', () => {
  it('is a no-op without Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => tickSound()(0, 1)).not.toThrow()
  })

  it('plays louder the faster the wheel spins, creating the context lazily', () => {
    const gains: number[] = []
    const node = () => ({ connect: (n: unknown) => n })
    class FakeContext {
      static created = 0
      sampleRate = 48000
      state = 'running'
      destination = {}
      constructor() {
        FakeContext.created++
      }
      createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) })
      createBufferSource = () => ({ ...node(), buffer: null, start: () => {} })
      createBiquadFilter = () => ({ ...node(), type: '', frequency: { value: 0 }, Q: { value: 0 } })
      createGain = () => {
        const g = { ...node(), gain: { value: 0 } }
        queueMicrotask(() => gains.push(g.gain.value))
        return g
      }
    }
    vi.stubGlobal('AudioContext', FakeContext)
    vi.useFakeTimers({ toFake: ['performance'] })
    const play = tickSound({ volume: 1, fullAt: 2, interval: 0 })
    expect(FakeContext.created).toBe(0)
    play(0, 0.2)
    vi.advanceTimersByTime(1)
    play(1, 4)
    expect(FakeContext.created).toBe(1)
    return Promise.resolve().then(() => expect(gains[1]!).toBeGreaterThan(gains[0]!))
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
