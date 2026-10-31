import { useEffect, useRef, type CSSProperties } from 'react'
import { mod } from '../physics/snap'
import type { DetentApi, DetentFrame, Key } from './useDetent'

export type IndicatorShape = 'rounded' | 'pill' | 'lines' | 'underline' | 'brackets' | 'dot' | 'needle' | 'none'
export type IndicatorMaterial = 'solid' | 'glass' | 'outline' | 'gradient-border'

export interface IndicatorOptions<T> {
  /** Default 'rounded'. 'lines' = iOS hairlines; 'needle' = a line through the center (rulers). */
  shape?: IndicatorShape
  /** Default 'solid'. 'glass' = backdrop blur, hairline border, inner highlight. */
  material?: IndicatorMaterial
  /** 'band' (default): spans the wheel. 'content': follows the centered item's size, morphing between items. */
  fit?: 'band' | 'content'
  /** With fit 'content': also follow the item's height (width only by default). */
  fitHeight?: boolean
  /** Space around the content with fit 'content'. Defaults 14 and 6. */
  paddingX?: number
  paddingY?: number
  minWidth?: number
  maxWidth?: number
  radius?: number
  /** Accent (lines, outline, underline, brackets, dot, needle, gradient border, tint). A function cross-fades per item. */
  color?: string | ((item: T) => string)
  background?: string
  border?: string
  /** true = lifted, 'inset' = pressed, or any box-shadow. */
  shadow?: boolean | 'inset' | string
  /** Gap from the wheel's sides with fit 'band'. Default 6. */
  inset?: number
  /** 0–1: let the size overshoot with the settle spring. Default 0 (lands exactly). */
  overshoot?: number
  /**
   * Rows before the target where the indicator starts catching the incoming item (throws, keys and
   * programmatic moves). Before that it holds steady. Default 1.5.
   */
  catchRows?: number
  /**
   * 'smart' (default): speed-aware smoothing, holds while rows pass, catches the target. 'naive': recompute the
   * width every frame from the two rows around the center (flickers on fast spins; useful to compare).
   */
  morph?: 'smart' | 'naive'
}

