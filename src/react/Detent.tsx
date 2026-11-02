import { useEffect, useId, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { presets, type Physics, type PresetName } from '../presets'
import { useElasticRows } from './elasticRows'
import { useGrip } from './grip'
import { refractionMap, useRefraction } from './refraction'
import { indicatorStyle, useIndicator, type IndicatorOptions, type IndicatorState } from './indicator'
import { useDetent, type DetentOptions, type Key } from './useDetent'

/** A falloff by distance from the center: per-row amount, or a function of the signed offset (rows) returning the value. */
export type Falloff = number | ((offset: number) => number)
export type Easing = 'linear' | 'quad' | 'cubic' | ((distance: number) => number)

export interface GradientBlur {
  /** Blur at the very edge, px. Default 8. */
  strength?: number
  /** Stacked backdrop-filter layers; more = smoother ramp. Default 6. */
  layers?: number
  /** How far it reaches from each edge, px. Default: up to just short of the center row. */
  size?: number
}

export interface DetentProps<T> extends Omit<DetentOptions<T>, 'preset' | 'header' | 'footer' | 'loading'> {
  /** Render a row. `offset` is the distance from the center at render time (live: the --offset CSS variable). */
  renderItem?: (item: T, state: { index: number; selected: boolean; offset: number; progress: number }) => ReactNode

  // Layout
  /** Row size along the scroll axis, px (height when vertical, width when horizontal). Default 40. */
  itemHeight?: number
  /** Gap between rows, px. */
  gap?: number
  /** Cross size of a vertical wheel (default 100%). */
  width?: number | string
  /** Cross size of a horizontal wheel. Default 64. */
  height?: number | string
  /** A non-selectable row before the items (e.g. a search field) the wheel can rest on. */
  header?: ReactNode
  /** A non-selectable row after the items the wheel can rest on. */
  footer?: ReactNode
  /** Shown when `items` is empty. */
  emptyState?: ReactNode
  /** Row shown after the items while `loading` is true. Default: an ellipsis. */
  loadingRow?: ReactNode
  loading?: boolean

  // Drum
  /** Depth of the 3D drum, px. 0 = flat list. Default 800. */
  perspective?: number
  /** 0–1: how far rows rotate away from the center (0 flat, 1 a full half-cylinder). Default 0.5. */
  curvature?: number
  /** Drum radius, px. Derived from curvature by default; overrides it. */
  radius?: number
  /** Tilt the whole wheel, deg: a number rotates about the scroll axis' cross axis, or give { x, y }. */
  tilt?: number | { x?: number; y?: number }
  /** Rows lean sideways as they move away, deg per row. */
  skew?: number
  /** Alignment of row content across the wheel. Default 'center'. */
  align?: 'center' | 'start' | 'end'

  // Rows by distance from the center
  /** Opacity lost per row. Default 0.16. */
  fade?: Falloff
  /** Size lost per row (on top of the drum's own perspective). Default 0. */
  scale?: Falloff
  /** Depth-of-field blur per row, px. Default 0. */
  blur?: Falloff
  /** Velocity-driven blur along the scroll axis. true = 4px maximum; a number sets the maximum (0–24px). Off by default; disabled with reduced motion. */
  motionBlur?: boolean | number
  /** Rows lean with velocity. true = 2deg maximum, or a maximum angle (0–6deg). Off by default. */
  velocityTilt?: boolean | number
  /** Illumination as rows cross the center. true = 0.12, or intensity 0–0.5. */
  centerLight?: boolean | number
  /** Apparent Z depth in px: center forward, neighbors back. true = 8, or 0–24px. */
  selectedDepth?: boolean | number
  /** Independent elastic lag of outer rows. true = 0.3, or intensity 0–6. The center stays precise. */
  elasticRows?: boolean | number
  /** Brief visual absorption when catching a moving wheel. true = 0.5, or intensity 0–2. Disabled with reduced motion. */
  grip?: boolean | number
  /** Color falloff toward --detent-dim-color, per row (keeps backgrounds solid, unlike fade). Default 0.22. */
  dim?: Falloff
  /** Extra gap that grows with distance, px. Default 0. */
  spacing?: Falloff
  /** Curve applied to the distance before the falloffs. Default 'linear'. */
  easing?: Easing

  // Selection indicator
  /**
   * The selection marker: shape, material, style, and fit. `fit: 'content'` makes it follow the centered
   * item's size, morphing between items as they pass and straight to the target on a throw.
   */
  indicator?: IndicatorOptions<T>
  /** Your own indicator content; live values are also CSS variables (--indicator-w, -h, -progress, -velocity, -color). */
  renderIndicator?: (state: IndicatorState<T>) => ReactNode
  /** The band behind the center row, or your own element. Default true. (Shorthand: `indicator.shape: 'none'` turns it off.) */
  highlight?: boolean | ReactNode
  /** 'rounded' (default), 'pill', 'lines' (iOS hairlines above and below), or your own styles. */
  highlightStyle?: 'rounded' | 'pill' | 'lines' | CSSProperties
  /** Shadow on the band: true for a lifted look, or any box-shadow. */
  highlightShadow?: boolean | string
  /**
   * iOS lens: the center row renders larger inside the band only. true = 1.1. Default true.
   * The lens is a second, inert copy of the rows: `renderItem` runs twice per visible row. With rows that have
   * effects, ids or heavy content, turn it off (`magnify={false}` and no `indicator.refraction`).
   * Refraction uses the same second copy even with magnify off.
   */
  magnify?: boolean | number
  selectedStyle?: CSSProperties
  selectedClassName?: string

  // Depth and surface
  /** Inner shadows at the edges (recessed drum): true, or any CSS background for the overlay. */
  shadow?: boolean | string
  /** Edge fade: 'gradient' (default), 'none', or a custom CSS mask-image. */
  mask?: 'gradient' | 'none' | (string & {})
  /** How far the edge fade reaches (px or CSS length). Default '28%'. */
  maskSize?: number | string
  /** Progressive blur toward the edges, Apple-style. Default off. */
  gradientBlur?: boolean | GradientBlur
  /** A subtle light streak across the center (glossy drum). */
  glare?: boolean
  /** The drum's surface. */
  background?: string

  // Motion and feedback
  /**
   * A tuned bundle: 'ios' | 'scroll' | 'snappy' | 'heavy' | 'elastic' | 'linear', or your own physics.
   * Sound and haptics are opt-in so they cost nothing unless used:
   * `onTick={ticks({ haptics: true, sound: true })}` from 'detent/feedback'.
   */
  preset?: PresetName | Physics

  // Escape hatch
  /** Any per-row style from the live offset, applied every frame. */
  rowStyle?: (offset: number, index: number, selected: boolean) => CSSProperties
  /** Force a color scheme (otherwise follows prefers-color-scheme or an ancestor's data-theme). */
  theme?: 'light' | 'dark'
  className?: string
  style?: CSSProperties

  // Forms and CSP
  /** Submit the selection with a form: a hidden input named `name` holds the selected item's key. */
  name?: string
  /** The id of the form the hidden input belongs to, when the wheel sits outside it. */
  form?: string
  /** Nonce for the component's <style> element, under a strict Content Security Policy. */
  nonce?: string
}

const light = '--detent-fg:#0a0a0a;--detent-dim-color:#b4b4b4;--detent-band:rgb(0 0 0/.05);--detent-line:rgb(0 0 0/.16);--detent-ring:rgb(0 0 0/.45);--detent-shade:rgb(0 0 0/.07);--detent-glare:rgb(255 255 255/.55)'
const dark = '--detent-fg:#ededed;--detent-dim-color:#5a5a5a;--detent-band:rgb(255 255 255/.07);--detent-line:rgb(255 255 255/.16);--detent-ring:rgb(255 255 255/.4);--detent-shade:rgb(0 0 0/.35);--detent-glare:rgb(255 255 255/.08)'
const U = '[data-detent-ui]'
/** Built on first use: a module-level template literal with interpolations is not tree-shakeable. */
let css: string | undefined
const CSS = () => (css ??= `${U}{${light};color:var(--detent-fg);font-variant-numeric:tabular-nums;font-size:var(--detent-font-size,20px);cursor:grab;outline:none}
@media (prefers-color-scheme:dark){${U}:not([data-theme=light]):not([data-theme=light] *){${dark}}}
[data-theme=dark] ${U},${U}[data-theme=dark]{${dark}}
${U}[data-dragging]{cursor:grabbing}
${U}:focus-visible{outline:none}
${U} [data-ring]{transition:outline-color .15s,outline-offset .15s;outline:1.5px solid transparent;outline-offset:6px}
${U}:focus-visible [data-ring]{outline-color:var(--detent-ring);outline-offset:3px}
${U}:focus-visible:not(:has([data-ring])){border-radius:14px;box-shadow:0 0 0 1.5px var(--detent-ring),0 0 0 5px var(--detent-band)}
${U} [data-detent-row]{display:flex;align-items:center;backface-visibility:hidden;white-space:nowrap}
${U} [data-detent-layer]{position:absolute;inset:0;pointer-events:none}
${U} [data-detent-layer] [data-detent-row]{pointer-events:auto}
${U} img{-webkit-user-drag:none;user-select:none}`)

const EASE = {
  linear: 'var(--abs-offset)',
  quad: 'calc(var(--abs-offset) * var(--abs-offset))',
  cubic: 'calc(var(--abs-offset) * var(--abs-offset) * var(--abs-offset))',
}
/** Per-row result variables and the CSS formula used when the prop is a number. */
const FALLOFF = {
  fade: ['--o', 'clamp(0, calc(1 - var(--e) * var(--detent-fade)), 1)'],
  scale: ['--s', 'max(0, calc(1 - var(--e) * var(--detent-scale)))'],
  blur: ['--b', 'calc(var(--e) * var(--detent-blur))'],
  dim: ['--d', 'min(1, calc(var(--e) * var(--detent-dim)))'],
  spacing: ['--x', 'calc(var(--offset) * var(--e) * var(--detent-spacing))'],
} as const
type FalloffName = keyof typeof FALLOFF

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const px = (v: number | string) => (typeof v === 'number' ? `${v}px` : v)

export function Detent<T>(props: DetentProps<T>) {
  const {
    renderItem,
    itemHeight,
    itemSize,
    gap = 0,
    width,
    height = 64,
    header,
    footer,
    emptyState,
    loadingRow = '…',
    loading,
    perspective = 800,
    curvature = 0.5,
    radius,
    tilt,
    skew = 0,
    align = 'center',
    fade = 0.16,
    scale = 0,
    blur = 0,
    motionBlur = false,
    velocityTilt = false,
    centerLight = false,
    selectedDepth = false,
    elasticRows = false,
    grip = false,
    dim = 0.22,
    spacing = 0,
    easing = 'linear',
    highlight = true,
    highlightStyle = 'rounded',
    highlightShadow,
    indicator,
    renderIndicator,
    magnify = true,
    selectedStyle,
    selectedClassName,
    shadow,
    mask = 'gradient',
    maskSize = '28%',
    gradientBlur,
    glare,
    background,
    preset,
    rowStyle,
    theme,
    className,
    style,
    name,
    form,
    nonce,
    visibleCount = 7,
    orientation = 'vertical',
    ...options
  } = props

  const motionMax = motionBlur === true ? 4 : typeof motionBlur === 'number' && Number.isFinite(motionBlur) ? Math.max(0, Math.min(24, motionBlur)) : 0

  const tiltMax = velocityTilt === true ? 2 : typeof velocityTilt === 'number' && Number.isFinite(velocityTilt) ? Math.max(0, Math.min(6, velocityTilt)) : 0

  const lightMax = centerLight === true ? 0.12 : typeof centerLight === 'number' && Number.isFinite(centerLight) ? Math.max(0, Math.min(0.5, centerLight)) : 0
  const depthMax = selectedDepth === true ? 8 : typeof selectedDepth === 'number' && Number.isFinite(selectedDepth) ? Math.max(0, Math.min(24, selectedDepth)) : 0
  const elasticAmount = elasticRows === true ? 0.3 : typeof elasticRows === 'number' && Number.isFinite(elasticRows) ? Math.max(0, Math.min(6, elasticRows)) : 0
  const gripAmount = grip === true ? 0.5 : typeof grip === 'number' && Number.isFinite(grip) ? Math.max(0, Math.min(2, grip)) : 0
  // Apparent depth as the scale a translateZ would give under an 800px perspective: perspective(800px)
  // translateZ(z) ≡ scale(800 / (800 − z)) on a flat row. A second perspective() in a row's transform chain (the drum
  // has its own) is drawn slanted by WebKit.
  const depthTransform = depthMax ? 'scale(calc(800 / (800 - var(--detent-depth, 0) * (1 - 2 * min(1, var(--abs-offset)))))) ' : ''
  const lightFilter = lightMax ? 'brightness(calc(1 + var(--detent-center-light, 0) * max(0, 1 - var(--abs-offset))))' : ''

  const item = itemHeight ?? itemSize ?? 40
  const pitch = Math.max(1, item + gap) || 40
  const vertical = orientation !== 'horizontal'
  const elasticTranslate = vertical ? '0 calc(var(--detent-row-lag, 0) * 1px)' : 'calc(var(--detent-row-lag, 0) * 1px) 0'
  const d = useDetent<T>({
    ...options,
    preset: typeof preset === 'string' ? presets[preset] : preset,
    itemSize: pitch,
    visibleCount,
    orientation,
    header: header != null,
    footer: footer != null,
    loading,
  })

  // Geometry. Rows sit on a cylinder of radius R, θ = offset·α per row, projected with perspective P.
  const P = perspective
  const half = (visibleCount - 1) / 2
  const alpha = radius ? 2 * Math.asin(Math.min(1, pitch / (2 * radius))) : (curvature * 1.3) / (half + 0.5)
  const drum = P > 0 && alpha > 1e-4
  const R = radius ?? pitch / (2 * Math.sin(alpha / 2))
  const base = half * pitch
  const extent = pitch * visibleCount
  const zoom = magnify === true ? 1.1 : magnify || 0
  const dir = d.rtl && !vertical ? -1 : 1

  // Indicator: the legacy band props map onto it; `indicator` wins where both are set.
  const ind: IndicatorOptions<T> = {
    shape: highlight === false ? 'none' : typeof highlightStyle === 'string' ? highlightStyle : 'rounded',
    shadow: highlightShadow,
    ...indicator,
  }
  const refractionAmount = ind.refraction === true ? 0.5 : typeof ind.refraction === 'number' && Number.isFinite(ind.refraction) ? Math.max(0, Math.min(4, ind.refraction)) : 0
  const refractionRGB = ind.refractionRGB === true ? 0.35 : typeof ind.refractionRGB === 'number' && Number.isFinite(ind.refractionRGB) ? Math.max(0, Math.min(1, ind.refractionRGB)) : 0
  const hasLens = zoom > 0 || refractionAmount > 0
  const fitContent = ind.fit === 'content'
  // The keyboard focus ring outlines the band when it is a box; a needle, lines or a dot would make an odd
  // outline, so then the ring goes around the whole wheel instead.
  const ring = !['lines', 'needle', 'underline', 'dot', 'brackets'].includes(ind.shape as string)
  const inset = ind.inset ?? (ind.shape === 'lines' || ind.shape === 'needle' || ind.shape === 'underline' ? 0 : 6)
  const rootEl = useRef<HTMLElement | null>(null)
  // Forms: the hidden field resets with its form, back to defaultValue (a controlled wheel is the parent's to reset).
  const field = useRef<HTMLInputElement>(null)
  const onReset = useRef(() => {})
  useIsoLayoutEffect(() => {
    onReset.current = () => {
      if (options.value !== undefined) return
      const k = options.defaultValue === undefined ? undefined : keyOf(options.defaultValue, -1)
      d.scrollTo(Math.max(0, k === undefined ? 0 : options.items.findIndex((it, j) => keyOf(it, j) === k)))
    }
  })
  useEffect(() => {
    const f = field.current?.form
    if (!f) return
    const reset = () => onReset.current()
    f.addEventListener('reset', reset)
    return () => f.removeEventListener('reset', reset)
  }, [name, form])
  const keyOf = (it: T, i: number): Key => (options.getKey ? options.getKey(it, i) : typeof it === 'string' || typeof it === 'number' ? it : i)
  const indicatorCtl = useIndicator(d, rootEl, { get current() { return track.current } }, {
    opts: ind,
    items: options.items,
    keyOf,
    loop: !!options.loop,
    vertical,
    item,
    pitch,
  })
  // Physical left edge of the indicator box (vertical wheels), accounting for align and RTL.
  const px0 = fitContent ? 16 - (ind.paddingX ?? 14) : inset
  const flip = d.rtl && vertical
  const crossStart =
    !vertical || align === 'center'
      ? 'calc(50% - var(--indicator-w) / 2)'
      : (align === 'start') !== flip
        ? `${px0}px`
        : `calc(100% - ${px0}px - var(--indicator-w))`

  // JS-driven per-frame values (only when a prop is a function).
  const fns = { fade, scale, blur, dim, spacing }
  const live = (Object.keys(fns) as FalloffName[]).filter((k) => typeof fns[k] === 'function')
  const easeFn = typeof easing === 'function' ? easing : undefined
  const perFrame = live.length > 0 || !!easeFn || !!rowStyle

  const rowCss = useMemo((): CSSProperties => {
    const A = vertical ? 'Y' : 'X'
    const v: Record<string, string> = { '--e': easeFn ? '0' : EASE[easing as keyof typeof EASE] }
    for (const k of Object.keys(FALLOFF) as FalloffName[]) v[FALLOFF[k][0]] = FALLOFF[k][1]
    const shift = drum
      ? 'calc((var(--detent-radius) * sin(calc(var(--t) * 1rad)) * var(--k) - var(--offset) * var(--detent-pitch) + var(--x)) * var(--detent-dir) * 1px)'
      : 'calc(var(--x) * var(--detent-dir) * 1px)'
    if (drum) {
      v['--t'] = 'calc(var(--offset) * var(--detent-angle))'
      v['--k'] = 'calc(var(--detent-perspective) / (var(--detent-perspective) + var(--detent-radius) * (1 - cos(calc(var(--t) * 1rad)))))'
      v['--v'] = 'clamp(0, calc(cos(calc(var(--t) * 1rad)) * 6), 1)' // rows past the side of the drum vanish
    }
    const rot = vertical ? 'rotateX(calc(var(--t) * -1rad))' : 'rotateY(calc(var(--t) * var(--detent-dir) * 1rad))'
    return {
      ...v,
      transform:
        depthTransform + `translate${A}(${shift}) scale(calc(${drum ? 'var(--k) * ' : ''}var(--s)))` +
        (drum ? ` perspective(calc(var(--detent-perspective) * 1px)) ${rot}` : '') +
        (skew ? ` skew${vertical ? 'X' : 'Y'}(calc(var(--offset) * var(--detent-skew) * 1deg))` : ''),
      ...(elasticAmount ? { translate: elasticTranslate } : {}),
      ...(tiltMax ? { rotate: 'var(--detent-velocity-tilt, 0deg)' } : {}),
      opacity: drum ? 'calc(var(--o) * var(--v))' : 'var(--o)',
      ...(blur || motionMax || lightMax ? { filter: [lightFilter, blur ? 'blur(calc(var(--b) * 1px))' : '', motionMax ? 'var(--detent-motion-filter, blur(0px))' : ''].filter(Boolean).join(' ') } : {}),
      ...(dim ? { color: 'color-mix(in oklab, var(--detent-fg), var(--detent-dim-color) calc(var(--d) * 100%))' } : {}),
      justifyContent: align === 'center' ? 'center' : align === 'start' ? 'flex-start' : 'flex-end',
      paddingInline: align === 'center' ? 0 : 16,
    } as CSSProperties
  }, [vertical, drum, easing, easeFn, skew, blur, dim, align, motionMax, tiltMax, lightMax, depthMax, elasticAmount])

  /** Values for function props (and custom easing) at `off`, as CSS variables. */
  const liveVars = (off: number): [string, string][] => {
    const out: [string, string][] = []
    // Junk from user functions (NaN, Infinity) falls back to the neutral value instead of reaching the DOM.
    const safe = (v: number, neutral: number) => String(Number.isFinite(v) ? v : neutral)
    if (easeFn) out.push(['--e', safe(easeFn(Math.abs(off)), Math.abs(off))])
    for (const k of live) out.push([FALLOFF[k][0], safe((fns[k] as (o: number) => number)(off), k === 'fade' || k === 'scale' ? 1 : 0)])
    return out
  }

  const refractionId = `detent-refraction-${useId().replace(/:/g, '')}`
  const refractionImage = useRef<SVGFEImageElement>(null)
  const displacement = useRef<SVGFEDisplacementMapElement>(null)
  const redOffset = useRef<SVGFEOffsetElement>(null)
  const blueOffset = useRef<SVGFEOffsetElement>(null)
  const refractionSource = useMemo(() => refractionAmount ? refractionMap(vertical, !!ind.refractionInverse) : undefined, [vertical, !!refractionAmount, !!ind.refractionInverse])
  const motionId = `detent-motion-${useId().replace(/:/g, '')}`
  const motionFilter = useRef<SVGFEGaussianBlurElement>(null)
  const reducedMotion = useRef(true)

  // Layers that mirror the main track (slots, lens) and per-frame JS (function props, rowStyle).
  const track = useRef<HTMLElement | null>(null)
  const slots = useRef<HTMLDivElement>(null)
  const lens = useRef<HTMLDivElement>(null)
  useGrip(d, rootEl, { amount: gripAmount, pitch, vertical, rtl: d.rtl, disabled: !!options.disabled })
  useRefraction(d, rootEl, refractionImage, displacement, { id: refractionId, amount: refractionAmount, rgb: refractionRGB, inverse: !!ind.refractionInverse, vertical, item, extent, band: () => fitContent ? (vertical ? indicatorCtl.state.current.h : indicatorCtl.state.current.w) : item }, [redOffset, blueOffset])
  useElasticRows(d, [track, slots, lens], { amount: elasticAmount, pitch, vertical, rtl: d.rtl })
  // Read by the frame loop: updated at commit, so a render React discards never reaches the screen.
  const latest = useRef({ liveVars, rowStyle, perFrame, motionMax, tiltMax, lightMax, depthMax, vertical, rtl: d.rtl })
  /** Bring the mirror layers and JS-driven row values in line with the main track at `offset` (rows). */
  const sync = (offset: number, velocity = 0) => {
    const cfg = latest.current
    if (cfg.tiltMax || rootEl.current?.style.getPropertyValue('--detent-velocity-tilt')) {
      const angle = reducedMotion.current ? 0 : Math.max(-1, Math.min(1, velocity / 3)) * cfg.tiltMax * (cfg.vertical || cfg.rtl ? -1 : 1)
      rootEl.current?.style.setProperty('--detent-velocity-tilt', `${Math.abs(angle) < 0.01 ? 0 : Number(angle.toFixed(3))}deg`)
    }
    if (cfg.lightMax || rootEl.current?.style.getPropertyValue('--detent-center-light')) rootEl.current?.style.setProperty('--detent-center-light', String(reducedMotion.current ? 0 : cfg.lightMax))
    if (cfg.depthMax || rootEl.current?.style.getPropertyValue('--detent-depth')) rootEl.current?.style.setProperty('--detent-depth', String(reducedMotion.current ? 0 : cfg.depthMax))
    const amount = reducedMotion.current ? 0 : Math.min(cfg.motionMax, Math.abs(velocity) * 1.5)
    const active = amount >= 0.1 && !!motionFilter.current
    if (motionFilter.current) {
      const deviation = active ? Number(amount.toFixed(2)) : 0
      motionFilter.current.setAttribute('stdDeviation', cfg.vertical ? `0 ${deviation}` : `${deviation} 0`)
    }
    if (cfg.motionMax || rootEl.current?.style.getPropertyValue('--detent-motion-filter')) {
      rootEl.current?.style.setProperty('--detent-motion-filter', active ? `url(#${motionId})` : 'blur(0px)')
    }
    const t = track.current?.style.transform
    for (const m of [slots.current, lens.current]) {
      if (!m || !t) continue
      m.style.transform = t
      if (m === slots.current || cfg.lightMax || cfg.depthMax)
        for (const el of m.children as unknown as HTMLElement[]) {
          const off = Number(el.dataset.detentSlot ?? el.dataset.detentMirror) - offset
          el.style.setProperty('--offset', String(off))
          el.style.setProperty('--abs-offset', String(Math.abs(off)))
        }
    }
    const { liveVars, rowStyle, perFrame } = latest.current
    if (!perFrame || !track.current) return
    for (const el of track.current.children as unknown as HTMLElement[]) {
      const j = el.dataset.detentIndex
      if (!j) continue
      const off = +j - offset
      for (const [k, v] of liveVars(off)) el.style.setProperty(k, v)
      if (rowStyle) Object.assign(el.style, rowStyle(off, Number(el.dataset.detentItem), Math.abs(off) < 0.5))
    }
  }
  const syncRef = useRef(sync)
  useEffect(() => d.subscribe((f) => syncRef.current(f.offset, f.mode === 'idle' ? 0 : f.velocity)), []) // eslint-disable-line react-hooks/exhaustive-deps
  // Every render too (layout phase, before paint): the engine may have moved the track while mirrors
  // were not subscribed yet (mount, RTL detected after hydration), and re-renders reset inline styles.
  useIsoLayoutEffect(() => {
    latest.current = { liveVars, rowStyle, perFrame, motionMax, tiltMax, lightMax, depthMax, vertical, rtl: d.rtl }
    syncRef.current = sync
    sync(d.engine.x / pitch, d.engine.v)
  })

  useEffect(() => {
    if (!motionMax && !tiltMax && !lightMax && !depthMax) return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      reducedMotion.current = mq.matches
      syncRef.current(d.engine.x / pitch, d.engine.v)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [!!(motionMax || tiltMax || lightMax || depthMax), pitch]) // eslint-disable-line react-hooks/exhaustive-deps

  // Masks: the edge fade, and (with the lens) a gap at the band so the magnified copy shows alone.
  const side = vertical ? 'bottom' : 'right'
  const ms = px(maskSize)
  const edge =
    mask === 'none' ? '' : mask === 'gradient' ? `linear-gradient(to ${side},transparent,#000 ${ms},#000 calc(100% - ${ms}),transparent)` : mask
  const bandStart = base + gap / 2
  const maskStyle = (): CSSProperties => (edge ? { maskImage: edge, WebkitMaskImage: edge } : {})
  // With the lens: rows are hidden exactly where the indicator box is (the lens shows them magnified there),
  // so a long word entering a still-narrow indicator shows plain outside and magnified inside, never cut.
  const crossEnd = `calc(${crossStart} + var(--indicator-w))`
  const holeMask = vertical
    ? `linear-gradient(to bottom,#000 calc(50% - var(--indicator-h) / 2),transparent 0 calc(50% + var(--indicator-h) / 2),#000 0),linear-gradient(to right,#000 ${crossStart},transparent 0 ${crossEnd},#000 0)`
    : `linear-gradient(to right,#000 calc(50% - var(--indicator-w) / 2),transparent 0 calc(50% + var(--indicator-w) / 2),#000 0),linear-gradient(to bottom,#000 calc(50% - var(--indicator-h) / 2),transparent 0 calc(50% + var(--indicator-h) / 2),#000 0)`
  const holeStyle: CSSProperties = hasLens
    ? { position: 'absolute', inset: 0, maskImage: holeMask, WebkitMaskImage: holeMask, maskComposite: 'add', WebkitMaskComposite: 'source-over' }
    : { position: 'absolute', inset: 0 }
  const lensClip = vertical
    ? `inset(calc(50% - var(--indicator-h) / 2) calc(100% - ${crossEnd}) calc(50% - var(--indicator-h) / 2) ${crossStart} round var(--indicator-r))`
    : `inset(calc(50% - var(--indicator-h) / 2) calc(50% - var(--indicator-w) / 2) round var(--indicator-r))`

  // Indicator box: centered on the band, sized by --indicator-w / --indicator-h (px from the frame loop with
  // fit 'content', otherwise the band), drawn by shape × material.
  const hs = typeof highlightStyle === 'object' ? highlightStyle : undefined
  const indicatorBox: CSSProperties = {
    position: 'absolute',
    width: 'var(--indicator-w)',
    height: 'var(--indicator-h)',
    top: 'calc(50% - var(--indicator-h) / 2)',
    left: vertical ? crossStart : 'calc(50% - var(--indicator-w) / 2)', // physical: crossStart already accounts for RTL
    boxSizing: 'border-box',
    pointerEvents: 'none',
    ...(ind.impact ? { scale: vertical ? 'calc(1 + var(--indicator-impact, 0) * .025) calc(1 - var(--indicator-impact, 0) * .07)' : 'calc(1 - var(--indicator-impact, 0) * .07) calc(1 + var(--indicator-impact, 0) * .025)' } : {}),
    ...indicatorStyle(ind, vertical),
    // The dot sits outside the content (clear of the lens' magnified text): widen only the drawn box.
    // The dot sits just left of the item: room for it beside fitted content (a band already spans the row).
    ...(ind.shape === 'dot' && fitContent ? { width: 'calc(var(--indicator-w) + 24px)', marginLeft: -12 } : {}),
    ...hs,
  }
  const radiusVar = ind.shape === 'pill' ? '999px' : ind.shape === 'rounded' || !ind.shape ? `${ind.radius ?? 12}px` : '0px'

  // Progressive edge blur: stacked backdrop-filter layers, each masked to a band that reaches a bit
  // further from the edge than the next stronger one. Overlapping linear ramps = no visible steps.
  const gb = gradientBlur === true ? {} : gradientBlur || undefined
  const blurLayers: CSSProperties[] = []
  if (gb) {
    const n = Math.max(1, gb.layers ?? 6)
    const strength = gb.strength ?? 8
    // Ramp length from each edge, against the root's real length (% of the gradient line): up to just short of the
    // center row, so it holds when the wheel is sized smaller than visibleCount rows.
    const reach = `(50% - ${pitch / 2 + 2}px)`
    const size = gb.size == null ? reach : `min(${gb.size}px, ${reach})`
    for (let k = 1; k <= n; k++) {
      const solid = `calc(${size} * ${(n - k) / n})`
      const clear = `calc(${size} * ${Math.min(1, (n - k + 2) / n)})`
      const m = `linear-gradient(to ${side},#000 ${solid},transparent ${clear},transparent calc(100% - ${clear}),#000 calc(100% - ${solid}))`
      const f = `blur(${strength / 2 ** (n - k)}px)`
      blurLayers.push({ backdropFilter: f, WebkitBackdropFilter: f, maskImage: m, WebkitMaskImage: m })
    }
  }

  const tiltT = tilt == null ? '' : typeof tilt === 'number' ? (vertical ? `rotateY(${tilt}deg)` : `rotateX(${tilt}deg)`) : `rotateX(${tilt.x ?? 0}deg) rotateY(${tilt.y ?? 0}deg)`
  const rootVars = {
    '--detent-pitch': pitch,
    '--detent-angle': drum ? alpha : 0,
    '--detent-radius': drum ? R : 0,
    '--detent-perspective': P || 1,
    '--detent-fade': typeof fade === 'number' ? fade : 0,
    '--detent-scale': typeof scale === 'number' ? scale : 0,
    '--detent-blur': typeof blur === 'number' ? blur : 0,
    '--detent-dim': typeof dim === 'number' ? dim : 0,
    '--detent-spacing': typeof spacing === 'number' ? spacing : 0,
    '--detent-skew': skew,
    '--detent-dir': dir,
    '--detent-magnify': zoom || 1,
    // Band-sized until measured (fit 'content' writes px every frame). The value differs by mode (+ 0px) so React
    // writes it again when fit changes: back to 'band', the last measured px must not linger.
    '--indicator-w': (vertical ? `calc(100% - ${2 * inset}px` : `calc(${item}px`) + (fitContent ? ' + 0px)' : ')'),
    '--indicator-h': vertical ? `${item}px` : `calc(100% - ${2 * inset}px)`,
    '--indicator-r': radiusVar,
  } as CSSProperties

  const trackProps = d.getTrackProps({ ref: track })
  if (gripAmount) trackProps.style = { ...trackProps.style, translate: 'var(--detent-grip-x, 0px) var(--detent-grip-y, 0px)' }
  const mirror = trackProps.style as CSSProperties // same position and initial transform as the main track
  const rowBox = (j: number): CSSProperties => ({
    position: 'absolute',
    ...(vertical ? { left: 0, right: 0, top: j * pitch, height: pitch } : { top: 0, bottom: 0, insetInlineStart: j * pitch, width: pitch }),
  })
  const slotRow = (s: typeof d.header, content: ReactNode) =>
    s && (
      <div
        {...s.getProps({ style: { ...rowCss, ...rowBox(s.virtual), '--offset': s.offset, '--abs-offset': Math.abs(s.offset) } as CSSProperties })}
        data-detent-row=""
        data-detent-slot={s.virtual}
      >
        {content}
      </div>
    )

  return (
    <>
      <style nonce={nonce}>{CSS()}</style>
      {refractionAmount > 0 && (
        <svg width="0" height="0" aria-hidden focusable="false" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <defs>
            <filter id={refractionId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feFlood floodColor="rgb(128,128,128)" result="neutral" />
              <feImage ref={refractionImage} href={refractionSource} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="curve" />
              <feComposite in="curve" in2="neutral" operator="over" result="map" />
              <feDisplacementMap ref={displacement} in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" result="refracted" />
              {refractionRGB > 0 && <>
                <feOffset ref={redOffset} in="refracted" dx="0" dy="0" result="red-shift" />
                <feColorMatrix in="red-shift" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
                <feColorMatrix in="refracted" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
                <feOffset ref={blueOffset} in="refracted" dx="0" dy="0" result="blue-shift" />
                <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
                <feComposite in="red" in2="green" operator="arithmetic" k2="1" k3="1" />
                <feComposite in2="blue" operator="arithmetic" k2="1" k3="1" result="channels" />
                {/* Channel colors alone cannot fringe black glyphs. Alpha differences add their colored rims,
                    while identical coverage (the center and opaque images) contributes nothing. */}
                <feComposite in="red-shift" in2="blue-shift" operator="arithmetic" k2="1" k3="-1" result="red-rim" />
                <feFlood floodColor="#ff3040" />
                <feComposite in2="red-rim" operator="in" result="red-fringe" />
                <feComposite in="blue-shift" in2="red-shift" operator="arithmetic" k2="1" k3="-1" result="cyan-rim" />
                <feFlood floodColor="#00cfff" />
                <feComposite in2="cyan-rim" operator="in" result="cyan-fringe" />
                <feMerge result="chromatic"><feMergeNode in="channels" /><feMergeNode in="red-fringe" /><feMergeNode in="cyan-fringe" /></feMerge>
                {/* Keep the RGB pass away from the neutral reading area, including antialiasing. */}
                <feColorMatrix in="map" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${vertical ? '0 1' : '1 0'} 0 0 0`} />
                <feComponentTransfer result="dispersion-mask"><feFuncA type="table" tableValues="1 .75 .5 .25 0 0 0 .25 .5 .75 1" /></feComponentTransfer>
                <feComposite in="chromatic" in2="dispersion-mask" operator="in" result="dispersion" />
                {/* Replace the masked area: drawing it over the original hides separated channels in white text. */}
                <feComposite in="refracted" in2="dispersion-mask" operator="out" result="clear-center" />
                <feComposite in="clear-center" in2="dispersion" operator="arithmetic" k2="1" k3="1" />
              </>}
            </filter>
          </defs>
        </svg>
      )}
      {motionMax > 0 && (
        <svg width="0" height="0" aria-hidden focusable="false" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <defs>
            <filter id={motionId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
              <feGaussianBlur ref={motionFilter} stdDeviation="0 0" />
            </filter>
          </defs>
        </svg>
      )}
      <div
        {...d.getRootProps({
          ref: rootEl,
          className,
          style: {
            ...(vertical ? { width: width ?? '100%' } : { height }),
            background,
            ...rootVars,
            ...style,
          },
        })}
        data-detent-ui=""
        data-theme={theme}
      >
        <div data-detent-layer="" style={{ transform: tiltT ? `perspective(${P || 800}px) ${tiltT}` : undefined }}>
          {(ind.shape !== 'none' || renderIndicator || (highlight !== true && highlight !== false)) && (
            <div data-detent-band="" data-ring={ring ? '' : undefined} style={indicatorBox}>
              {highlight !== true && highlight !== false ? highlight : null}
              {renderIndicator?.({
                width: indicatorCtl.state.current.w,
                height: indicatorCtl.state.current.h,
                progress: 1,
                velocity: 0,
                item: d.selectedItem,
              })}
            </div>
          )}
          <div data-detent-layer="" style={maskStyle()}>
           <div style={holeStyle}>
            <div {...trackProps}>
              {d.rows.map((r) => {
                const sel = r.selected
                const p = r.getProps({
                  className: sel ? selectedClassName : undefined,
                  style: {
                    ...rowCss,
                    ...Object.fromEntries(liveVars(r.offset)),
                    ...(sel ? selectedStyle : undefined),
                    ...rowStyle?.(r.offset, r.index, sel),
                  },
                })
                const body = renderItem
                  ? renderItem(r.item, { index: r.index, selected: sel, offset: r.offset, progress: Math.max(0, 1 - Math.abs(r.offset) / (visibleCount / 2)) })
                  : String(r.item)
                return (
                  <div key={r.key} {...p} data-detent-row="" data-detent-item={r.index}>
                    {/* With fit 'content' the content box is measured (ResizeObserver) to size the indicator. */}
                    {fitContent ? <span data-detent-content="" style={{ display: 'inline-flex', alignItems: 'center' }}>{body}</span> : body}
                  </div>
                )
              })}
            </div>
           </div>
          </div>
          {(header != null || footer != null || loading) && (
            <div data-detent-layer="" style={maskStyle()}>
              <div ref={slots} style={mirror}>
                {slotRow(d.header, header)}
                {slotRow(d.loadingRow, loadingRow)}
                {slotRow(d.footer, footer)}
              </div>
            </div>
          )}
          {blurLayers.map((s, i) => (
            <div key={i} data-detent-layer="" style={s} />
          ))}
          {hasLens && (
            <div
              data-detent-layer=""
              aria-hidden
              // The lens is a visual copy: inert keeps its controls (interactive rows) out of tab order and clicks.
              ref={(el) => el?.setAttribute('inert', '')}
              style={{ clipPath: lensClip }}
            >
              <div data-detent-optics="" style={{ position: 'absolute', inset: 0, ...(refractionAmount ? { filter: 'var(--detent-refraction-filter, none)' } : {}) }}>
                <div ref={lens} style={mirror}>
                  {d.rows.map((r) => (
                    <div key={r.key} data-detent-row="" data-detent-mirror={r.virtual} style={{ ...rowBox(r.virtual), ...(elasticAmount ? { translate: elasticTranslate } : {}), ...(depthMax ? { transform: depthTransform } : {}), justifyContent: rowCss.justifyContent, paddingInline: rowCss.paddingInline, pointerEvents: 'none', ...(tiltMax ? { rotate: 'var(--detent-velocity-tilt, 0deg)' } : {}), ...(motionMax || lightMax ? { filter: [lightFilter, motionMax ? 'var(--detent-motion-filter, blur(0px))' : ''].filter(Boolean).join(' ') } : {}) }}>
                      <div style={{ transform: `scale(${zoom || 1})`, transformOrigin: align === 'center' ? 'center' : align === 'start' ? 'left center' : 'right center' }}>
                        {renderItem
                          ? renderItem(r.item, { index: r.index, selected: r.selected, offset: r.offset, progress: 1 })
                          : String(r.item)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {shadow && (
            <div
              data-detent-layer=""
              style={{
                background:
                  shadow === true
                    ? `linear-gradient(to ${side},var(--detent-shade),transparent 22%,transparent 78%,var(--detent-shade))`
                    : shadow,
              }}
            />
          )}
          {glare && (
            <div
              data-detent-layer=""
              style={{ background: `linear-gradient(to ${side},transparent 30%,var(--detent-glare) 47%,transparent 64%)`, mixBlendMode: 'soft-light' }}
            />
          )}
        </div>
        {!d.rows.length && !header && emptyState != null && (
          <div data-detent-layer="" style={{ display: 'grid', placeItems: 'center' }}>
            {emptyState}
          </div>
        )}
      </div>
      {/* A sibling, not a child: a listbox may only own options. */}
      <div {...d.getLiveRegionProps()} />
      {name && (
        <input
          ref={field}
          type="hidden"
          name={name}
          form={form}
          disabled={options.disabled}
          value={d.selectedItem === undefined ? '' : String(keyOf(d.selectedItem, d.selectedIndex))}
        />
      )}
    </>
  )
}
