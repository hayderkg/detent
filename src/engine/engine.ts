import { crossings, mod, nearest, release, rubberClamp, spring, velocityTracker } from '../physics'
import type { Bounds, Motion } from '../physics'
import { resolvePhysics, type PhysicsOptions } from '../presets'

export type Mode = 'idle' | 'drag' | 'coast' | 'spring' | 'wheel'
export type Orientation = 'vertical' | 'horizontal'
export type WheelMode = 'auto' | 'step' | 'smooth'

export interface EngineOptions extends PhysicsOptions {
  count: number
  itemSize: number
  visibleCount: number
  loop?: boolean
  /** Lowest restable index; -1 when there is a header row. */
  min?: number
  /** Whether item `index` (wrapped, 0..count-1) can be selected. Negative indexes are header rows. */
  isEnabled?: (index: number) => boolean
  /** Text for typeahead. */
  getLabel?: (index: number) => string
  orientation?: Orientation
  disabled?: boolean
  dragThreshold?: number
  dragRatio?: number
  wheelStep?: number
  wheelMode?: WheelMode
  /** Every frame (and on any position change): display position in px, already device-pixel-rounded when slow. */
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
  /** Turn to virtual index `index` (spring), or jump when `animate` is false or motion is reduced. */
  goTo(index: number, animate?: boolean): void
  /** Turn to item `index` by the shortest way round (loop-aware). */
  scrollTo(index: number, animate?: boolean): void
  /** Re-base after rows were inserted/removed above the selection: moves everything by `rows` without motion. */
  shift(rows: number): void
  readonly x: number
  readonly v: number
  readonly mode: Mode
  /** Virtual index currently centered. */
  readonly index: number
}

