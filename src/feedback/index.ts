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
  /** Velocity changes the click timbre: true, or intensity 0–1. Off by default. */
  dynamicTimbre?: boolean | number
}

/**
 * One audio context for every tickSound handler. Starting it costs Chrome ~100 ms of main thread, so a tick never
 * starts it (that would stall the start of a spin): it starts once ticks have been quiet for a second (a coast ends
 * with slow, sparse ticks), and only after the page has had a gesture (before that it could not play anyway; a mouse
 * wheel is not one). Until then, ticks are silent.
 */
let audio: [AudioContext, AudioBuffer] | undefined
let timer: ReturnType<typeof setTimeout> | undefined

function soon() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (audio || navigator.userActivation?.hasBeenActive === false) return
    const ctx = new AudioContext()
    const len = Math.ceil(ctx.sampleRate * 0.006)
    const click = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = click.getChannelData(0)
    // Decaying noise with a fast attack: reads as a detent, not a beep.
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6))
    audio = [ctx, click]
  }, 1000)
}

/** A soft mechanical click from a few ms of filtered noise, louder the faster the wheel spins. */
export function tickSound({ volume = 0.5, fullAt = 2, interval = 22, dynamicTimbre = false }: TickSoundOptions = {}): TickHandler {
  let last = -Infinity
  if (typeof AudioContext !== 'undefined') soon()
  return (_, velocity) => {
    if (typeof AudioContext === 'undefined') return
    if (!audio) return soon()
    const now = performance.now()
    if (now - last < interval) return
    last = now
    const [ctx, click] = audio
    if (ctx.state === 'suspended') void ctx.resume()
    const src = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    src.buffer = click
    filter.type = 'bandpass'
    const speed = Number.isFinite(velocity) ? Math.min(1, Math.abs(velocity) / Math.max(0.01, fullAt)) : 0
    const amount = dynamicTimbre === true ? 1 : typeof dynamicTimbre === 'number' && Number.isFinite(dynamicTimbre) ? Math.max(0, Math.min(1, dynamicTimbre)) : 0
    filter.frequency.value = 2400 + amount * (speed * 1600 - 400)
    filter.Q.value = 1.2 - amount * speed * 0.5
    gain.gain.value = volume * (0.25 + 0.75 * Math.min(1, Math.abs(velocity) / fullAt))
    src.connect(filter).connect(gain).connect(ctx.destination)
    src.start()
  }
}

export interface TicksOptions {
  /** Vibrate per tick: true, or haptics options. */
  haptics?: boolean | HapticsOptions
  /** A soft click per tick: true, or tick sound options. */
  sound?: boolean | TickSoundOptions
}

/**
 * One onTick from several sources: `ticks({ haptics: true, sound: true })`, or combine handlers,
 * `ticks(myHandler, haptics(), tickSound({ volume: 0.3 }))`. Falsy entries are skipped.
 */
export function ticks(...sources: (TickHandler | TicksOptions | false | null | undefined)[]): TickHandler {
  const handlers: TickHandler[] = []
  for (const s of sources) {
    if (typeof s === 'function') handlers.push(s)
    else if (s) {
      if (s.haptics) handlers.push(haptics(s.haptics === true ? {} : s.haptics))
      if (s.sound) handlers.push(tickSound(s.sound === true ? {} : s.sound))
    }
  }
  return (i, v) => {
    for (const h of handlers) h(i, v)
  }
}
