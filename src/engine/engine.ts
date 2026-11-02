import { crossings, mod, nearest, release, rubberClamp, spring, velocityTracker } from '../physics'
import type { Bounds, Motion } from '../physics'
import { resolvePhysics, type PhysicsOptions } from '../presets'

export type Mode = 'idle' | 'drag' | 'coast' | 'spring' | 'wheel'
export type Orientation = 'vertical' | 'horizontal'
/**
 * How the mouse wheel and trackpad drive the wheel.
 * - `'auto'` (default): each gesture is read from its first event. A notched mouse wheel steps one row per notch
 *   (`wheelStep`); its fast, accelerated bursts become velocity instead, so the wheel moves continuously while they
 *   come and coasts briefly (≈200 ms) once they stop. A trackpad is followed 1:1, momentum included.
 * - `'step'`: every wheel event is a notch: `wheelStep` rows (a page for page-mode deltas), whatever its size.
 *   Never a throw; a fast spin is one row per event.
 * - `'smooth'`: every delta is followed 1:1 in pixels, like native scrolling, mouse wheels included.
 * In every mode the wheel lands on a row once the events stop.
 */
export type WheelMode = 'auto' | 'step' | 'smooth'
/**
 * Holding an arrow key: after each `[ms, rate]` stage, the key's repeat moves `rate` rows per repeat instead of one.
 * On by default (`true`: `[[2000, 1.5], [4000, 2.5]]`); `false` keeps one row per repeat. Steps still land only on
 * enabled rows; letting go settles at once.
 */
export type KeyAcceleration = boolean | [ms: number, rate: number][]

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
  keyAcceleration?: KeyAcceleration
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
  /** Turn to item `index` by the shortest way round (loop-aware); a disabled item turns to its nearest enabled one. */
  scrollTo(index: number, animate?: boolean): void
  /** Re-base after rows were inserted/removed: moves everything by `rows` without motion. */
  shift(rows: number): void
  readonly x: number
  readonly v: number
  readonly mode: Mode
  /** Virtual index currently centered. */
  readonly index: number
  /** Where the current (or last) motion is headed, as a virtual index: the release planner's row. */
  readonly target: number
  /** Position (rows) the current motion started from. Progress = (x − from) / (target − from). */
  readonly from: number
}

const IDLE = 80 // ms without wheel events that ends a wheel gesture
/** Rows per px of accelerated mouse-wheel delta (macOS deltas are document pixels, far larger than rows). */
const WHEEL_GAIN = 0.005
/** Coast retention for mouse-wheel flings (τ ≈ 200ms): a short, natural glide after the wheel stops. */
const WHEEL_DECAY = 0.995
const TYPEAHEAD_RESET = 600
const ACCEL: [number, number][] = [
  [2000, 1.5],
  [4000, 2.5],
]

