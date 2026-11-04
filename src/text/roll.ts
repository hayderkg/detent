import { spring } from '../physics/spring'
import type { Motion, SpringConfig } from '../physics/types'

/**
 * What every rolling label shares (DetentText, DetentNumber): one frame loop, the intrinsic width spring, native
 * text restored at rest, the layout cache, reduced motion, resizes and font loads. Each kind brings its own parts.
 */
export type Axis = { x: number; v: number; motion?: Motion }
export const axis = (x: number): Axis => ({ x, v: 0 })
export interface RollOptions {
  width: string
  animate: boolean
  spring: SpringConfig
  snapDuration: number
  onAnimationStart?: () => void
  onAnimationComplete?: () => void
  onAnimationCancel?: () => void
}
export interface Shape { text: string; width: number; height: number }
export interface Kind<L extends Shape, O extends RollOptions> {
  measure(text: string, o: O): L
  /** False settles on the new label without a transition. */
  animatable(old: L, next: L, previous: O, o: O): boolean
  /** Visual copies of the label at rest, before its first transition. */
  begin(old: L, o: O): void
  /**
   * Retargets every part from where it is drawn now. Returns the longest motion (ms). `anchored`: the label grows
   * from its right edge or middle, and parts are in a frame that stays put on screen (see roll's anchor).
   */
  transition(old: L, next: L, o: O, anchored: boolean): number
  paint(t: number): void
  /** Move every part by dx px, as drawn now (the layer's frame changed under them). */
  shift(dx: number): void
  /** The layer has been emptied: forget the parts. */
  clear(): void
}

export function sample(a: Axis, t: number) {
  if (a.motion) { const s = a.motion.at(t); a.x = s.x; a.v = s.v }
}
export function move(a: Axis, to: number, o: RollOptions): number {
  a.motion = undefined
  if (Math.abs(a.x - to) < 0.001 && Math.abs(a.v) < 0.001) { a.x = to; a.v = 0; return 0 }
  a.motion = spring(a.x, to, a.v, o.spring, o.snapDuration, 0.001)
  return a.motion.duration
}
/** A visual copy of the native text. It sits in the same root, so it inherits the same typography. */
export function copy(text: string, left: number, top = 0) {
  const node = document.createElement('span')
  node.textContent = text
  Object.assign(node.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: 'max-content', whiteSpace: 'pre' })
  return node
}
/** Hide ink outside the line and soften its inner edges; callers offset their copies by the returned padding. */
export function fadeWindow(node: HTMLElement, box: { left: number; top: number; height: number }) {
  const pad = box.height / 8, edge = pad + box.height / 32
  Object.assign(node.style, { left: `${box.left}px`, top: `${box.top - pad}px`, height: `${box.height + 2 * pad}px`,
    maskImage: `linear-gradient(transparent ${pad}px,#000 ${edge}px,#000 calc(100% - ${edge}px),transparent calc(100% - ${pad}px))` })
  return pad
}
// Sub-layout-pixel DOMRect jitter is not a font resize and must not cancel a running transition.
type Size = Pick<Shape, 'width' | 'height'>
const sizeChanged = (a: Size, b: Size) => Math.abs(a.width - b.width) > 1 / 64 || Math.abs(a.height - b.height) > 1 / 64

