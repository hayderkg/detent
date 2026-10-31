import type { Motion } from '../src'

/** Sample a motion like a rAF loop at `hz`, with optional jitter, until rest. */
export function sample(m: Motion, hz: number, jitter = 0, seed = 1) {
  let r = seed
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  const out: { t: number; x: number; v: number; phase: string }[] = []
  let t = 0
  while (t <= m.duration + 1000 / hz) {
    const s = m.at(t)
    out.push({ t, x: s.x, v: s.v, phase: s.phase })
    t += (1000 / hz) * (1 + (rand() - 0.5) * jitter)
  }
  return out
}

/** Numerical reference: RK4 integration of m·x'' = −k(x − to) − c·x' (seconds), for checking closed forms. */
export function rk4(from: number, to: number, v0: number, k: number, c: number, m: number, tMs: number) {
  let x = from - to, v = v0 * 1000
  const h = 1e-5
  const a = (x: number, v: number) => (-k * x - c * v) / m
  for (let t = 0; t < tMs / 1000 - h / 2; t += h) {
    const k1x = v, k1v = a(x, v)
    const k2x = v + (h / 2) * k1v, k2v = a(x + (h / 2) * k1x, v + (h / 2) * k1v)
    const k3x = v + (h / 2) * k2v, k3v = a(x + (h / 2) * k2x, v + (h / 2) * k2v)
    const k4x = v + h * k3v, k4v = a(x + h * k3x, v + h * k3v)
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
  }
  return { x: x + to, v: v / 1000 }
}
