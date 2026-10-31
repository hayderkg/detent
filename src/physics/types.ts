/** Units throughout the physics core: position in px, time in ms, velocity in px/ms. */
export interface State {
  x: number
  v: number
}

export interface SpringConfig {
  /** N/m-style stiffness, in the same units as react-spring / framer-motion (per s²). */
  stiffness: number
  damping: number
  mass: number
}

export type Phase = 'coast' | 'spring'

export interface Motion {
  /** Final resting position, px. */
  readonly to: number
  /** Total duration, ms. The motion is exactly at rest (x = to, v = 0) from here on. */
  readonly duration: number
  /** Evaluate at elapsed time t (ms). Pure: same t gives the same state at any frame rate. */
  at(t: number): State & { phase: Phase }
}
