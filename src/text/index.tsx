import { createElement, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type HTMLAttributes } from 'react'
import type { SpringConfig } from '../physics/types'
import { textController, type TextOptions } from './controller'

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect
export interface DetentTextProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'onAnimationStart'> {
  /** The current label. No list of possible values is needed. Numbers are converted to strings. */
  children: string | number
  as?: 'span' | 'div' | 'p' | 'label' | 'strong' | 'em' | 'small' | 'output' | 'code' | 'pre' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  /** Keep matching graphemes; false rolls the entire label. Default true. */
  morph?: boolean
  /** Disable transitions. Reduced motion is always respected. */
  animate?: boolean
  /** Locale used for grapheme segmentation; format numbers before passing them if needed. */
  locale?: string
  spring?: Partial<SpringConfig>
  /** Maximum spring duration in milliseconds. Default 550. */
  snapDuration?: number
  rollDirection?: 'up' | 'down'
  onAnimationStart?: () => void
  onAnimationComplete?: () => void
  onAnimationCancel?: () => void
}
const positive = (n: number | undefined, fallback: number) => n !== undefined && Number.isFinite(n) && n > 0 ? n : fallback

/** Short, single-line labels, rolled with Detent's spring physics. Native text at rest, including server rendering. */
export const DetentText = forwardRef<HTMLElement, DetentTextProps>(function DetentText({
  children, as = 'span', morph = true, animate = true, locale, spring, snapDuration = 550, rollDirection = 'up',
  onAnimationStart, onAnimationComplete, onAnimationCancel, style, ...props
}, ref) {
  const root = useRef<HTMLElement>(null), content = useRef<HTMLSpanElement>(null), layer = useRef<HTMLSpanElement>(null)
  const controller = useRef<ReturnType<typeof textController> | null>(null)
  const text = String(children)
  const setRoot = useCallback((node: HTMLElement | null) => {
    root.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }, [ref])
  useIso(() => {
    const c = textController(root.current!, content.current!, layer.current!)
    controller.current = c
    return () => { controller.current = null; c.destroy() }
  }, [as])
  useIso(() => {
    const options: TextOptions = { morph, animate, locale, rollDirection,
      width: style?.width == null ? '' : typeof style.width === 'number' ? `${style.width}px` : String(style.width),
      spring: { stiffness: positive(spring?.stiffness, 420), damping: positive(spring?.damping, 32), mass: positive(spring?.mass, 1) },
      snapDuration: positive(snapDuration, 550), onAnimationStart, onAnimationComplete, onAnimationCancel }
    controller.current?.commit(text, options, [props.className, style, props.lang, props.dir])
  })
  // The rolling layer needs a positioned box that takes a width: position: static becomes relative, and display:
  // inline or contents (no box of its own) becomes inline-block. Everything else in `style` is yours.
  const position = style?.position && style.position !== 'static' ? style.position : 'relative'
  const display = !style?.display || style.display === 'inline' || style.display === 'contents' ? 'inline-block' : style.display
  return createElement(as, { ...props, 'data-detent-text': '', ref: setRoot, style: { verticalAlign: 'baseline', whiteSpace: 'pre', ...style, position, display } },
    <span ref={content} data-detent-text-content="" style={{ display: 'inline-block', whiteSpace: 'pre', width: 'max-content', minHeight: '1lh' }}>{text}</span>,
    <span ref={layer} data-detent-text-layer="" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', userSelect: 'none' }} />)
})
