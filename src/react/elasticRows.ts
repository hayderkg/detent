import { useEffect, useLayoutEffect, useRef } from 'react'
import type { DetentApi } from './useDetent'

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect
type Layer = { current: HTMLElement | null }
interface Config { amount: number; pitch: number; vertical: boolean; rtl: boolean }

/** Small independent springs on the rendered rows. The engine, layout and selected position stay unchanged. */
export function useElasticRows<T>(d: DetentApi<T>, layers: Layer[], config: Config) {
  const cfg = useRef(config)
  useIso(() => { cfg.current = config })
  useEffect(() => {
    if (!config.amount) return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const springs = new Map<number, { x: number; v: number }>()
    let speed = 0
    let raf = 0
    let last = 0
    let updated = 0
    const nodes = () => layers.flatMap((layer) => Array.from(layer.current?.children ?? []) as HTMLElement[])
    const index = (el: HTMLElement) => Number(el.dataset.detentIndex ?? el.dataset.detentSlot ?? el.dataset.detentMirror)
    const reset = () => {
      cancelAnimationFrame(raf)
      raf = 0
      speed = 0
      springs.clear()
      for (const el of nodes()) el.style.removeProperty('--detent-row-lag')
    }
    const frame = (now: number) => {
      raf = 0
      if (mq.matches) return reset()
      const { amount, pitch, vertical, rtl } = cfg.current
      const dt = Math.max(0, Math.min(64, now - last))
      last = now
      if (now - updated > 50) speed = 0
      const center = d.engine.x / pitch
      const limit = Math.min(48, pitch * 0.7, Math.min(8, pitch * 0.15) * amount)
      // A saturating response makes slow, sustained input perceptible too; zero speed still has zero lag.
      const goal = Math.sign(speed) * -Math.expm1(-Math.abs(speed) / 0.45) * limit * (!vertical && rtl ? -1 : 1)
      const values = new Map<number, number>()
      let moving = false
      for (const el of nodes()) {
        const j = index(el)
        if (!Number.isFinite(j)) continue
        if (!values.has(j)) {
          const distance = Math.abs(j - center)
          // A protected center row: no elastic shift within half a row, at any speed.
          const weight = Math.min(1, Math.max(0, distance - 0.5))
          const s = springs.get(j) ?? { x: 0, v: 0 }
          const target = goal * weight
          const w = 0.022 + 0.012 / (1 + distance)
          const z = 0.75, wd = w * Math.sqrt(1 - z * z)
          const delta = s.x - target, b = (s.v + z * w * delta) / wd
          const decay = Math.exp(-z * w * dt), c = Math.cos(wd * dt), sin = Math.sin(wd * dt)
          const next = delta * c + b * sin
          s.x = Math.max(-limit * weight, Math.min(limit * weight, target + decay * next))
          s.v = weight ? decay * (wd * (b * c - delta * sin) - z * w * next) : 0
          if (!speed && Math.abs(s.x) < 0.01 && Math.abs(s.v) < 0.001) s.x = s.v = 0
          springs.set(j, s)
          values.set(j, s.x)
          moving ||= Math.abs(target - s.x) > 0.01 || Math.abs(s.v) > 0.001
        }
        el.style.setProperty('--detent-row-lag', String(Number(values.get(j)!.toFixed(3))))
      }
      for (const j of springs.keys()) if (!values.has(j)) springs.delete(j)
      if (moving) raf = requestAnimationFrame(frame)
    }
    const off = d.subscribe((f) => {
      if (mq.matches) return
      updated = performance.now()
      speed = f.mode === 'idle' || !Number.isFinite(f.velocity) ? 0 : f.velocity
      if (!raf && (speed || springs.size)) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    })
    const preference = () => { if (mq.matches) reset() }
    mq.addEventListener('change', preference)
    return () => { off(); mq.removeEventListener('change', preference); reset() }
  }, [!!config.amount]) // eslint-disable-line react-hooks/exhaustive-deps
}
