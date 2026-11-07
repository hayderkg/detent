import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
  type RefCallback,
} from 'react'
import { flushSync } from 'react-dom'
import { createEngine, type Engine, type EngineOptions, type Mode, type KeyAcceleration, type Orientation, type WheelMode } from '../engine/engine'
import { mod } from '../physics/snap'
import type { PhysicsOptions } from '../presets'

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type Key = string | number

export interface DetentOptions<T> extends PhysicsOptions {
  items: readonly T[]
  /** Stable identity, so the selection survives items being inserted or removed. Defaults to the item for strings/numbers, else its index. */
  getKey?: (item: T, index: number) => Key
  /** Text for typeahead and screen-reader announcements. Defaults to String(item). */
  getLabel?: (item: T, index: number) => string
  /** Controlled selection (compared by key). */
  value?: T
  defaultValue?: T
  onChange?: (item: T, index: number) => void
  /**
   * Fire onChange when the wheel settles (default), or live on every row that crosses the center while a hand
   * turns it (drag, throw, mouse wheel, trackpad). Turns from keys, a tap on a row or a new `value` report only
   * where they land, so a parent's own value never comes back through the rows on the way.
   */
  changeOn?: 'settle' | 'tick'
  isDisabled?: (item: T, index: number) => boolean
  /** Row size in px along the scroll axis. */
  itemSize?: number
  /** Rows visible at once (odd). */
  visibleCount?: number
  loop?: boolean
  orientation?: Orientation
  /** Text direction. Detected from the DOM after mount; pass it to get RTL right in the server render. */
  dir?: 'ltr' | 'rtl'
  disabled?: boolean
  dragThreshold?: number
  dragRatio?: number
  wheelStep?: number
  wheelMode?: WheelMode
  /** Holding an arrow key speeds up after 2 s (×1.5) and 4 s (×2.5), or after your own `[ms, rate]` stages. On by default; `false` turns it off. */
  keyAcceleration?: KeyAcceleration
  /** A non-selectable row before the first item (e.g. a search field) that the wheel can rest on. Ignored when looping. */
  header?: boolean
  /** A non-selectable row after the last item that the wheel can rest on. Ignored when looping. */
  footer?: boolean
  /** Show a loading row after the last item (not restable), e.g. while onEndReached fetches more. */
  loading?: boolean
  onHeaderRest?: () => void
  onFooterRest?: () => void
  /**
   * Rows hold interactive content (buttons, links, inputs): rows off the center are inert, so Tab only
   * reaches the centered row's controls and a tap there activates them. Off-center taps turn the wheel.
   */
  interactive?: boolean
  /** Extra rows rendered beyond the visible ones on each side. */
  overscan?: number
  /** Animate programmatic value changes. */
  animate?: boolean
  /** Accessible name. */
  label?: string
  onTick?: (index: number, velocity: number) => void
  onSpinStart?: () => void
  onSpinEnd?: () => void
  onSettle?: (item: T, index: number) => void
  /** Continuous position in rows (float), every frame. */
  onScrollProgress?: (offset: number) => void
  onEndReached?: () => void
  /**
   * Rows from the end at which onEndReached fires, when the wheel moves that near the end (not as it mounts there
   * or as rows come in): once per list length, and again after `loading` ends without new rows (a failed or empty
   * load), the next time it moves there.
   */
  endReachedThreshold?: number
}

/** Props you pass in: any element ref is accepted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DetentElementPropsIn = HTMLAttributes<HTMLElement> & { ref?: Ref<any> }
/** Props you spread: a callback ref fits any element type. */
export type DetentElementProps = HTMLAttributes<HTMLElement> & { ref?: RefCallback<HTMLElement> }

interface Slot {
  /** Position on the wheel (virtual index). */
  virtual: number
  /** Distance from the center in rows at the last React render (live values are in CSS vars). */
  offset: number
  /** The wheel rests on this row. */
  selected: boolean
  getProps(props?: DetentElementPropsIn): DetentElementProps
}