export interface IndicatorState<T> {
  width: number
  height: number
  progress: number
  velocity: number
  item: T | undefined
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const mix = (a: string, b: string, t: number) => (t <= 0 ? a : t >= 1 ? b : `color-mix(in oklab, ${a}, ${b} ${(t * 100).toFixed(1)}%)`)

interface Config<T> {
  opts: IndicatorOptions<T>
  items: readonly T[]
  keyOf: (item: T, index: number) => Key
  loop: boolean
  vertical: boolean
  /** Along-axis band size (the item size), px. */
  item: number
  /** Row pitch (item + gap), px: converts engine px to rows. */
  pitch: number
}

/**
 * Drives the indicator from engine frames: size (fit content) and color, written as CSS variables on
 * the root. No React renders, no layout reads in the frame loop: content sizes come from ResizeObserver.
 */
export function useIndicator<T>(d: DetentApi<T>, root: { current: HTMLElement | null }, track: { current: HTMLElement | null }, cfg: Config<T>) {
  const conf = useRef(cfg)
  conf.current = cfg
  const sizes = useRef(new Map<Key, { w: number; h: number }>())
  const s = useRef({ w: NaN, h: NaN, cp: NaN, wFrom: NaN, hFrom: NaN, cFrom: '', motion: NaN, held: 0, t: 0, rem0: NaN })

  const apply = (f: DetentFrame) => {
    const { opts: o, items, keyOf, loop, vertical, item } = conf.current
    const el = root.current
    const n = items.length
    if (!el || !n) return
    const st = s.current
    const idx = (j: number) => (loop ? mod(j, n) : clamp(j, 0, n - 1))
    const at = (j: number) => items[idx(j)] as T
    const content = o.fit === 'content'
    const px = o.paddingX ?? 14
    const py = o.paddingY ?? 6
    const size = (j: number) => {
      const m = content ? sizes.current.get(keyOf(at(j), idx(j))) : undefined
      if (!m) return null
      const w = clamp(m.w + 2 * px, o.minWidth ?? 0, o.maxWidth ?? Infinity)
      return { w, h: o.fitHeight ? m.h + 2 * py : vertical ? item : NaN }
    }
    const colorFn = typeof o.color === 'function' ? o.color : null
    const colorAt = (j: number) => colorFn!(at(j))
    const now = performance.now()
    const dt = st.t ? Math.min(64, now - st.t) : 16
    st.t = now
    const fallback = { w: isNaN(st.w) ? 0 : st.w, h: isNaN(st.h) ? NaN : st.h }
    let w = st.w
    let h = st.h
    let color: string | undefined
    let progress = 1

    /** Hold steady while rows pass: live width between the two rows around the center, low-passed with a
     * time constant that grows with speed (holding the widest passing item when fast): it never flickers. */
    const follow = () => {
      const i = Math.floor(f.offset)
      const fr = f.offset - i
      const a = size(i) ?? fallback
      const b = size(i + 1) ?? fallback
      const speed = Math.abs(f.velocity)
      const k = 1 - Math.exp(-dt / (25 + 220 * Math.min(1, speed / 1.5)))
      const liveW = lerp(a.w, b.w, fr)
      const goal = speed > 0.8 ? Math.max(st.held, liveW) : liveW
      st.held = goal
      w = isNaN(w) ? liveW : w + (goal - w) * k
      if (!isNaN(a.h) && !isNaN(b.h)) h = isNaN(h) ? lerp(a.h, b.h, fr) : h + (lerp(a.h, b.h, fr) - h) * k
      st.cp = isNaN(st.cp) ? f.offset : st.cp + (f.offset - st.cp) * k
      if (colorFn) {
        const ci = Math.floor(st.cp)
        color = mix(colorAt(ci), colorAt(ci + 1), st.cp - ci)
      }
    }

    if (o.morph === 'naive' && f.mode !== 'idle') {
      // The straightforward version: whatever pair of rows is around the center, every frame.
      const i = Math.floor(f.offset)
      const fr = f.offset - i
      const a = size(i) ?? fallback
      const b = size(i + 1) ?? fallback
      w = lerp(a.w, b.w, fr)
      if (!isNaN(a.h) && !isNaN(b.h)) h = lerp(a.h, b.h, fr)
      if (colorFn) color = mix(colorAt(i), colorAt(i + 1), fr)
      st.motion = NaN
    } else if (f.mode === 'coast' || f.mode === 'spring') {
      // A throw, a key, a programmatic move. The indicator holds steady while other rows cross the center,
      // then catches the target item over the last `catchRows` (single-row moves: over the whole move), so it
      // arrives with the item, not before it.
      if (f.target !== st.motion) {
        st.motion = f.target
        st.rem0 = NaN
      }
      const span = f.target - f.from
      const dirn = Math.sign(span) || 1
      const rem = (f.target - f.offset) * dirn // rows still to go (negative once past the target)
      const catchWin = Math.abs(span) <= 1 ? Math.abs(span) : o.catchRows ?? 1.5
      if (isNaN(st.rem0) && rem <= catchWin) {
        // Entering the catch window: start from wherever the indicator is now.
        st.rem0 = Math.max(rem, 1e-6)
        st.wFrom = w
        st.hFrom = h
        if (colorFn) st.cFrom = color ?? colorAt(Math.round(isNaN(st.cp) ? f.offset : st.cp))
      }
      if (isNaN(st.rem0)) follow()
      else {
        progress = 1 - rem / st.rem0
        const p = progress <= 1 ? Math.max(0, progress) : 1 + (progress - 1) * (o.overshoot ?? 0)
        const t = size(f.target) ?? fallback
        if (!isNaN(st.wFrom)) w = lerp(st.wFrom, t.w, p)
        if (!isNaN(st.hFrom) && !isNaN(t.h)) h = lerp(st.hFrom, t.h, p)
        if (colorFn) color = mix(st.cFrom || colorAt(f.target), colorAt(f.target), clamp(p, 0, 1))
        st.cp = f.offset
        st.held = w
      }
    } else if (f.mode === 'idle') {
      st.motion = NaN
      const j = Math.round(f.offset)
      const t = size(j)
      const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
      if (t) (w = Math.round(t.w * dpr) / dpr), (h = isNaN(t.h) ? h : Math.round(t.h * dpr) / dpr)
      if (colorFn) color = colorAt(j)
      st.cp = f.offset
      st.held = w
    } else {
      st.motion = NaN
      follow()
    }

    st.w = w
    st.h = h
    const css = el.style
    if (content && !isNaN(w) && w > 0) css.setProperty('--indicator-w', `${w}px`)
    if (content && o.fitHeight && !isNaN(h)) css.setProperty('--indicator-h', `${h}px`)
    if (color) css.setProperty('--indicator-color', color)
    css.setProperty('--indicator-progress', String(Math.round(clamp(progress, 0, 2) * 1e3) / 1e3))
    css.setProperty('--indicator-velocity', String(Math.round(f.velocity * 1e3) / 1e3))
  }

  const now = (): DetentFrame => ({ offset: d.engine.x / (conf.current.pitch || 1), velocity: d.engine.v, mode: d.engine.mode, target: d.engine.target, from: d.engine.from })
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => d.subscribe((f) => applyRef.current(f)), []) // eslint-disable-line react-hooks/exhaustive-deps
  // Options can change while the wheel rests (no frames): bring the variables up to date after every render.
  useEffect(() => applyRef.current(now()))

