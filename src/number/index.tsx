import { createElement, forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type HTMLAttributes } from 'react'
import type { SpringConfig } from '../physics/types'
import type { RollOptions } from '../text/roll'
import { numberController } from './controller'
import { glyphsOf, tokens } from './tokens'

export { tokens as numberTokens, type Token as NumberToken } from './tokens'

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect
/** The parts of a formatted number that `classNames` can style. */
export type NumberPart = 'integer' | 'fraction' | 'decimal' | 'group' | 'currency' | 'sign' | 'unit'
const partOf = (type: string): string =>
  type === 'minusSign' || type === 'plusSign' ? 'sign' : type === 'percentSign' || type === 'compact' ? 'unit' : type
export interface DetentNumberProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'onAnimationStart'> {
  value: number | bigint
  /** Passed to `Intl.NumberFormat`, like `format`. */
  locales?: string | string[]
  format?: Intl.NumberFormatOptions
  /** Which way the digits roll. `'auto'` (default): up when the value grows, down when it shrinks. */
  trend?: 'auto' | 'up' | 'down'
  /**
   * A class per part of the number, e.g. a smaller currency or fraction. The native text is then split into one span
   * per part, still one selectable, accessible label, and the rolling copies carry the same classes.
   */
  classNames?: Partial<Record<NumberPart, string>>
  as?: 'span' | 'div' | 'p' | 'label' | 'strong' | 'em' | 'small' | 'output' | 'code' | 'data' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  /** Disable transitions. Reduced motion is always respected. */
  animate?: boolean
  spring?: Partial<SpringConfig>
  /** Maximum spring duration in milliseconds. Default 700. */
  snapDuration?: number
  onAnimationStart?: () => void
  onAnimationComplete?: () => void
  onAnimationCancel?: () => void
}
const positive = (n: number | undefined, fallback: number) => n !== undefined && Number.isFinite(n) && n > 0 ? n : fallback

/**
 * A formatted number whose digits roll on Detent's spring physics, through the values between. Native text at
 * rest, including server rendering; values that format the same do not move.
 */
export const DetentNumber = forwardRef<HTMLElement, DetentNumberProps>(function DetentNumber({
  value, locales, format, trend = 'auto', classNames, as = 'span', animate = true, spring, snapDuration = 700,
  onAnimationStart, onAnimationComplete, onAnimationCancel, style, ...props
}, ref) {
  const root = useRef<HTMLElement>(null), content = useRef<HTMLSpanElement>(null), layer = useRef<HTMLSpanElement>(null)
  const controller = useRef<ReturnType<typeof numberController> | null>(null)
  const settled = useRef(value)
  // Inline objects are new every render; the formatter only changes when what they say does.
  const formatKey = JSON.stringify([locales, format])
  const formatter = useMemo(() => {
    const f = new Intl.NumberFormat(locales, format)
    return { f, glyphs: glyphsOf(f) }
  }, [formatKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const parts = formatter.f.formatToParts(value as number)
  const text = parts.map(p => p.value).join('')
  const setRoot = useCallback((node: HTMLElement | null) => {
    root.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }, [ref])
  useIso(() => {
    const c = numberController(root.current!, content.current!, layer.current!)
    controller.current = c
    return () => { controller.current = null; c.destroy() }
  }, [as])
  useIso(() => {
    const options: RollOptions = { animate,
      width: style?.width == null ? '' : typeof style.width === 'number' ? `${style.width}px` : String(style.width),
      spring: { stiffness: positive(spring?.stiffness, 460), damping: positive(spring?.damping, 38), mass: positive(spring?.mass, 1) },
      snapDuration: positive(snapDuration, 700), onAnimationStart, onAnimationComplete, onAnimationCancel }
    const previous = settled.current
    settled.current = value
    const direction = trend === 'up' ? 1 : trend === 'down' ? -1 : value > previous ? 1 : value < previous ? -1 : 0
    controller.current?.commit(text, options, [props.className, style, props.lang, props.dir, classNames], tokens(parts, formatter.glyphs), formatter.glyphs, direction)
  })
  // The rolling layer needs a positioned box that takes a width: position: static becomes relative, and display:
  // inline or contents (no box of its own) becomes inline-block. Everything else in `style` is yours.
  const position = style?.position && style.position !== 'static' ? style.position : 'relative'
  const display = !style?.display || style.display === 'inline' || style.display === 'contents' ? 'inline-block' : style.display
  return createElement(as, { ...props, 'data-detent-number': '', ref: setRoot,
    style: { verticalAlign: 'baseline', whiteSpace: 'pre', fontVariantNumeric: 'tabular-nums', ...style, position, display } },
    <span ref={content} data-detent-number-content="" style={{ display: 'inline-block', whiteSpace: 'pre', width: 'max-content', minHeight: '1lh' }}>
      {classNames ? parts.map((p, i) => <span key={i} className={classNames[partOf(p.type) as NumberPart]}>{p.value}</span>) : text}
    </span>,
    <span ref={layer} data-detent-number-layer="" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', userSelect: 'none' }} />)
})