export interface DetentRow<T> extends Slot {
  item: T
  /** Index in `items`. */
  index: number
  key: Key
  disabled: boolean
}

/** A non-item row (header, footer, loading), or null when it is off-screen or not enabled. */
export type DetentSlot = Slot | null

export interface DetentFrame {
  /** Position in rows (float). */
  offset: number
  /** px/ms */
  velocity: number
  mode: Mode
  /** Coast/spring only: the row the motion lands on (virtual index), and where it started (rows). */
  target: number
  from: number
}

export interface DetentApi<T> {
  getRootProps(props?: DetentElementPropsIn): DetentElementProps
  getTrackProps(props?: DetentElementPropsIn): DetentElementProps
  /** Visually hidden live region announcing the selection when the wheel settles. Render it next to the root, not inside it. */
  getLiveRegionProps(props?: DetentElementPropsIn): DetentElementProps
  rows: DetentRow<T>[]
  header: DetentSlot
  footer: DetentSlot
  loadingRow: DetentSlot
  selectedIndex: number
  selectedItem: T | undefined
  scrollTo(index: number, options?: { animate?: boolean }): void
  /** Per-frame position, outside React. Returns an unsubscribe function. */
  subscribe(fn: (frame: DetentFrame) => void): () => void
  /** Right-to-left (detected after mount, or from `dir`): horizontal wheels run from the right. */
  rtl: boolean
  engine: Engine
}

const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4)

/** The CSS variables of a row at distance `off` from the center. */
const vars = (off: number, visible: number): [string, string][] => {
  const abs = Math.abs(off)
  return [
    ['--offset', fmt(off)],
    ['--abs-offset', fmt(abs)],
    ['--progress', fmt(Math.max(0, 1 - abs / (visible / 2)))],
    ['--selected', abs < 0.5 ? '1' : '0'],
  ]
}

function merge(own: (el: HTMLElement | null) => void, theirs?: Ref<HTMLElement>): RefCallback<HTMLElement> {
  return (node) => {
    own(node)
    typeof theirs === 'function' ? theirs(node) : theirs && ((theirs as { current: HTMLElement | null }).current = node)
  }
}

/** Layout derived from the options: computed during render (pure), made live in the layout phase. */
interface Layout<T> {
  o: DetentOptions<T>
  keys: Key[]
  n: number
  size: number
  visible: number
  vertical: boolean
  loop: boolean
  /** Track offset that centers row 0. */
  base: number
  head: boolean
  loadAt: number
  footAt: number
}

/**
 * Everything stateful lives in this closure, created once per hook instance: plain locals instead of
 * refs and states (smaller, and no stale closures). React only re-renders when rows or selection change.
 *
 * Render stays pure: `derive` computes the next layout without touching live state, `api` builds the
 * render from it, and `commit` (layout phase) makes it live. A render React discards (transitions,
 * Suspense) leaves the engine and the event handlers on the layout that is actually on screen.
 */