const SMOOTH_IDLE = 80 // ms of no trackpad events before snapping
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
  const dpr = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  const bounds = (): Bounds => ({
    min: o.min ?? 0,
    max: o.count - 1,
    loop: !!o.loop,
    count: o.count,
    enabled: (i) => i < 0 || !o.isEnabled || o.isEnabled(o.loop ? mod(i, o.count) : i),
  })
  const center = () => Math.round(raw / size())
  const display = () => {
    if (o.loop) return raw
    const lo = (o.min ?? 0) * size()
    const hi = Math.max(lo, (o.count - 1) * size())
    return rubberClamp(raw, lo, hi, size() * o.visibleCount, 0.55 * p.rubberBand)
  }
  const physics = () => ({ ...p, restDelta: 0.5 / dpr() })

  function setMode(m: Mode) {
    if (m === mode) return
    mode = m
    o.onMode?.(m)
  }

  function render() {
    const x = display()
    crossings(shown, x, size(), (i) => o.onTick?.(i, v))
    shown = x
    // Slow or still: snap to device pixels so text stays crisp during the final approach.
    const r = Math.abs(v) < 0.05 ? Math.round(x * dpr()) / dpr() : x
    o.onRender?.(r, v)
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf)
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

  function run(m: Motion) {
    motion = m
    t0 = performance.now()
    if (m.duration <= 0) {
      raw = m.to
      return rest()
    }
    if (!raf) raf = requestAnimationFrame(frame)
  }

  /** Release at the current position with velocity `vel`: project, snap, glide. */
  function fling(vel: number) {
    if (o.count <= 0) return rest()
    const r = release(raw, reduced ? 0 : vel, size(), bounds(), reduced ? { ...physics(), snapDuration: 200 } : physics())
    target = r.index
    run(r)
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
    let k = item - mod(base, o.count)
    if (k > o.count / 2) k -= o.count
    if (k < -o.count / 2) k += o.count
    goTo(base + k, animate)
  }

  /** Step from the current target (so repeated keys/notches accumulate) by `rows`. */
  function step(rows: number) {
    const base = motion ? target : center()
    const next = nearest(base + rows, bounds(), rows)
    if (next === next && next !== base) goTo(next)
  }

  // ── Pointer ─────────────────────────────────────────────────────────────
  let pid: number | null = null
  let start = 0
  let startRaw = 0
  let dragging = false
  let caught = false
  let suppress = 0
  const axis = (e: { clientX: number; clientY: number }) => (horizontal() ? e.clientX : e.clientY)
  const finger = (e: { clientX: number; clientY: number }) => -axis(e) * (o.dragRatio ?? 1)

  function down(e: PointerEvent) {
    if (o.disabled || pid !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
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
    if (e.pointerType === 'mouse') {
      e.preventDefault() // no text selection; we focus ourselves
      el?.focus({ preventScroll: true })
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', cancel)
    addEventListener('blur', cancel)
  }

  function move(e: PointerEvent) {
    if (e.pointerId !== pid) return
    if (e.pointerType === 'mouse' && e.buttons === 0) return up(e) // released where we could not see it
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
    render()
  }

  function end() {
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', cancel)
    removeEventListener('blur', cancel)
    el?.removeAttribute('data-dragging')
    pid = null
  }

  function up(e: PointerEvent) {
    if (e.pointerId !== pid) return
    end()
    if (dragging) {
      suppress = e.timeStamp + 400 // the click that ends a drag never selects
      return fling(tracker.get(e.timeStamp))
    }
    if (caught) return fling(0)
    // A click: turn to the row under the pointer.
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-detent-index]')
    const i = hit && el?.contains(hit) ? Number(hit.dataset.detentIndex) : NaN
    if (i === i && bounds().enabled!(i)) goTo(i)
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
  let wheelAt = -1e9
  let wheelTimer: ReturnType<typeof setTimeout> | undefined
  let smoothAt = 0

  function wheel(e: WheelEvent) {
    if (o.disabled) return
    e.preventDefault()
    const d = horizontal() ? e.deltaX || e.deltaY : e.deltaY
    if (!d) return
    const gap = e.timeStamp - wheelAt
    wheelAt = e.timeStamp
    const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
    const wm = o.wheelMode ?? 'auto'
    const discrete =
      wm === 'step' ||
      (wm === 'auto' &&
        mode !== 'wheel' &&
        (e.deltaMode !== 0 ||
          (!!wd && wd % 120 === 0 && wd !== -3 * e.deltaY) ||
          (gap > SMOOTH_IDLE && Math.abs(d) >= 50)))
    if (discrete) {
      const rows = e.deltaMode === 2 ? o.visibleCount - 1 : o.wheelStep ?? 1
      return step(Math.sign(d) * rows)
    }
    // Smooth (trackpad, incl. OS momentum): follow it 1:1, settle once it goes quiet.
    if (mode !== 'wheel') {
      stop()
      v = 0
      tracker.reset()
      setMode('wheel')
    }
    raw += d
    if (!o.loop) {
      // OS momentum into an end would push raw far out; keep it within one viewport of rubber band.
      const cap = size() * o.visibleCount
      raw = Math.max((o.min ?? 0) * size() - cap, Math.min((o.count - 1) * size() + cap, raw))
    }
    smoothAt = e.timeStamp
    tracker.push(e.timeStamp, raw)
    v = tracker.get(e.timeStamp)
    render()
    clearTimeout(wheelTimer)
    wheelTimer = setTimeout(() => {
      if (mode === 'wheel') fling(tracker.get(smoothAt))
    }, SMOOTH_IDLE)
  }

  // ── Keyboard ────────────────────────────────────────────────────────────
  let typed = ''
  let typedAt = 0

  function key(e: KeyboardEvent) {
    if (o.disabled || e.altKey || e.ctrlKey || e.metaKey) return
    const h = horizontal()
    const page = Math.max(1, o.visibleCount - 1)
    const b = bounds()
    switch (e.key) {
      case h ? 'ArrowRight' : 'ArrowDown': step(1); break
      case h ? 'ArrowLeft' : 'ArrowUp': step(-1); break
      case 'PageDown': step(page); break
      case 'PageUp': step(-page); break
      case 'Home': o.loop ? scrollTo(nearest(0, { ...b, loop: false, max: o.count - 1 }, 1)) : goTo(nearest(b.min, b, 1)); break
      case 'End': o.loop ? scrollTo(nearest(o.count - 1, { ...b, loop: false }, -1)) : goTo(nearest(b.max, b, -1)); break
      default: {
        if (!o.getLabel || e.key.length !== 1 || o.count <= 0) return
        typed = e.timeStamp - typedAt > TYPEAHEAD_RESET ? e.key.toLowerCase() : typed + e.key.toLowerCase()
        typedAt = e.timeStamp
        const from = mod(motion ? target : center(), o.count)
        for (let k = typed.length > 1 ? 0 : 1; k <= o.count; k++) {
          const i = mod(from + k, o.count)
          if (b.enabled!(i) && o.getLabel(i).toLowerCase().startsWith(typed)) {
            scrollTo(i)
            break
          }
        }
      }
    }
    e.preventDefault()
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  function attach(node: HTMLElement) {
    el = node
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => (reduced = mq.matches)
    onMq()
    mq.addEventListener?.('change', onMq)
    node.addEventListener('pointerdown', down)
    node.addEventListener('wheel', wheel, { passive: false })
    node.addEventListener('keydown', key)
    node.addEventListener('click', click, true)
    render()
    return () => {
      mq.removeEventListener?.('change', onMq)
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('wheel', wheel)
      node.removeEventListener('keydown', key)
      node.removeEventListener('click', click, true)
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
    if (m) motion = { to: m.to + dx, duration: m.duration, at: (t) => { const s = m.at(t); return { ...s, x: s.x + dx } } }
    render()
  }

  return {
    attach,
    set(next) {
      o = { ...o, ...next }
      p = resolvePhysics(o)
    },
    goTo,
    scrollTo,
    shift,
    get x() { return display() },
    get v() { return v },
    get mode() { return mode },
    get index() { return center() },
  }
}
