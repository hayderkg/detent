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
import { createEngine, type Engine, type EngineOptions, type Mode, type Orientation, type WheelMode } from '../engine/engine'
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
  /** Fire onChange when the wheel settles (default), or live on every row that crosses the center. */
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
  /** Rows from the end at which onEndReached fires. */
  endReachedThreshold?: number
}

/** Props you pass in: any element ref is accepted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DetentPropsIn = HTMLAttributes<HTMLElement> & { ref?: Ref<any> }
/** Props you spread: a callback ref fits any element type. */
export type DetentProps = HTMLAttributes<HTMLElement> & { ref?: RefCallback<HTMLElement> }

interface Slot {
  /** Position on the wheel (virtual index). */
  virtual: number
  /** Distance from the center in rows at the last React render (live values are in CSS vars). */
  offset: number
  /** The wheel rests on this row. */
  selected: boolean
  getProps(props?: DetentPropsIn): DetentProps
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
  getRootProps(props?: DetentPropsIn): DetentProps
  getTrackProps(props?: DetentPropsIn): DetentProps
  /** Visually hidden live region announcing the selection when the wheel settles. Render it next to the root, not inside it. */
  getLiveRegionProps(props?: DetentPropsIn): DetentProps
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

/**
 * Everything stateful lives in this closure, created once per hook instance: plain locals instead of
 * refs and states (smaller, and no stale closures). React only re-renders when rows or selection change.
 */
function controller<T>(init: DetentOptions<T>, id: string, update: () => void) {
  let o = init
  let items: readonly T[] | undefined
  let keys: Key[] = []
  let prevKeys: Key[] | undefined
  let n = 0
  let size = 36
  let visible = 5
  let vertical = true
  let loop = false
  let base = 0
  let head = false
  let loadAt = NaN
  let footAt = NaN
  let rtl = init.dir === 'rtl'
  let root: HTMLElement | null = null
  let track: HTMLElement | null = null
  let win: [number, number]
  let announce = ''
  let endFor = -1
  let spinning = false
  let committing = false
  const subs = new Set<(f: DetentFrame) => void>()

  const getKey = (item: T, i: number): Key =>
    o.getKey ? o.getKey(item, i) : typeof item === 'string' || typeof item === 'number' ? item : i
  const keyOf = (v: T | undefined) => (v === undefined ? undefined : getKey(v, -1))

  /** Derive layout from the latest options (render phase: no side effects outside these locals). */
  function derive(next: DetentOptions<T>) {
    o = next
    if (o.items !== items) keys = (items = o.items).map(getKey)
    n = items.length
    size = o.itemSize ?? 36
    visible = o.visibleCount ?? 5
    vertical = o.orientation !== 'horizontal'
    loop = !!o.loop
    base = ((visible - 1) / 2) * size
    // Virtual layout: [header -1] items 0..n-1 [loading n] [footer].
    head = !loop && !!o.header
    loadAt = !loop && o.loading ? n : NaN
    footAt = !loop && o.footer ? n + (o.loading ? 1 : 0) : NaN
  }
  derive(init)

  /** Virtual index the wheel rests on (may be a header/footer). */
  let rest = Math.max(0, keys.indexOf(keyOf(init.value ?? init.defaultValue) as Key))
  /** Last item index the wheel rested on, and the last one reported through onChange. */
  let sel = rest
  let emitted = rest
  let valueKey = keyOf(init.value)

  const span = (c: number, lead = 0): [number, number] => {
    const half = (visible - 1) / 2
    const over = o.overscan ?? 3
    return [Math.floor(c - half) - over - Math.max(0, -lead), Math.ceil(c + half) + over + Math.max(0, lead)]
  }
  win = span(rest)

  const label = (i: number) => (o.getLabel ? o.getLabel(o.items[i] as T, i) : String(o.items[i]))
  const itemAt = (j: number) => (loop ? mod(j, n) : j >= 0 && j < n ? j : -1)
  const enabled = (j: number) => {
    const i = itemAt(j)
    return i < 0 ? j !== loadAt : !o.isDisabled?.(o.items[i] as T, i)
  }
  const transform = (x: number) => {
    const d = base - x
    return vertical ? `translate3d(0,${d}px,0)` : `translate3d(${rtl ? -d : d}px,0,0)`
  }
  const publish = (velocity: number) =>
    subs.forEach((fn) => fn({ offset: engine.x / size, velocity, mode: engine.mode, target: engine.target, from: engine.from }))

  function emit(i: number) {
    if (i !== emitted) o.onChange?.(o.items[(emitted = i)] as T, i)
  }

  function onRender(x: number, v: number) {
    const c = x / size
    if (track) {
      track.style.transform = transform(x)
      for (const r of track.children as unknown as HTMLElement[]) {
        const j = r.dataset.detentIndex
        if (!j) continue
        for (const [k, val] of vars(+j - c, visible)) r.style.setProperty(k, val)
        const off = Math.abs(+j - c) >= 0.5
        if (o.interactive && r.inert !== off) r.inert = off
      }
    }
    // Keep the rendered window ahead of the motion (lead by ~3 frames of travel).
    const half = (visible - 1) / 2
    if (Math.floor(c - half) - 1 < win[0] || Math.ceil(c + half) + 1 > win[1]) {
      win = span(c, Math.round((v * 48) / size))
      committing || !track ? update() : flushSync(update)
    }
    if (!loop && o.onEndReached && n && c >= n - 1 - (o.endReachedThreshold ?? 5) && endFor !== n) {
      endFor = n
      o.onEndReached()
    }
    o.onScrollProgress?.(c)
    publish(v)
  }

  function onMode(m: Mode) {
    if (root) root.dataset.state = m
    if (track) track.style.willChange = m === 'idle' ? '' : 'transform'
    if (m !== 'idle' !== spinning) (spinning = !spinning) ? o.onSpinStart?.() : o.onSpinEnd?.()
    publish(engine.v)
  }

  function onTick(j: number, v: number) {
    const i = itemAt(j)
    if (i < 0) return
    o.onTick?.(i, v)
    if (o.changeOn === 'tick' && enabled(j)) emit(i)
  }

  function onSettle(j: number) {
    rest = j
    const i = itemAt(j)
    if (j < 0) o.onHeaderRest?.()
    else if (j === footAt) o.onFooterRest?.()
    else if (i >= 0) {
      sel = i
      announce = label(i)
      o.onSettle?.(o.items[i] as T, i)
      emit(i)
    }
    update()
  }

  const engineOptions = (): EngineOptions => ({
    ...o,
    count: n,
    itemSize: size,
    visibleCount: visible,
    loop,
    rtl,
    min: head ? -1 : 0,
    max: footAt === footAt ? footAt : n - 1,
    isEnabled: enabled,
    getLabel: label,
    onRender,
    onMode,
    onTick,
    onSettle,
  })
  const engine = createEngine(rest, engineOptions())
  // The track's transform is owned by the engine after mount; React only ever sets this first one (SSR-correct).
  const initial = transform(rest * size)

  /** Layout phase, every render: push options to the engine, keep identity across item changes, follow `value`. */
  function commit() {
    engine.set(engineOptions())
    committing = true
    const prev = prevKeys
    prevKeys = keys
    if (prev && prev !== keys) {
      const ci = loop ? mod(engine.index, prev.length || 1) : engine.index
      if (ci >= 0 && ci < prev.length) {
        const ni = keys.indexOf(prev[ci] as Key)
        if (ni >= 0 && ni !== ci) {
          engine.shift(ni - ci) // the centered item keeps its place on screen
          rest += ni - ci
          sel = emitted = ni
          update()
        } else if (ni < 0 && engine.mode === 'idle' && n) engine.goTo(Math.min(n - 1, ci), false)
      }
    }
    const vk = keyOf(o.value)
    if (vk !== valueKey && (valueKey = vk) !== undefined) {
      const i = keys.indexOf(vk as Key)
      if (i >= 0 && i !== emitted) engine.scrollTo((emitted = i), o.animate ?? true)
    }
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

  /** Build the API for this render. */
  function api(): DetentApi<T> {
    const now = engine.x / size
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
        }) as DetentProps,
    })
    const shows = (j: number) => j >= win[0] && j <= win[1]
    const rows: DetentRow<T>[] = []
    for (let j = win[0]; n && j <= win[1]; j++) {
      const index = itemAt(j)
      if (index < 0) continue
      const disabled = !enabled(j)
      // Name options from getLabel: rich or inert (interactive) content may not name them otherwise.
      const named = o.getLabel || o.interactive ? { 'aria-label': label(index) } : {}
      rows.push({
        ...slot(j, 'option', disabled ? { ...named, 'aria-disabled': true, 'data-disabled': '' } : named),
        item: o.items[index] as T,
        index,
        key: loop ? `${keys[index]}:${Math.floor(j / n)}` : (keys[index] as Key),
        disabled,
      })
    }
    const selectedIndex = n ? Math.min(n - 1, sel) : -1
    const along = (p: DetentPropsIn, own: (el: HTMLElement | null) => void, style: CSSProperties) =>
      ({ ...p, ref: merge(own, p.ref), style: { ...style, ...p.style } }) as DetentProps

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
        'aria-activedescendant': n || head ? optionId(rest) : undefined,
        'aria-disabled': o.disabled || undefined,
        'data-detent': '',
        'data-state': 'idle',
        'data-orientation': vertical ? 'vertical' : 'horizontal',
      }),
      getTrackProps: (p = {}) => ({
        ...along(p, (el) => (track = el), {
          position: 'absolute',
          ...(vertical ? { left: 0, right: 0, top: 0, height: size } : { top: 0, bottom: 0, insetInlineStart: 0, width: size }),
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
      header: head && shows(-1) ? slot(-1, 'option') : null,
      footer: shows(footAt) ? slot(footAt, 'option') : null,
      loadingRow: shows(loadAt) ? slot(loadAt, 'presentation', { 'aria-busy': true }) : null,
      selectedIndex,
      selectedItem: selectedIndex >= 0 ? o.items[selectedIndex] : undefined,
      scrollTo: (i, opt) => engine.scrollTo(i, opt?.animate ?? o.animate ?? true),
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
  c.derive(options)
  useIso(c.commit)
  useIso(c.mount, [])
  return c.api()
}