function controller<T>(init: DetentOptions<T>, id: string, update: () => void) {
  // Keys, recomputed only when items or getKey change: a memo keyed by its inputs, safe to fill during render.
  let memo: { items?: readonly T[]; getKey?: DetentOptions<T>['getKey']; keys: Key[] } = { keys: [] }
  const keyFn =
    (o: DetentOptions<T>) =>
    (item: T, i: number): Key =>
      o.getKey ? o.getKey(item, i) : typeof item === 'string' || typeof item === 'number' ? item : i

  function derive(o: DetentOptions<T>): Layout<T> {
    if (o.items !== memo.items || o.getKey !== memo.getKey) memo = { items: o.items, getKey: o.getKey, keys: o.items.map(keyFn(o)) }
    const n = o.items.length
    const size = Math.max(1, o.itemSize ?? 36) || 36
    const visible = Math.max(1, Math.round(o.visibleCount ?? 5)) || 5
    const loop = !!o.loop
    // Virtual layout: [header -1] items 0..n-1 [loading n] [footer].
    return {
      o,
      keys: memo.keys,
      n,
      size,
      visible,
      vertical: o.orientation !== 'horizontal',
      loop,
      base: ((visible - 1) / 2) * size,
      head: !loop && !!o.header,
      loadAt: !loop && o.loading ? n : NaN,
      footAt: !loop && o.footer ? n + (o.loading ? 1 : 0) : NaN,
    }
  }

  /** The live layout (what is on screen), also unpacked into locals for the per-frame code. */
  let L = derive(init)
  let { o, keys, n, size, visible, vertical, loop, base, head, loadAt, footAt } = L
  const live = (next: Layout<T>) => ({ o, keys, n, size, visible, vertical, loop, base, head, loadAt, footAt } = L = next)

  const keyOf = (S: Layout<T>, v: T | undefined) => (v === undefined ? undefined : keyFn(S.o)(v, -1))
  const label = (S: Layout<T>, i: number) => (S.o.getLabel ? S.o.getLabel(S.o.items[i] as T, i) : String(S.o.items[i]))
  const itemAt = (S: Layout<T>, j: number) => (S.loop ? mod(j, S.n) : j >= 0 && j < S.n ? j : -1)
  const enabled = (S: Layout<T>, j: number) => {
    const i = itemAt(S, j)
    return i < 0 ? j !== S.loadAt : !S.o.isDisabled?.(S.o.items[i] as T, i)
  }
  const span = (S: Layout<T>, c: number, lead = 0): [number, number] => {
    const half = (S.visible - 1) / 2
    const over = S.o.overscan ?? 3
    return [Math.floor(c - half) - over - Math.max(0, -lead), Math.ceil(c + half) + over + Math.max(0, lead)]
  }

  let rtl = init.dir === 'rtl'
  /** The `dir` prop as of the last commit: a change re-reads the direction (from the prop, or the DOM). */
  let dirProp = init.dir
  let root: HTMLElement | null = null
  let track: HTMLElement | null = null
  let announce = ''
  let endFor = -1
  let spinning = false
  let committing = false
  const subs = new Set<(f: DetentFrame) => void>()

  /** Virtual index the wheel rests on (may be a header/footer). */
  let rest = Math.max(0, keys.indexOf(keyOf(L, init.value ?? init.defaultValue) as Key))
  /** Last item index the wheel rested on, and the last one reported through onChange. */
  let sel = rest
  let emitted = rest
  let valueKey = keyOf(L, init.value)
  let win = span(L, rest)

  const transform = (S: Layout<T>, x: number) => {
    const d = S.base - x
    return S.vertical ? `translate3d(0,${d}px,0)` : `translate3d(${rtl ? -d : d}px,0,0)`
  }
  const publish = (velocity: number) =>
    subs.forEach((fn) => fn({ offset: engine.x / size, velocity, mode: engine.mode, target: engine.target, from: engine.from }))

  function emit(i: number) {
    if (i !== emitted) o.onChange?.(o.items[(emitted = i)] as T, i)
  }

  function onRender(x: number, v: number) {
    const c = x / size
    if (track) {
      track.style.transform = transform(L, x)
      const interactive = !!o.interactive
      for (const r of track.children as unknown as HTMLElement[]) {
        const j = r.dataset.detentIndex
        if (!j) continue
        for (const [k, val] of vars(+j - c, visible)) r.style.setProperty(k, val)
        // Interactive rows: only the centered one takes focus and input. Off again: nothing stays inert.
        const inert = interactive && Math.abs(+j - c) >= 0.5
        if (r.inert !== inert) r.inert = inert
      }
    }
    // Keep the rendered window ahead of the motion (lead by ~3 frames of travel).
    const half = (visible - 1) / 2
    if (Math.floor(c - half) - 1 < win[0] || Math.ceil(c + half) + 1 > win[1]) {
      win = span(L, c, Math.round((v * 48) / size))
      // While the wheel moves (animation frames, pointer and wheel events), the rows must be there before this
      // frame paints: flush. A jump made from code (scrollTo, possibly inside an effect, where flushSync is not
      // allowed) renders normally.
      moving() ? flushSync(update) : update()
    }
    // Only when the wheel moves near the end: not as it mounts there, nor as rows come in while it rests there
    // (rows inserted above the centered one keep it near the end, and it would ask for page after page).
    if (!committing && !loop && o.onEndReached && n && c >= n - 1 - (o.endReachedThreshold ?? 5) && endFor !== n) {
      endFor = n
      o.onEndReached()
    }
    o.onScrollProgress?.(c)
    publish(v)
  }

  let jumping = false
  const moving = () => !committing && !jumping && !!track && engine.mode !== 'idle'

  function onMode(m: Mode) {
    if (root) root.dataset.state = m
    if (track) track.style.willChange = m === 'idle' ? '' : 'transform'
    if (m !== 'idle' !== spinning) (spinning = !spinning) ? o.onSpinStart?.() : o.onSpinEnd?.()
    publish(engine.v)
  }

  function onTick(j: number, v: number) {
    const i = itemAt(L, j)
    if (i < 0) return
    o.onTick?.(i, v)
    if (o.changeOn === 'tick' && engine.byHand && enabled(L, j)) emit(i)
  }

  function onSettle(j: number) {
    rest = j
    const i = itemAt(L, j)
    // An item first: a looping wheel's position runs past both ends (−6 in a loop of 12 is item 6), and only a
    // position with no item is the header (−1) or the footer.
    if (i >= 0) {
      sel = i
      announce = label(L, i)
      o.onSettle?.(o.items[i] as T, i)
      emit(i)
    } else if (j < 0) o.onHeaderRest?.()
    else if (j === footAt) o.onFooterRest?.()
    // Re-render (batched with any state the parent sets in onChange): the commit then sees the parent's answer.
    // The selected row is always rendered (see api), so the listbox never references a row that isn't there.
    update()
  }

  const engineOptions = (): EngineOptions => ({
    ...o,
    count: n,
    itemSize: size,
    visibleCount: visible,
    loop: loop,
    rtl,
    min: head ? -1 : 0,
    max: footAt === footAt ? footAt : n - 1,
    isEnabled: (j) => enabled(L, j),
    getLabel: (i) => label(L, i),
    onRender,
    onMode,
    onTick,
    onSettle,
  })
  const engine = createEngine(rest, engineOptions())
  // The track's transform is owned by the engine after mount; React only ever sets this first one (SSR-correct).
  const initial = transform(L, rest * size)

  /** Layout phase, every render: make the rendered layout live, keep identity across item changes, follow `value`. */
  function commit(next: Layout<T>) {
    committing = true
    const prev = L
    live(next)
    // Direction: from the prop, or (when it is removed) from the DOM again.
    let redraw = prev.vertical !== vertical || prev.base !== base || !prev.o.interactive !== !o.interactive
    if (o.dir !== dirProp) {
      dirProp = o.dir
      const r = dirProp ? dirProp === 'rtl' : root ? getComputedStyle(root).direction === 'rtl' : rtl
      if (r !== rtl) (rtl = r), (redraw = true), update()
    }
    engine.set(engineOptions()) // a new row size rescales positions: the same rows stay centered
    // A load that ended without new rows (it failed, or a page came back empty): ask again the next time the wheel
    // nears its end, or it would stay stuck there for good.
    if (prev.o.loading && !o.loading && n === prev.n) endFor = -1
    if (prev.keys !== keys) {
      const ci = loop ? mod(engine.index, prev.keys.length || 1) : engine.index
      if (ci >= 0 && ci < prev.keys.length) {
        const ni = keys.indexOf(prev.keys[ci] as Key)
        if (ni >= 0 && ni !== ci) {
          engine.shift(ni - ci) // the centered item keeps its place on screen
          rest += ni - ci
          sel = emitted = ni
          update()
        } else if (ni < 0 && engine.mode === 'idle' && n) engine.goTo(Math.min(n - 1, ci), false)
      }
    }
    // The row the wheel rests on may have disappeared (footer/header removed, list shortened): re-seat.
    if (!loop && engine.mode === 'idle' && (n || head)) {
      const lo = head ? -1 : 0
      const hi = footAt === footAt ? footAt : n - 1
      const at = engine.index
      if (at < lo || at > hi || at === loadAt) engine.goTo(Math.max(lo, Math.min(hi, at === loadAt ? n - 1 : at)), false)
    }
    // Controlled value. A new value turns the wheel to it. While the user turns it, the wheel follows the user
    // and reports through onChange; once it rests, it agrees with the parent: if the parent kept another value
    // (it rejected the change), the wheel turns back to it. Never mid-motion, so a throw is never steered.
    const vk = keyOf(L, o.value)
    if (vk !== valueKey && (valueKey = vk) !== undefined) {
      const i = keys.indexOf(vk as Key)
      if (i >= 0 && i !== emitted) engine.scrollTo((emitted = i), o.animate ?? true)
    } else if (vk !== undefined && engine.mode === 'idle' && rest === engine.index && itemAt(L, rest) >= 0 && keys[itemAt(L, rest)] !== vk) {
      const i = keys.indexOf(vk as Key)
      if (i >= 0 && enabled(L, i)) engine.scrollTo((emitted = i), o.animate ?? true)
    }
    if (redraw) engine.sync()
    committing = false
  }

  /** Mount: pick up the text direction from the DOM, then attach input. */
  function mount() {
    if (!root) return
    const r = o.dir ? o.dir === 'rtl' : getComputedStyle(root).direction === 'rtl'
    if (r !== rtl) {
      engine.set({ rtl: (rtl = r) })
      update()
    }
    committing = true // attach renders once; inside a layout effect, re-render without flushSync
    const detach = engine.attach(root)
    committing = false
    return detach
  }

  const optionId = (j: number) => `${id}-${j}`

  /** Build the API for this render, from the layout this render derived (not yet live). */
  function api(S: Layout<T>): DetentApi<T> {
    const { o, n, size, visible, vertical, head, loadAt, footAt } = S
    const now = engine.x / L.size
    const slot = (j: number, role: string, extra: object = {}): Slot => ({
      virtual: j,
      offset: j - now,
      selected: j === rest,
      getProps: (p = {}) =>
        ({
          ...p,
          id: optionId(j),
          role,
          'data-detent-index': j,
          'data-selected': j === rest ? '' : undefined,
          'aria-selected': role === 'option' ? j === rest : undefined,
          ...extra,
          style: {
            position: 'absolute',
            ...(vertical
              ? { left: 0, right: 0, top: j * size, height: size }
              : { top: 0, bottom: 0, insetInlineStart: j * size, width: size }),
            ...Object.fromEntries(vars(j - now, visible)),
            ...p.style,
          },
        }) as DetentElementProps,
    })
    // The rendered window follows the motion; the row the listbox references (aria-activedescendant: the resting
    // one) is always rendered too, even when the wheel has moved far from it, so it always exists.
    const shows = (j: number) => (j >= win[0] && j <= win[1]) || j === rest
    const rows: DetentRow<T>[] = []
    const used = new Set<Key>()
    const order: number[] = []
    if (rest < win[0]) order.push(rest)
    for (let j = win[0]; j <= win[1]; j++) order.push(j)
    if (rest > win[1]) order.push(rest)
    for (const j of n ? order : []) {
      const index = itemAt(S, j)
      if (index < 0) continue
      const disabled = !enabled(S, j)
      // Name options from getLabel: rich or inert (interactive) content may not name them otherwise.
      const named = o.getLabel || o.interactive ? { 'aria-label': label(S, index) } : {}
      rows.push({
        ...slot(j, 'option', disabled ? { ...named, 'aria-disabled': true, 'data-disabled': '' } : named),
        item: o.items[index] as T,
        index,
        // Duplicate item keys must not become duplicate React keys (React would recycle the wrong nodes).
        key: ((k: Key) => (used.has(k) ? `${k}#${j}` : (used.add(k), k)))(S.loop ? `${S.keys[index]}:${Math.floor(j / n)}` : (S.keys[index] as Key)),
        disabled,
      })
    }
    const selectedIndex = n ? Math.min(n - 1, sel) : -1
    const along = (p: DetentElementPropsIn, own: (el: HTMLElement | null) => void, style: CSSProperties) =>
      ({ ...p, ref: merge(own, p.ref), style: { ...style, ...p.style } }) as DetentElementProps

    return {
      getRootProps: (p = {}) => ({
        ...along(p, (el) => (root = el), {
          position: 'relative',
          overflow: 'hidden',
          [vertical ? 'height' : 'width']: size * visible,
          touchAction: vertical ? 'pan-x' : 'pan-y',
          // Contain only our axis: the root is a scroll container (overflow: hidden), so containing both
          // axes would also stop cross-axis pans (a vertical swipe over a horizontal wheel) reaching the page.
          [vertical ? 'overscrollBehaviorY' : 'overscrollBehaviorX']: 'contain',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
        } as CSSProperties),
        role: 'listbox',
        tabIndex: o.disabled ? -1 : 0,
        'aria-label': o.label,
        'aria-orientation': vertical ? 'vertical' : 'horizontal',
        // Only an option: resting on the header or footer (not options) leaves the listbox itself active.
        'aria-activedescendant': itemAt(S, rest) >= 0 ? optionId(rest) : undefined,
        'aria-disabled': o.disabled || undefined,
        'data-detent': '',
        'data-state': 'idle',
        'data-orientation': vertical ? 'vertical' : 'horizontal',
      }),
      getTrackProps: (p = {}) => ({
        ...along(p, (el) => (track = el), {
          position: 'absolute',
          // Centered on the root's real size: the rows assume a root of size × visible (its default), so if the
          // root is resized (style width/height), offset by half the difference instead of anchoring to the start.
          ...(vertical
            ? { left: 0, right: 0, top: `calc(50% - ${(size * visible) / 2}px)`, height: size }
            : { top: 0, bottom: 0, insetInlineStart: `calc(50% - ${(size * visible) / 2}px)`, width: size }),
          transform: initial,
        }),
        role: 'presentation',
      }),
      getLiveRegionProps: (p = {}) => ({
        ...along(p, () => {}, { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }),
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': true,
        children: announce,
      }),
      rows,
      // Rows the wheel can rest on but never selects (a search field, a 'load more' button): not options, so a
      // screen reader never hears them announced as selected, and their controls aren't nested in an option.
      header: head && shows(-1) ? slot(-1, 'presentation') : null,
      footer: shows(footAt) ? slot(footAt, 'presentation') : null,
      loadingRow: shows(loadAt) ? slot(loadAt, 'presentation', { 'aria-busy': true }) : null,
      selectedIndex,
      selectedItem: selectedIndex >= 0 ? o.items[selectedIndex] : undefined,
      scrollTo: (i, opt) => {
        jumping = true
        try {
          engine.scrollTo(i, opt?.animate ?? L.o.animate ?? true)
        } finally {
          jumping = false
        }
      },
      subscribe: (fn) => {
        subs.add(fn)
        return () => void subs.delete(fn)
      },
      rtl,
      engine,
    }
  }

  return { derive, commit, mount, api }
}

export function useDetent<T>(options: DetentOptions<T>): DetentApi<T> {
  const id = useId()
  const [, rerender] = useState(0)
  const [c] = useState(() => controller(options, id, () => rerender((k) => k + 1)))
  // Render: derive and build from the props, touching nothing live. Layout phase: commit exactly this layout.
  const layout = c.derive(options)
  useIso(() => c.commit(layout))
  useIso(c.mount, [])
  return c.api(layout)
}