/** One frame loop, preference listener and resize observer per label. No input listeners or React frames. */
export function roll<L extends Shape, O extends RollOptions>(root: HTMLElement, content: HTMLElement, layer: HTMLElement, kind: Kind<L, O>) {
  let options: O
  let layout: L | undefined
  let key = '', lookKey = ''
  let width = axis(0)
  let raf = 0, started = 0, duration = 0, running = false, destroyed = false
  let completion: (() => void) | undefined, cancellation: (() => void) | undefined
  let originalWidth = root.style.width
  let fit = !originalWidth
  let inlineOpacity = content.style.opacity
  // Which way the label grows in its line: 0 from its left edge, 1 from its right (right-aligned, or RTL), ½ from its
  // middle (centred). While the width springs, that edge travels; the layer moves back by as much, so the copies stay
  // where they are on screen instead of riding along. Measured per transition; 0 costs nothing.
  let anchor = 0, endWidth = 0
  const frameOffset = (w: number) => anchor * (w - endWidth)
  const mq = matchMedia('(prefers-reduced-motion: reduce)')

  const stop = (complete: boolean) => {
    cancelAnimationFrame(raf); raf = 0
    const notify = running ? complete ? completion : cancellation : undefined
    running = false
    completion = cancellation = undefined
    content.style.opacity = inlineOpacity
    if (fit) root.style.width = originalWidth
    layer.style.translate = ''
    anchor = 0
    layer.replaceChildren()
    kind.clear()
    notify?.()
  }
  function paint(now: number) {
    const t = Math.max(0, now - started)
    sample(width, t)
    if (fit && width.motion) root.style.width = `${Math.max(0, width.x)}px`
    if (anchor) layer.style.translate = `${frameOffset(width.x)}px 0`
    kind.paint(t)
  }
  function frame(now: number) {
    raf = 0
    if (!running || destroyed) return
    paint(now)
    if (now - started >= duration) stop(true)
    else raf = requestAnimationFrame(frame)
  }

  function commit(text: string, next: O, look?: unknown) {
    if (destroyed) return
    // Called on every render: the same text, options and look (the props that can restyle the label: class, style,
    // lang, dir) need no layout read (getBoundingClientRect, a Range per piece). Size changes are the
    // ResizeObserver's and font loads the font set's to catch. Callbacks drop out of JSON; the rest stays in.
    const nextKey = JSON.stringify([text, next, look])
    if (layout && nextKey === key) {
      options = next
      return
    }
    const nextLook = JSON.stringify(look)
    const restyled = nextLook !== lookKey
    lookKey = nextLook
    key = nextKey
    const previous = options
    options = next
    if (previous && previous.width !== next.width) {
      stop(false)
      originalWidth = next.width; fit = !originalWidth
      root.style.width = originalWidth
    }
    const measured = kind.measure(text, next)
    const old = layout
    layout = measured
    if (!old) { width = axis(measured.width); return }
    const still = !next.animate || mq.matches || !kind.animatable(old, measured, previous, next)
    if (old.text === text) {
      if (still || restyled || sizeChanged(old, measured)) { stop(false); width = axis(measured.width) }
      return
    }
    if (still) { stop(false); width = axis(measured.width); return }
    const now = performance.now()
    if (running) {
      paint(now)
      cancelAnimationFrame(raf); raf = 0
      const cancel = cancellation
      running = false; completion = cancellation = undefined
      cancel?.()
    } else {
      originalWidth = root.style.width; fit = !originalWidth
      inlineOpacity = content.style.opacity
      width = axis(old.width)
      kind.begin(old, next)
    }
    retarget(measured.width)
    duration = Math.max(kind.transition(old, measured, next, anchor > 0), move(width, measured.width, next))
    started = now
    content.style.opacity = '0'
    completion = next.onAnimationComplete; cancellation = next.onAnimationCancel
    running = true
    paint(now)
    next.onAnimationStart?.()
    if (duration <= 0) stop(true)
    else raf = requestAnimationFrame(frame)
  }
  /** Find which edge the label grows from (see anchor) and move the parts into the new frame. */
  function retarget(to: number) {
    const before = frameOffset(width.x), inline = root.style.width
    // Two reads of the root's box: at its current width and at its final one.
    const box = (w: number) => ((root.style.width = `${w}px`), root.getBoundingClientRect())
    const a = fit ? box(width.x) : undefined, b = fit ? box(to) : undefined
    root.style.width = inline
    const grew = b ? b.width - a!.width : 0
    anchor = Math.abs(grew) > 0.5 ? Math.min(1, Math.max(0, (a!.left - b!.left) / grew)) : 0
    if (anchor < 0.01) anchor = 0
    endWidth = to
    kind.shift(before - frameOffset(width.x))
    layer.style.translate = ''
  }
  function refresh(force = false) {
    if (!layout || destroyed) return
    // The observer reports on start and on any resize around the label. Unless its own box changed (or fonts loaded,
    // or reduced motion turned on), there is nothing to remeasure: skip the full measurement (a Range read per piece).
    // A hidden label has no size (NaN): it is measured when it shows, which the observer reports too.
    if (!force && !mq.matches) {
      const cs = getComputedStyle(content)
      if (!sizeChanged({ width: parseFloat(cs.width), height: parseFloat(cs.height) }, layout)) return
    }
    const next = kind.measure(layout.text, options)
    if (force || sizeChanged(next, layout) || mq.matches) {
      layout = next; stop(false); width = axis(next.width)
    }
  }
  const ro = new ResizeObserver(() => refresh())
  const onPreference = () => refresh()
  const onFonts = () => refresh(true)
  ro.observe(content)
  mq.addEventListener?.('change', onPreference)
  document.fonts?.addEventListener('loadingdone', onFonts)
  return {
    commit,
    destroy() {
      destroyed = true
      ro.disconnect(); mq.removeEventListener?.('change', onPreference)
      document.fonts?.removeEventListener('loadingdone', onFonts)
      stop(false)
    },
  }
}
