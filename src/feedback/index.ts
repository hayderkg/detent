/**
 * Optional tick feedback. Each helper returns an `onTick(index, velocity)` handler; combine them with
 * `ticks(...)`. Nothing here runs at import time, and both are no-ops where unsupported (SSR, iOS
 * Safari has no Vibration API, Web Audio before a user gesture).
 */
export type TickHandler = (index: number, velocity: number) => void

export interface HapticsOptions {
  /** Vibration pattern per tick (ms). Default 8. */
  pattern?: number | number[]
  /** Minimum ms between pulses; fast spins thin out instead of buzzing. Default 35. */
  interval?: number
}

export function haptics({ pattern = 8, interval = 35 }: HapticsOptions = {}): TickHandler {
  let last = -Infinity
  return () => {
    const now = performance.now()
    if (now - last < interval || typeof navigator === 'undefined' || !navigator.vibrate) return
    last = now
    navigator.vibrate(pattern)
  }
}

export interface TickSoundOptions {
  /** 0–1 master volume. Default 0.5. */
  volume?: number
  /** Velocity (px/ms) at which a tick reaches full volume. Default 2. */
  fullAt?: number
  /** Minimum ms between clicks. Default 22. */
  interval?: number
}

/** A soft mechanical click from a few ms of filtered noise, louder the faster the wheel spins. */
export function tickSound({ volume = 0.5, fullAt = 2, interval = 22 }: TickSoundOptions = {}): TickHandler {
  let ctx: AudioContext | undefined
  let click: AudioBuffer | undefined
  let last = -Infinity
  return (_, velocity) => {
    const now = performance.now()
    if (now - last < interval || typeof AudioContext === 'undefined') return
    last = now
    if (!ctx) {
      ctx = new AudioContext()
      const len = Math.ceil(ctx.sampleRate * 0.006)
      click = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = click.getChannelData(0)
      // Decaying noise with a fast attack: reads as a detent, not a beep.
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6))
    }
    if (ctx.state === 'suspended') void ctx.resume()
    const src = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    src.buffer = click!
    filter.type = 'bandpass'
    filter.frequency.value = 2400
    filter.Q.value = 1.2
    gain.gain.value = volume * (0.25 + 0.75 * Math.min(1, Math.abs(velocity) / fullAt))
    src.connect(filter).connect(gain).connect(ctx.destination)
    src.start()
  }
}

/** Run several tick handlers from one onTick. */
export const ticks =
  (...handlers: (TickHandler | false | null | undefined)[]): TickHandler =>
  (i, v) => {
    for (const h of handlers) h && h(i, v)
  }
