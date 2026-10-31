// Generates SYNTHETIC gesture fixtures (source: "synthetic"). Real ones come from the /lab page on a device.
// Run: node test/fixtures/make-synthetic.mjs
import { writeFileSync } from 'node:fs'

const device = { ua: 'synthetic', dpr: 3, hz: 120, width: 390, height: 844 }
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)

/** Build samples from a velocity profile v(t) in px/ms (finger y), at `hz` with timing jitter. */
function gesture(label, vOf, ms, { hz = 120, holdMs = 0, jitterPx = 0.15, drop = 0 } = {}) {
  const s = [{ t: 0, x: 195, y: 400, type: 'down' }]
  let y = 400, t = 0
  while (t < ms) {
    const dt = (1000 / hz) * (1 + rand() * 0.2)
    y += vOf(t) * dt
    t += dt
    if (drop && rand() > 0.5 - drop) continue // missing frames
    s.push({ t: +t.toFixed(3), x: 195, y: +(y + rand() * jitterPx).toFixed(2), type: 'move' })
  }
  if (holdMs) {
    const end = t + holdMs
    while (t < end) { t += 1000 / hz; s.push({ t: +t.toFixed(3), x: 195, y: +(y + rand() * 0.6).toFixed(2), type: 'move' }) }
  }
  s.push({ t: +(t + 2).toFixed(3), x: 195, y: +y.toFixed(2), type: 'up' })
  return { version: 1, source: 'synthetic', label, pointerType: 'touch', recordedAt: '2026-10-31T00:00:00.000Z', device, samples: s }
}

const ease = (peak, ms) => (t) => peak * Math.sin(Math.min(1, t / ms) * Math.PI * 0.5) // accelerating flick

const fixtures = [
  gesture('flick', ease(-2.2, 70), 110),
  gesture('hard-flick', ease(-6, 50), 80),
  gesture('slow-drag', () => -0.2, 600),
  gesture('hesitant-release', ease(-1.8, 60), 100, { holdMs: 90 }),
  gesture('micro-drag', () => -0.04, 70),
  gesture('reversal', (t) => (t < 160 ? -1.4 : 0.9), 210),
  gesture('flick', ease(1.6, 80), 120, { hz: 60, drop: 0.15 }), // 60Hz, dropped frames
]
writeFileSync(new URL('./gestures/synthetic.json', import.meta.url), JSON.stringify(fixtures, null, 1) + '\n')
console.log(`wrote ${fixtures.length} synthetic gestures`)
