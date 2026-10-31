import { crossings, mod, nearest, release, rubberClamp, spring, velocityTracker } from '../physics'
import type { Bounds, Motion } from '../physics'
import { resolvePhysics, type PhysicsOptions } from '../presets'

export type Mode = 'idle' | 'drag' | 'coast' | 'spring' | 'wheel'
export type Orientation = 'vertical' | 'horizontal'
export type WheelMode = 'auto' | 'step' | 'smooth'

/**
 * Positions are "virtual" indexes along the wheel: items are 0..count-1, a header row is -1, extra
 * rows (loading, footer) follow the items. When looping, virtual indexes are unbounded.
 */
export interface EngineOptions extends PhysicsOptions {
  count: number
  itemSize: number
  visibleCount: number
  loop?: boolean
  /** Lowest virtual index the wheel may rest on (default 0). Ignored when looping. */
  min?: number
  /** Highest virtual index the wheel may rest on (default count - 1). Ignored when looping. */
  max?: number
  /** Whether the wheel may rest on virtual index `i` (unwrapped). */
  isEnabled?: (i: number) => boolean
  /** Text of item `i` (0..count-1), for typeahead. */
  getLabel?: (i: number) => string
  orientation?: Orientation
  /** Right-to-left: horizontal wheels run from the right, and ← moves forward. */
  rtl?: boolean
  disabled?: boolean
  dragThreshold?: number
  dragRatio?: number
  wheelStep?: number
  wheelMode?: WheelMode
  /** Every frame (and on any position change): display position in px, device-pixel-rounded when slow. */
  onRender?: (x: number, v: number) => void
  onMode?: (mode: Mode) => void
  /** A row crossed the center. `index` is virtual (unwrapped). */
  onTick?: (index: number, velocity: number) => void
  /** The wheel came to rest on virtual index `index`. */
  onSettle?: (index: number) => void
}

export interface Engine {
  attach(el: HTMLElement): () => void
  set(options: Partial<EngineOptions>): void
  /** Re-render the current position (after layout-affecting option changes). */
  sync(): void
  /** Turn to virtual index `index` (spring), or jump when `animate` is false or motion is reduced. */
  goTo(index: number, animate?: boolean): void
  /** Turn to item `index` by the shortest way round (loop-aware). */
  scrollTo(index: number, animate?: boolean): void
  /** Re-base after rows were inserted/removed: moves everything by `rows` without motion. */
  shift(rows: number): void
  readonly x: number
  readonly v: number
  readonly mode: Mode
  /** Virtual index currently centered. */
  readonly index: number
}

const IDLE = 80 // ms without wheel events that ends a wheel gesture
const TYPEAHEAD_RESET = 600

