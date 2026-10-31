import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { haptics as makeHaptics, tickSound as makeTickSound, ticks, type TickSoundOptions } from '../feedback'
import { presets, type Physics, type PresetName } from '../presets'
import { useDetent, type DetentOptions } from './useDetent'

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
  /** Color falloff toward --detent-dim-color, per row (keeps backgrounds solid, unlike fade). Default 0.22. */
  dim?: Falloff
  /** Extra gap that grows with distance, px. Default 0. */
  spacing?: Falloff
  /** Curve applied to the distance before the falloffs. Default 'linear'. */
  easing?: Easing

  // Selection band
  /** The band behind the center row, or your own element. Default true. */
  highlight?: boolean | ReactNode
  /** 'rounded' (default), 'pill', 'lines' (iOS hairlines above and below), or your own styles. */
  highlightStyle?: 'rounded' | 'pill' | 'lines' | CSSProperties
  /** Shadow on the band: true for a lifted look, or any box-shadow. */
  highlightShadow?: boolean | string
  /** iOS lens: the center row renders larger inside the band only. true = 1.1. Default true. */
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
  /** A tuned bundle: 'ios' | 'scroll' | 'snappy' | 'heavy' | 'elastic' | 'linear', or your own physics. */
  preset?: PresetName | Physics
  /** Vibrate per tick where supported: true, or a pattern. */
  haptics?: boolean | number | number[]
  /** A soft click per tick (Web Audio), louder when faster. */
  tickSound?: boolean | TickSoundOptions

  // Escape hatch
  /** Any per-row style from the live offset, applied every frame. */
  rowStyle?: (offset: number, index: number, selected: boolean) => CSSProperties
  /** Force a color scheme (otherwise follows prefers-color-scheme or an ancestor's data-theme). */
  theme?: 'light' | 'dark'
  className?: string
  style?: CSSProperties
}