export function createEngine(initialIndex: number, options: EngineOptions): Engine {
  let o = options
  let p = resolvePhysics(o)
  let raw = initialIndex * Math.max(1, o.itemSize || 0)
  let v = 0
  let mode: Mode = 'idle'
  let motion: Motion | null = null
  let t0 = 0
  let raf = 0
  let target = initialIndex
  let from = initialIndex
  let shown = raw
  let el: HTMLElement | null = null
  let reduced = false
  const tracker = velocityTracker()

  const size = () => Math.max(1, o.itemSize || 0) // a 0/negative/NaN size would make every position NaN
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
    if (m === mode) return
    mode = m // not inside onMode?.(…): optional chaining would skip the assignment when there is no callback
    o.onMode?.(m)
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
    from = raw / size()
    t0 = Math.min(at, performance.now())
    if (m.duration <= 0) {
      raw = m.to
      return rest()
    }
    setMode(m.at(0).phase) // spinning from now, not from the next frame
    if (!raf) raf = requestAnimationFrame(frame)
  }

  /**
   * Bring the position and velocity up to now. Input that changes a running motion (a wheel event, a key) can come
   * several times between frames; each must continue from where the motion is now, not from the last painted
   * frame, or every event restarts the motion's clock and the wheel stalls for as long as the events keep coming.
   */
  function catchUp() {
    if (!motion) return
    const s = motion.at(Math.max(0, performance.now() - t0))
    raw = s.x
    v = s.v
  }

  /** Release at the current position with velocity `vel`: project, snap, glide. */
  function fling(vel: number, at?: number, decay?: number) {
    catchUp()
    const ph = decay ? { ...physics(), decay } : physics()
    const r = release(raw, reduced ? 0 : vel, size(), bounds(), reduced ? { ...ph, snapDuration: 200 } : ph)
    target = r.index
    run(r, at)
  }

  function goTo(index: number, animate = true) {
    catchUp()
    target = index
    if (!animate || reduced || !el) {
      stop()
      raw = index * size()
      return rest()
    }
    run(spring(raw, index * size(), v, p.spring, p.snapDuration, 0.5 / dpr()))
  }

  /** Turn to item `index`, or the nearest enabled one: like keys and gestures, never onto a disabled item. */
  function scrollTo(item: number, animate?: boolean) {
    // The nearest enabled item, counted the way round the end when looping (in a loop of 5, item 4 is one step
    // from item 0).
    const n = nearest(Math.round(item), bounds())
    if (n !== n) return // nothing enabled
    if (!o.loop) return goTo(n, animate)
    const i = mod(n, o.count)
    const base = motion ? target : center()
    let k = mod(i - base, o.count)
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
    // A tap. On the centered row it belongs to the row's content (a button there just works). On any
    // other row it turns the wheel to that row, and the click must not reach the content.
    const i = rowAt(e.clientX, e.clientY)
    if (i === i && i !== center() && nearest(i, bounds()) === i) {
      suppress = e.timeStamp + 400
      goTo(i)
    }
  }

  /** The row under a point: rows tile the axis, so it is the one whose center is nearest (geometry
   * works through inert rows and drum transforms, unlike hit-testing). */
  function rowAt(x: number, y: number) {
    let best = NaN
    let dist = Infinity
    for (const r of el?.querySelectorAll<HTMLElement>('[data-detent-index]') ?? []) {
      const b = r.getBoundingClientRect()
      const d = horizontal() ? Math.abs(x - b.left - b.width / 2) : Math.abs(y - b.top - b.height / 2)
      if (d < dist) (dist = d), (best = +r.dataset.detentIndex!)
    }
    return best
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
  // A wheel *gesture* is a run of events with gaps < IDLE, classified once from its first event:
  // - mouse (notches): it starts with a whole notch. macOS reports 12–13px per notch (and wheelDelta = −3 ×
  //   delta, exactly like a trackpad, so that signal can't tell them apart); Windows 100px with wheelDelta
  //   ±120; Firefox uses line mode. Trackpads always start at 1–3px, because fingers start slowly.
  // - ours or the page's: its dominant axis must match the wheel's (mouse notches always drive the wheel).
  let wheelAt = -1e9
  let wheelTimer: ReturnType<typeof setTimeout> | undefined
  let notched = false
  /** wheelMode 'step': every event is one notch, whatever its size (never a throw). */
  let stepping = false
  let ours = false
  let rate = 0

  function wheel(e: WheelEvent & { wheelDeltaX?: number; wheelDeltaY?: number }) {
    if (o.disabled) return
    const h = horizontal()
    const x = Math.abs(e.deltaX) > Math.abs(e.deltaY)
    const d = x ? e.deltaX : e.deltaY
    if (!d) return
    const a = Math.abs(d)
    const wd = x ? e.wheelDeltaX : e.wheelDeltaY
    const classic = e.deltaMode !== 0 || (!!wd && wd % 120 === 0 && wd !== -3 * d) // line mode, or Windows-style
    const gap = e.timeStamp - wheelAt
    if (gap > IDLE) {
      const wm = o.wheelMode ?? 'auto'
      stepping = wm === 'step'
      notched = stepping || (wm === 'auto' && (classic || a >= 10))
      // A plain mouse wheel (vertical notches) also drives horizontal wheels.
      ours = notched || x === h
      rate = 0
    }
    wheelAt = e.timeStamp
    if (!ours) return // a vertical trackpad gesture over a horizontal wheel scrolls the page
    e.preventDefault()
    // Horizontal deltas follow screen direction (mirrored in RTL); vertical notches mean "next".
    const delta = x ? d * sign() : d
    if (notched) {
      // One notch, one row (repeated notches accumulate on the target).
      const notch = e.deltaMode === 2 ? o.visibleCount - 1 : (o.wheelStep ?? 1)
      if (classic || a < 50 || stepping) return step(Math.sign(delta) * notch)
      // An accelerated burst (macOS: 100–1800px every ~15ms when the wheel spins fast or free): following those
      // pixels would teleport dozens of rows per event. Turn the wheel's rate into velocity instead, and let the
      // physics glide and land, with a shorter coast than a throw (when the mouse wheel stops, so should we).
      const r = a / Math.max(8, Math.min(100, gap))
      rate = rate ? rate + (r - rate) * 0.5 : r
      const target = Math.sign(delta) * Math.min(p.maxVelocity, WHEEL_GAIN * rate * size())
      return fling(v * target > 0 ? v + (target - v) * 0.5 : target, undefined, WHEEL_DECAY)
    }
    // Smooth (trackpad, incl. OS momentum): follow it 1:1 along our axis only (a two-finger swipe always
    // carries some cross-axis motion, which must not leak in), settle once it goes quiet.
    const along = h ? e.deltaX * sign() : e.deltaY
    if (mode !== 'wheel') {
      stop()
      tracker.reset()
      setMode('wheel')
    }
    raw += along
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
  /** The arrow key being held, since when, and the fraction of a row its repeats have built up. */
  let held = ''
  let heldAt = 0
  let carry = 0
  const letGo = () => (held = '')

  function arrow(dir: number, e: KeyboardEvent) {
    const a = o.keyAcceleration ?? true
    if (!a || !e.repeat || e.key !== held) {
      held = e.key
      heldAt = e.timeStamp
      carry = 0
      return step(dir)
    }
    let rate = 1
    for (const [ms, r] of a === true ? ACCEL : a) if (e.timeStamp - heldAt >= ms) rate = r
    const rows = Math.floor((carry += rate))
    carry -= rows
    // Never far ahead of what is on screen (2 + 2 × rate rows, so plain repeats are never held back): when the
    // key comes up, the wheel settles on its spring instead of trailing on for seconds.
    if (rows && Math.abs((motion ? target : center()) - raw / size()) < 2 + 2 * rate) step(dir * rows)
  }

  function key(e: KeyboardEvent) {
    if (o.disabled || e.altKey || e.ctrlKey || e.metaKey || editable(e)) return
    const h = horizontal()
    const page = Math.max(1, o.visibleCount - 1)
    const b = bounds()
    const k = e.key
    const fwd = sign() < 0 ? 'ArrowLeft' : 'ArrowRight'
    const back = sign() < 0 ? 'ArrowRight' : 'ArrowLeft'
    if (k === 'ArrowDown' || (h && k === fwd)) arrow(1, e)
    else if (k === 'ArrowUp' || (h && k === back)) arrow(-1, e)
    else if (k === 'PageDown') step(page)
    else if (k === 'PageUp') step(-page)
    else if (k === 'Home' || k === 'End') {
      const end = k === 'End'
      const flat = { ...b, loop: false, min: o.loop ? 0 : lo(), max: o.loop ? o.count - 1 : hi() }
      const i = nearest(end ? flat.max : flat.min, flat, end ? -1 : 1)
      if (i === i) scrollTo(i)
    } else if (o.getLabel && k.length === 1 && o.count && e.target === el) {
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
    // From a control inside a row: keep focus on the wheel (that row may turn inert off-center).
    if (e.target !== el) el?.focus({ preventScroll: true })
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  const noDrag = (e: Event) => e.preventDefault() // images/links in rows must not start native drag & drop
  const on: [string, (e: never) => void, AddEventListenerOptions?][] = [
    ['pointerdown', down],
    ['wheel', wheel, { passive: false }],
    ['keydown', key],
    ['keyup', letGo],
    ['focusout', letGo],
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
      const was = size()
      o = { ...o, ...next }
      p = resolvePhysics(o)
      // A new row size keeps the same rows centered: positions are px, so rescale them (and any motion in
      // flight) instead of letting the index drift (2 rows at 40px would read as 1 row at 80px).
      const k = size() / was
      if (k !== 1) {
        raw *= k
        shown *= k
        startRaw *= k
        tracker.reset()
        const m = motion
        if (m) motion = { to: m.to * k, duration: m.duration, at: (t) => ((s) => ({ ...s, x: s.x * k, v: s.v * k }))(m.at(t)) }
        render()
      }
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
    get target() {
      return target
    },
    get from() {
      return from
    },
  }
}