export function createEngine(initialIndex: number, options: EngineOptions): Engine {
  let o = options
  let p = resolvePhysics(o)
  let raw = initialIndex * o.itemSize
  let v = 0
  let mode: Mode = 'idle'
  let motion: Motion | null = null
  let t0 = 0
  let raf = 0
  let target = initialIndex
  let shown = raw
  let el: HTMLElement | null = null
  let reduced = false
  const tracker = velocityTracker()

  const size = () => o.itemSize
  const horizontal = () => o.orientation === 'horizontal'
  /** −1 when a horizontal wheel runs right-to-left: screen deltas map to the wheel reversed. */
  const sign = () => (o.rtl && horizontal() ? -1 : 1)
  const dpr = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  const lo = () => o.min ?? 0
  const hi = () => o.max ?? o.count - 1
  const bounds = (): Bounds => ({ min: lo(), max: hi(), loop: !!o.loop, count: o.count, enabled: o.isEnabled })
  const center = () => Math.round(raw / size())
  const display = () =>
    o.loop ? raw : rubberClamp(raw, lo() * size(), Math.max(lo(), hi()) * size(), size() * o.visibleCount, 0.55 * p.rubberBand)
  const physics = () => ({ ...p, restDelta: 0.5 / dpr() })

  function setMode(m: Mode) {
    if (m !== mode) o.onMode?.((mode = m))
  }

  function render() {
    const x = display()
    crossings(shown, x, size(), (i) => o.onTick?.(i, v))
    shown = x
    // Slow or still: snap to device pixels so text stays crisp during the final approach.
    o.onRender?.(Math.abs(v) < 0.05 ? Math.round(x * dpr()) / dpr() : x, v)
  }

  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
    motion = null
  }

  function rest() {
    stop()
    v = 0
    render()
    setMode('idle')
    o.onSettle?.(center())
  }

  function frame(now: number) {
    raf = 0
    const m = motion
    if (!m) return
    const t = Math.max(0, now - t0)
    const s = m.at(t)
    raw = s.x
    v = s.v
    if (t >= m.duration) return rest()
    setMode(s.phase)
    render()
    raf = requestAnimationFrame(frame)
  }

  /**
   * Start a motion at `at` (rAF/event clock). For a release that is the last on-screen drag position's
   * time: rAF timestamps are frame-start times and can precede the handler, so starting at
   * performance.now() would stall the first frame.
   */
  function run(m: Motion, at = performance.now()) {
    motion = m
    t0 = Math.min(at, performance.now())
    if (m.duration <= 0) {
      raw = m.to
      return rest()
    }
    setMode(m.at(0).phase) // spinning from now, not from the next frame
    if (!raf) raf = requestAnimationFrame(frame)
  }

  /** Release at the current position with velocity `vel`: project, snap, glide. */
  function fling(vel: number, at?: number) {
    const r = release(raw, reduced ? 0 : vel, size(), bounds(), reduced ? { ...physics(), snapDuration: 200 } : physics())
    target = r.index
    run(r, at)
  }

  function goTo(index: number, animate = true) {
    target = index
    if (!animate || reduced || !el) {
      stop()
      raw = index * size()
      return rest()
    }
    run(spring(raw, index * size(), v, p.spring, p.snapDuration, 0.5 / dpr()))
  }

  function scrollTo(item: number, animate?: boolean) {
    if (!o.loop) return goTo(item, animate)
    const base = motion ? target : center()
    let k = mod(item - base, o.count)
    if (k > o.count / 2) k -= o.count
    goTo(base + k, animate)
  }

  /** Step from the current target (so repeated keys/notches accumulate) by `rows`. */
  function step(rows: number) {
    const base = motion ? target : center()
    const next = nearest(base + rows, bounds(), rows)
    if (next === next && next !== base) goTo(next)
  }

  /** Events from form fields inside rows (e.g. a search header) belong to the field, not the wheel. */
  const editable = (e: Event) => !!(e.target as Element).closest?.('input,textarea,select,[contenteditable]')

  // ── Pointer ─────────────────────────────────────────────────────────────
  let pid: number | null = null
  let start = 0
  let startRaw = 0
  let dragging = false
  let movedAt = 0 // timeStamp of the last move that changed the position (what is on screen)
  let movedFrame = 0 // the animation frame that move was painted in (rAF clock)
  let caught = false
  let suppress = 0
  const axis = (e: { clientX: number; clientY: number }) => (horizontal() ? e.clientX : e.clientY) * sign()
  const finger = (e: { clientX: number; clientY: number }) => -axis(e) * (o.dragRatio ?? 1)

  function down(e: PointerEvent) {
    if (o.disabled || pid !== null || (e.pointerType === 'mouse' && e.button) || editable(e)) return
    pid = e.pointerId
    caught = !!motion
    stop() // grabbing a moving wheel stops it exactly where it is
    v = 0
    suppress = 0
    if (caught) {
      render()
      setMode('drag')
    }
    start = axis(e)
    startRaw = raw
    dragging = false
    tracker.reset()
    tracker.push(e.timeStamp, finger(e))
    track(addEventListener)
  }

  function move(e: PointerEvent) {
    if (e.pointerId !== pid) return
    if (e.pointerType === 'mouse' && !e.buttons) return up(e) // released where we could not see it
    const list = e.getCoalescedEvents?.() ?? []
    for (const c of list.length ? list : [e]) tracker.push(c.timeStamp, finger(c))
    if (!dragging) {
      if (Math.abs(axis(e) - start) < (o.dragThreshold ?? 5)) return
      dragging = true
      start = axis(e) // start from here: no jump by the threshold
      try {
        el?.setPointerCapture(e.pointerId)
      } catch {}
      el?.setAttribute('data-dragging', '')
      setMode('drag')
    }
    raw = startRaw - (axis(e) - start) * (o.dragRatio ?? 1)
    v = tracker.get(e.timeStamp) // live finger speed, so ticks during a drag carry velocity too
    movedAt = e.timeStamp
    // Frame time, not event time: a move handled late in a busy frame has a late timeStamp, and
    // anchoring the coast to it would shortchange the first coast frame (a visible hitch).
    movedFrame = Number(document.timeline?.currentTime ?? e.timeStamp)
    render()
  }

  /** Follow the pointer on the window: releases outside the element (or the window) still land. */
  const track = (f: typeof addEventListener) => {
    f('pointermove', move)
    f('pointerup', up)
    f('pointercancel', cancel)
    f('blur', cancel)
  }

  function end() {
    track(removeEventListener)
    el?.removeAttribute('data-dragging')
    pid = null
  }

  function up(e: PointerEvent) {
    if (e.pointerId !== pid) return
    end()
    if (dragging) {
      suppress = e.timeStamp + 400 // the click that ends a drag never selects
      // Continue from the frame that showed the last drag position, so the first coast frame carries
      // a full frame of travel (no stall), unless the finger rested before lifting.
      return fling(tracker.get(e.timeStamp), e.timeStamp - movedAt < 50 ? movedFrame : e.timeStamp)
    }
    if (caught) return fling(0)
    // A click: turn to the row under the pointer.
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-detent-index]')
    const i = hit && el?.contains(hit) ? Number(hit.dataset.detentIndex) : NaN
    if (i === i && nearest(i, bounds()) === i) goTo(i)
  }

  function cancel() {
    if (pid === null) return
    end()
    fling(0)
  }

  function click(e: MouseEvent) {
    if (suppress && e.timeStamp < suppress) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // ── Wheel & trackpad ────────────────────────────────────────────────────
  // A wheel *gesture* is a run of events with gaps < IDLE. Its kind (notches vs smooth) and whether it
  // is ours (its dominant axis matches the wheel's) are decided from its first event, so trackpad
  // momentum keeps its classification, and a clearly cross-axis gesture is left to the page.
  let wheelAt = -1e9
  let wheelTimer: ReturnType<typeof setTimeout> | undefined
  let notched = false
  let ours = false

  function wheel(e: WheelEvent & { wheelDeltaX?: number; wheelDeltaY?: number }) {
    if (o.disabled) return
    const h = horizontal()
    const x = Math.abs(e.deltaX) > Math.abs(e.deltaY)
    const d = x ? e.deltaX : e.deltaY
    if (!d) return
    if (e.timeStamp - wheelAt > IDLE) {
      const wd = x ? e.wheelDeltaX : e.wheelDeltaY
      const wm = o.wheelMode ?? 'auto'
      notched =
        wm === 'step' ||
        (wm === 'auto' && (e.deltaMode !== 0 || (wd ? wd % 120 === 0 && wd !== -3 * d : Math.abs(d) >= 50)))
      // A plain mouse wheel (vertical notches) also drives horizontal wheels.
      ours = notched || x === h
    }
    wheelAt = e.timeStamp
    if (!ours) return // a vertical trackpad gesture over a horizontal wheel scrolls the page
    e.preventDefault()
    // Horizontal deltas follow screen direction (mirrored in RTL); vertical notches mean "next".
    const delta = x ? d * sign() : d
    if (notched) return step(Math.sign(delta) * (e.deltaMode === 2 ? o.visibleCount - 1 : o.wheelStep ?? 1))
    // Smooth (trackpad, incl. OS momentum): follow it 1:1, settle once it goes quiet.
    if (mode !== 'wheel') {
      stop()
      tracker.reset()
      setMode('wheel')
    }
    raw += delta
    if (!o.loop) {
      // OS momentum into an end would push raw far out; keep it within one viewport of rubber band.
      const cap = size() * o.visibleCount
      raw = Math.max(lo() * size() - cap, Math.min(hi() * size() + cap, raw))
    }
    tracker.push(e.timeStamp, raw)
    v = tracker.get(e.timeStamp)
    render()
    clearTimeout(wheelTimer)
    const at = e.timeStamp
    wheelTimer = setTimeout(() => mode === 'wheel' && fling(tracker.get(at)), IDLE)
  }

  // ── Keyboard ────────────────────────────────────────────────────────────
  let typed = ''
  let typedAt = 0

  function key(e: KeyboardEvent) {
    if (o.disabled || e.altKey || e.ctrlKey || e.metaKey || editable(e)) return
    const h = horizontal()
    const page = Math.max(1, o.visibleCount - 1)
    const b = bounds()
    const k = e.key
    const fwd = sign() < 0 ? 'ArrowLeft' : 'ArrowRight'
    const back = sign() < 0 ? 'ArrowRight' : 'ArrowLeft'
    if (k === 'ArrowDown' || (h && k === fwd)) step(1)
    else if (k === 'ArrowUp' || (h && k === back)) step(-1)
    else if (k === 'PageDown') step(page)
    else if (k === 'PageUp') step(-page)
    else if (k === 'Home' || k === 'End') {
      const end = k === 'End'
      const flat = { ...b, loop: false, min: o.loop ? 0 : lo(), max: o.loop ? o.count - 1 : hi() }
      const i = nearest(end ? flat.max : flat.min, flat, end ? -1 : 1)
      if (i === i) scrollTo(i)
    } else if (o.getLabel && k.length === 1 && o.count) {
      typed = e.timeStamp - typedAt > TYPEAHEAD_RESET ? k.toLowerCase() : typed + k.toLowerCase()
      typedAt = e.timeStamp
      const from = mod(motion ? target : center(), o.count)
      for (let j = typed.length > 1 ? 0 : 1; j <= o.count; j++) {
        const i = mod(from + j, o.count)
        if ((!o.isEnabled || o.isEnabled(i)) && o.getLabel(i).toLowerCase().startsWith(typed)) {
          scrollTo(i)
          break
        }
      }
    } else return
    e.preventDefault()
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  const noDrag = (e: Event) => e.preventDefault() // images/links in rows must not start native drag & drop
  const on: [string, (e: never) => void, AddEventListenerOptions?][] = [
    ['pointerdown', down],
    ['wheel', wheel, { passive: false }],
    ['keydown', key],
    ['click', click, { capture: true }],
    ['dragstart', noDrag],
  ]

  function attach(node: HTMLElement) {
    el = node
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => (reduced = mq.matches)
    onMq()
    mq.addEventListener?.('change', onMq)
    for (const [t, f, opt] of on) node.addEventListener(t, f as EventListener, opt)
    render()
    return () => {
      mq.removeEventListener?.('change', onMq)
      for (const [t, f, opt] of on) node.removeEventListener(t, f as EventListener, opt)
      if (pid !== null) end()
      clearTimeout(wheelTimer)
      stop()
      el = null
    }
  }

  function shift(rows: number) {
    const dx = rows * size()
    raw += dx
    shown += dx
    startRaw += dx
    target += rows
    const m = motion
    if (m) motion = { to: m.to + dx, duration: m.duration, at: (t) => ({ ...m.at(t), x: m.at(t).x + dx }) }
    render()
  }

  return {
    attach,
    set(next) {
      o = { ...o, ...next }
      p = resolvePhysics(o)
    },
    sync: render,
    goTo,
    scrollTo,
    shift,
    get x() {
      return display()
    },
    get v() {
      return v
    },
    get mode() {
      return mode
    },
    get index() {
      return center()
    },
  }
}