const light = '--detent-fg:#0a0a0a;--detent-dim-color:#b4b4b4;--detent-band:rgb(0 0 0/.045);--detent-line:rgb(0 0 0/.09);--detent-ring:#0a0a0a;--detent-shade:rgb(0 0 0/.07);--detent-glare:rgb(255 255 255/.55)'
const dark = '--detent-fg:#ededed;--detent-dim-color:#5a5a5a;--detent-band:rgb(255 255 255/.06);--detent-line:rgb(255 255 255/.1);--detent-ring:#ededed;--detent-shade:rgb(0 0 0/.35);--detent-glare:rgb(255 255 255/.08)'
const U = '[data-detent-ui]'
/** Built on first use: a module-level template literal with interpolations is not tree-shakeable. */
let css: string | undefined
const CSS = () => (css ??= `${U}{${light};color:var(--detent-fg);font-variant-numeric:tabular-nums;font-size:var(--detent-font-size,20px);cursor:grab;outline:none}
@media (prefers-color-scheme:dark){${U}:not([data-theme=light]):not([data-theme=light] *){${dark}}}
[data-theme=dark] ${U},${U}[data-theme=dark]{${dark}}
${U}[data-dragging]{cursor:grabbing}
${U} [data-detent-band]{transition:outline-color .15s cubic-bezier(.23,1,.32,1);outline:2px solid transparent;outline-offset:3px}
${U}:focus-visible [data-detent-band]{outline-color:var(--detent-ring)}
${U} [data-detent-row]{display:flex;align-items:center;backface-visibility:hidden;white-space:nowrap}
${U} [data-detent-layer]{position:absolute;inset:0;pointer-events:none}
${U} [data-detent-layer] [data-detent-row]{pointer-events:auto}`)

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
    dim = 0.22,
    spacing = 0,
    easing = 'linear',
    highlight = true,
    highlightStyle = 'rounded',
    highlightShadow,
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
    haptics,
    tickSound,
    onTick,
    rowStyle,
    theme,
    className,
    style,
    visibleCount = 7,
    orientation = 'vertical',
    ...options
  } = props

  const item = itemHeight ?? itemSize ?? 40
  const pitch = item + gap
  const vertical = orientation !== 'horizontal'
  const feedback = useMemo(
    () =>
      ticks(
        onTick,
        !!haptics && makeHaptics(haptics === true ? {} : { pattern: haptics }),
        tickSound && makeTickSound(tickSound === true ? {} : tickSound),
      ),
    [onTick, haptics, tickSound],
  )
  const d = useDetent<T>({
    ...options,
    preset: typeof preset === 'string' ? presets[preset] : preset,
    itemSize: pitch,
    visibleCount,
    orientation,
    header: header != null,
    footer: footer != null,
    loading,
    onTick: feedback,
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
        `translate${A}(${shift}) scale(calc(${drum ? 'var(--k) * ' : ''}var(--s)))` +
        (drum ? ` perspective(calc(var(--detent-perspective) * 1px)) ${rot}` : '') +
        (skew ? ` skew${vertical ? 'X' : 'Y'}(calc(var(--offset) * var(--detent-skew) * 1deg))` : ''),
      opacity: drum ? 'calc(var(--o) * var(--v))' : 'var(--o)',
      ...(blur ? { filter: 'blur(calc(var(--b) * 1px))' } : {}),
      ...(dim ? { color: 'color-mix(in oklab, var(--detent-fg), var(--detent-dim-color) calc(var(--d) * 100%))' } : {}),
      justifyContent: align === 'center' ? 'center' : align === 'start' ? 'flex-start' : 'flex-end',
      paddingInline: align === 'center' ? 0 : 16,
    } as CSSProperties
  }, [vertical, drum, easing, easeFn, skew, blur, dim, align])

  /** Values for function props (and custom easing) at `off`, as CSS variables. */
  const liveVars = (off: number): [string, string][] => {
    const out: [string, string][] = []
    if (easeFn) out.push(['--e', String(easeFn(Math.abs(off)))])
    for (const k of live) out.push([FALLOFF[k][0], String((fns[k] as (o: number) => number)(off))])
    return out
  }

  // Layers that mirror the main track (slots, lens) and per-frame JS (function props, rowStyle).
  const track = useRef<HTMLElement | null>(null)
  const slots = useRef<HTMLDivElement>(null)
  const lens = useRef<HTMLDivElement>(null)
  const latest = useRef({ liveVars, rowStyle, perFrame })
  latest.current = { liveVars, rowStyle, perFrame }
  /** Bring the mirror layers and JS-driven row values in line with the main track at `offset` (rows). */
  const sync = (offset: number) => {
    const t = track.current?.style.transform
    for (const m of [slots.current, lens.current]) {
      if (!m || !t) continue
      m.style.transform = t
      if (m === slots.current)
        for (const el of m.children as unknown as HTMLElement[]) {
          const off = Number(el.dataset.detentSlot) - offset
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
  syncRef.current = sync
  useEffect(() => d.subscribe((f) => syncRef.current(f.offset)), [d])
  // Every render too (layout phase, before paint): the engine may have moved the track while mirrors
  // were not subscribed yet (mount, RTL detected after hydration), and re-renders reset inline styles.
  useIsoLayoutEffect(() => sync(d.engine.x / pitch))

  // Masks: the edge fade, and (with the lens) a gap at the band so the magnified copy shows alone.
  const side = vertical ? 'bottom' : 'right'
  const ms = px(maskSize)
  const edge =
    mask === 'none' ? '' : mask === 'gradient' ? `linear-gradient(to ${side},transparent,#000 ${ms},#000 calc(100% - ${ms}),transparent)` : mask
  const bandStart = base + gap / 2
  const bandEnd = bandStart + item
  const gapMask = `linear-gradient(to ${side},#000 ${bandStart}px,transparent ${bandStart}px,transparent ${bandEnd}px,#000 ${bandEnd}px)`
  const maskStyle = (withGap: boolean): CSSProperties => {
    const m = [edge, withGap && zoom ? gapMask : ''].filter(Boolean)
    return m.length
      ? { maskImage: m.join(','), WebkitMaskImage: m.join(','), maskComposite: 'intersect', WebkitMaskComposite: 'source-in' }
      : {}
  }

  // Band geometry: along the axis it covers the center row; across, inset by style.
  const hs = typeof highlightStyle === 'object' ? highlightStyle : undefined
  const kind = typeof highlightStyle === 'string' ? highlightStyle : 'rounded'
  const along = vertical ? { top: bandStart, height: item } : { insetInlineStart: bandStart, width: item }
  const across = kind === 'lines' ? 0 : 6
  const bandStyle: CSSProperties = {
    position: 'absolute',
    ...along,
    ...(vertical ? { left: across, right: across } : { top: across, bottom: across }),
    borderRadius: kind === 'pill' ? 999 : kind === 'lines' ? 0 : 10,
    background: kind === 'lines' ? 'transparent' : 'var(--detent-band)',
    boxShadow:
      kind === 'lines'
        ? vertical
          ? 'inset 0 1px var(--detent-line), inset 0 -1px var(--detent-line)'
          : 'inset 1px 0 var(--detent-line), inset -1px 0 var(--detent-line)'
        : `inset 0 0 0 1px var(--detent-line)${highlightShadow ? `, ${highlightShadow === true ? '0 6px 16px -6px rgb(0 0 0/.18), 0 1px 2px rgb(0 0 0/.06)' : highlightShadow}` : ''}`,
    pointerEvents: 'none',
    ...hs,
  }

  // Progressive edge blur: stacked backdrop-filter layers, each masked to a band that reaches a bit
  // further from the edge than the next stronger one. Overlapping linear ramps = no visible steps.
  const gb = gradientBlur === true ? {} : gradientBlur || undefined
  const blurLayers: CSSProperties[] = []
  if (gb) {
    const n = Math.max(1, gb.layers ?? 6)
    const strength = gb.strength ?? 8
    const size = Math.min(gb.size ?? base - 4, base - 2) // never reaches the center row
    for (let k = 1; k <= n; k++) {
      const solid = (size * (n - k)) / n
      const clear = Math.min(size, solid + (2 * size) / n)
      const m = `linear-gradient(to ${side},#000 ${solid}px,transparent ${clear}px,transparent calc(100% - ${clear}px),#000 calc(100% - ${solid}px))`
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
  } as CSSProperties

  const trackProps = d.getTrackProps({ ref: track })
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
      <style>{CSS()}</style>
      <div
        {...d.getRootProps({
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
          {highlight !== false && (
            <div data-detent-band="" style={bandStyle}>
              {highlight === true ? null : highlight}
            </div>
          )}
          <div data-detent-layer="" style={maskStyle(true)}>
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
                return (
                  <div key={r.key} {...p} data-detent-row="" data-detent-item={r.index}>
                    {renderItem
                      ? renderItem(r.item, { index: r.index, selected: sel, offset: r.offset, progress: Math.max(0, 1 - Math.abs(r.offset) / (visibleCount / 2)) })
                      : String(r.item)}
                  </div>
                )
              })}
            </div>
          </div>
          {(header != null || footer != null || loading) && (
            <div data-detent-layer="" style={maskStyle(false)}>
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
          {zoom > 0 && (
            <div
              data-detent-layer=""
              aria-hidden
              style={{ clipPath: vertical ? `inset(${bandStart}px 0 ${extent - bandEnd}px 0)` : `inset(0 ${extent - bandEnd}px 0 ${bandStart}px)` }}
            >
              <div ref={lens} style={mirror}>
                {d.rows.map((r) => (
                  <div key={r.key} data-detent-row="" style={{ ...rowBox(r.virtual), justifyContent: rowCss.justifyContent, paddingInline: rowCss.paddingInline, pointerEvents: 'none' }}>
                    <div style={{ transform: `scale(${zoom})`, transformOrigin: align === 'center' ? 'center' : align === 'start' ? 'left center' : 'right center' }}>
                      {renderItem
                        ? renderItem(r.item, { index: r.index, selected: r.selected, offset: r.offset, progress: 1 })
                        : String(r.item)}
                    </div>
                  </div>
                ))}
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
        <div {...d.getLiveRegionProps()} />
      </div>
    </>
  )
}
