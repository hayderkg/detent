// @vitest-environment happy-dom
/**
 * Replays recorded gestures (from the /lab page on real devices, plus synthetic ones) through the real
 * engine: DOM pointer events with their original timestamps, and a fake clock driving rAF.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from '../src'

interface Sample { t: number; x: number; y: number; type: 'down' | 'move' | 'up' | 'cancel' }
interface Gesture { source: 'device' | 'synthetic'; label: string; pointerType: string; device: { hz: number; dpr: number }; samples: Sample[] }

const dir = join(process.cwd(), 'test/fixtures/gestures') // happy-dom swaps URL, so use paths
const gestures: (Gesture & { file: string })[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as Gesture[]).map((g) => ({ ...g, file: f })))

const SIZE = 44

function pointer(type: string, s: Sample, pointerType: string) {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType, clientX: s.x, clientY: s.y, buttons: type === 'pointerup' ? 0 : 1 })
  Object.defineProperty(e, 'timeStamp', { value: s.t })
  return e
}

function replay(g: Gesture) {
  const el = document.createElement('div')
  document.body.append(el)
  const frames: { x: number; v: number; t: number }[] = []
  let settled: number | null = null
  let releaseV = NaN
  const start = 50
  const engine = createEngine(start, {
    count: 200, itemSize: SIZE, visibleCount: 5, preset: 'ios',
    onRender: (x, v) => frames.push({ x, v, t: performance.now() }),
    onSettle: (i) => (settled = i),
    onMode: (m) => { if ((m === 'coast' || m === 'spring') && Number.isNaN(releaseV)) releaseV = engine.v },
  })
  const detach = engine.attach(el)
  for (const s of g.samples) {
    if (s.type === 'down') el.dispatchEvent(pointer('pointerdown', s, g.pointerType))
    else window.dispatchEvent(pointer(s.type === 'move' ? 'pointermove' : s.type === 'up' ? 'pointerup' : 'pointercancel', s, g.pointerType))
  }
  const releasedAt = frames.length
  for (let i = 0; i < 600 && settled === null; i++) vi.advanceTimersByTime(1000 / 120)
  detach()
  el.remove()
  const ys = g.samples.map((s) => s.y)
  const travel = Math.max(...ys) - Math.min(...ys)
  return { settled, frames, releasedAt, travel, start, engine }
}

/** Finger velocity over the last `ms` before release, in wheel space (px/ms; finger up = wheel forward). */
function tailVelocity(g: Gesture, ms: number) {
  const up = g.samples.at(-1)!
  const recent = g.samples.filter((s) => s.type === 'move' && up.t - s.t <= ms)
  if (recent.length < 2) return 0
  return -(recent.at(-1)!.y - recent[0]!.y) / (recent.at(-1)!.t - recent[0]!.t)
}

describe('gesture replay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
  })
  afterEach(() => vi.useRealTimers())

  it('has fixtures', () => expect(gestures.length).toBeGreaterThan(0))

  for (const g of gestures) {
    describe(`${g.file} · ${g.source} · ${g.label} · ${g.device.hz}Hz`, () => {
      it('settles exactly on a row, with no jumps after release', () => {
        const r = replay(g)
        if (r.travel < 5) return expect(r.settled).toBeNull() // a click: nothing under the pointer here
        expect(r.settled).not.toBeNull()
        const last = r.frames.at(-1)!
        expect(last.x).toBe(r.settled! * SIZE)
        for (let i = r.releasedAt + 1; i < r.frames.length; i++) {
          const a = r.frames[i - 1]!, b = r.frames[i]!
          expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(Math.max(Math.abs(a.v), Math.abs(b.v)) * Math.max(b.t - a.t, 1) * 1.1 + 1)
        }
      })

      if (g.label === 'micro-drag' || g.label === 'tap') {
        it('under the drag threshold: does not move the wheel', () => {
          const r = replay(g)
          expect(r.travel).toBeLessThan(5)
          expect(r.settled ?? r.start).toBe(r.start)
        })
      }
      if (g.label === 'hesitant-release') {
        it('finger stopped before lifting: no coast, rests on the row under the finger', () => {
          const r = replay(g)
          const dragged = Math.round(-(g.samples.at(-1)!.y - g.samples[0]!.y) / SIZE)
          expect(Math.abs(r.settled! - (r.start + dragged))).toBeLessThanOrEqual(1)
        })
      }
      if (g.label === 'reversal') {
        it('follows the final direction, not the earlier one', () => {
          const r = replay(g)
          const dragged = -(g.samples.at(-1)!.y - g.samples[0]!.y) / SIZE
          const dir = Math.sign(tailVelocity(g, 40))
          expect(Math.sign(r.settled! - (r.start + dragged))).toBe(dir)
        })
      }
      if (g.label === 'flick' || g.label === 'hard-flick') {
        it('coasts beyond the release point in the direction of the throw', () => {
          const r = replay(g)
          const dragged = -(g.samples.at(-1)!.y - g.samples[0]!.y) / SIZE
          const dir = Math.sign(tailVelocity(g, 60))
          expect((r.settled! - (r.start + dragged)) * dir).toBeGreaterThan(1)
        })
      }
    })
  }
})