  // Measure item content once per size change (not per frame), cached by key.
  const ro = useRef<ResizeObserver | null>(null)
  const seen = useRef(new WeakSet<Element>())
  useEffect(() => {
    if (conf.current.opts.fit !== 'content' || typeof ResizeObserver === 'undefined') return
    const measure = (el: Element, w: number, h: number) => {
      const row = el.parentElement
      if (!el.isConnected || !row || !w) return ro.current?.unobserve(el) // removed rows report 0×0
      const i = Number(row.dataset.detentItem)
      const { items, keyOf } = conf.current
      if (i === i && items[i] !== undefined) sizes.current.set(keyOf(items[i] as T, i), { w, h })
    }
    ro.current = new ResizeObserver((entries) => {
      for (const e of entries) {
        const b = e.borderBoxSize?.[0]
        measure(e.target, b ? b.inlineSize : e.contentRect.width, b ? b.blockSize : e.contentRect.height)
      }
      applyRef.current(now())
    })
    // Fonts change text metrics: measure again once they are in.
    document.fonts?.ready.then(() => {
      track.current?.querySelectorAll<HTMLElement>('[data-detent-content]').forEach((el) => measure(el, el.offsetWidth, el.offsetHeight))
      applyRef.current(now())
    })
    return () => ro.current?.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // New rows (virtualization) get observed as they mount.
  useEffect(() => {
    const r = ro.current
    if (!r || !track.current) return
    for (const el of track.current.querySelectorAll('[data-detent-content]'))
      if (!seen.current.has(el)) seen.current.add(el), r.observe(el)
  })

  return { state: s, apply: () => applyRef.current(now()) }
}

/** Static styles for the indicator box (shape × material); sizes come from --indicator-w / --indicator-h. */
export function indicatorStyle<T>(o: IndicatorOptions<T>, vertical: boolean): CSSProperties {
  const shape = o.shape ?? 'rounded'
  const material = o.material ?? 'solid'
  // The fallback matters: until the first frame writes it, an undefined var() would void the whole background.
  const accent = typeof o.color === 'function' ? 'var(--indicator-color, var(--detent-fg))' : o.color ?? 'var(--detent-fg)'
  const hair = 'var(--detent-line)'
  const box = (shape === 'rounded' || shape === 'pill') && material !== 'outline' && material !== 'gradient-border'
  const shadows: string[] = []
  const st: CSSProperties = { borderRadius: shape === 'pill' ? 999 : shape === 'rounded' ? o.radius ?? 10 : 0 }

  if (shape === 'lines') shadows.push(vertical ? `inset 0 1px ${hair}, inset 0 -1px ${hair}` : `inset 1px 0 ${hair}, inset -1px 0 ${hair}`)
  else if (shape === 'underline') shadows.push(`inset 0 -2px ${accent}`)
  else if (shape === 'brackets') {
    const g = `linear-gradient(${accent},${accent})`
    Object.assign(st, {
      backgroundImage: Array(8).fill(g).join(','),
      backgroundRepeat: 'no-repeat',
      backgroundSize: '10px 1.5px,1.5px 10px,10px 1.5px,1.5px 10px,10px 1.5px,1.5px 10px,10px 1.5px,1.5px 10px',
      backgroundPosition: 'left top,left top,right top,right top,left bottom,left bottom,right bottom,right bottom',
    })
  } else if (shape === 'dot')
    Object.assign(st, { background: `radial-gradient(circle, ${accent} 3px, transparent 3.5px) no-repeat 2px 50% / 8px 8px` })
  else if (shape === 'needle')
    Object.assign(st, { background: `linear-gradient(${accent},${accent}) no-repeat center / ${vertical ? '100% 2px' : '2px 100%'}` })

  if (shape === 'rounded' || shape === 'pill') {
    if (material === 'solid') {
      st.background = o.background ?? (typeof o.color === 'function' ? 'color-mix(in oklab, var(--indicator-color, var(--detent-fg)) 14%, transparent)' : 'var(--detent-band)')
      shadows.push(`inset 0 0 0 1px ${hair}`)
    } else if (material === 'glass') {
      Object.assign(st, {
        background: o.background ?? 'color-mix(in oklab, var(--detent-fg) 5%, transparent)',
        backdropFilter: 'blur(14px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.6)',
      })
      shadows.push('inset 0 0 0 1px color-mix(in oklab, var(--detent-fg) 12%, transparent)', 'inset 0 1px 0 rgb(255 255 255 / .4)', '0 8px 24px -12px rgb(0 0 0 / .28)')
    } else if (material === 'outline') shadows.push(`inset 0 0 0 1.5px ${accent}`)
    else {
      const inner = o.background ?? 'Canvas'
      Object.assign(st, {
        border: '1.5px solid transparent',
        background: `linear-gradient(${inner},${inner}) padding-box, linear-gradient(135deg, ${accent}, color-mix(in oklab, ${accent} 35%, transparent)) border-box`,
      })
    }
  }
  if (o.shadow && box) shadows.push(o.shadow === true ? '0 6px 16px -6px rgb(0 0 0/.18), 0 1px 2px rgb(0 0 0/.06)' : o.shadow === 'inset' ? 'inset 0 1px 3px rgb(0 0 0/.14)' : o.shadow)
  if (shadows.length) st.boxShadow = shadows.join(',')
  if (o.border) st.border = o.border
  return st
}
