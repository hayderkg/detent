import { useEffect, useLayoutEffect, useRef } from 'react'
import type { DetentApi } from './useDetent'

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect
interface Config { amount: number; pitch: number; vertical: boolean; rtl: boolean; disabled: boolean }

/** A short visual catch, composed above the tracks. Pointer control and selection remain immediate. */
export function useGrip<T>(d: DetentApi<T>, root: { current: HTMLElement | null }, config: Config) {
  const cfg = useRef(config)
  useIso(() => { cfg.current = config })
  useEffect(() => {
    const el = root.current
    if (!config.amount || !el || config.disabled) return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0, start = 0, amplitude = 0
    const reset = () => {
      cancelAnimationFrame(raf)
      raf = 0
      el.style.removeProperty('--detent-grip-x')
      el.style.removeProperty('--detent-grip-y')
    }
    const frame = (now: number) => {
      raf = 0
      const t = Math.max(0, (now - start) / 180)
      if (t >= 1 || mq.matches) return reset()
      // A finite, smooth pulse: no jump at contact and an exact zero at the end.
      const shift = amplitude * (256 / 27) * t * (1 - t) ** 3
      el.style.setProperty(cfg.current.vertical ? '--detent-grip-y' : '--detent-grip-x', `${shift.toFixed(3)}px`)
      raf = requestAnimationFrame(frame)
    }
    const down = (e: PointerEvent) => {
      if (e.defaultPrevented || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || (e.target instanceof Element && e.target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable=false])'))) return
      const c = cfg.current
      const speed = d.engine.v
      if (mq.matches || c.disabled || d.engine.mode === 'idle' || d.engine.mode === 'drag' || !Number.isFinite(speed) || Math.abs(speed) < 0.05) return
      reset()
      amplitude = -Math.sign(speed) * Math.min(1, Math.abs(speed) / 2) * Math.min(12, c.pitch * 0.2) * c.amount * (!c.vertical && c.rtl ? -1 : 1)
      start = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const preference = () => { if (mq.matches) reset() }
    // Capture the velocity before the engine catches the wheel in its pointerdown listener.
    el.addEventListener('pointerdown', down, true)
    el.addEventListener('wheel', reset, { passive: true })
    el.addEventListener('keydown', reset)
    el.addEventListener('pointercancel', reset)
    mq.addEventListener('change', preference)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      el.removeEventListener('wheel', reset)
      el.removeEventListener('keydown', reset)
      el.removeEventListener('pointercancel', reset)
      mq.removeEventListener('change', preference)
      reset()
    }
  }, [!!config.amount, config.disabled, config.vertical, config.rtl]) // eslint-disable-line react-hooks/exhaustive-deps
}
