import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
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
}

export interface DetentApi<T> {
  getRootProps(props?: DetentPropsIn): DetentProps
  getTrackProps(props?: DetentPropsIn): DetentProps
  /** Visually hidden live region announcing the selection when the wheel settles. */
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
  engine: Engine
}

const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4)

function merge<E>(...refs: (Ref<E> | undefined)[]): RefCallback<E> {
  return (node) => {
    for (const r of refs) typeof r === 'function' ? r(node) : r && ((r as { current: E | null }).current = node)
  }
}

export function useDetent<T>(options: DetentOptions<T>): DetentApi<T> {
  const {
    items,
    getKey = (item: T, i: number) => (typeof item === 'string' || typeof item === 'number' ? item : i),
    itemSize = 36,
    visibleCount = 5,
    orientation = 'vertical',
    overscan = 3,
    loop = false,
  } = options
  const latest = useRef(options)
  latest.current = options
  const id = useId()
  const n = items.length
  const keys = useMemo(() => items.map(getKey), [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const keysRef = useRef(keys)
  const vertical = orientation !== 'horizontal'
  const base = ((visibleCount - 1) / 2) * itemSize
  const [rtl, setRtl] = useState(options.dir === 'rtl')
  // Virtual layout: [header -1] items 0..n-1 [loading n] [footer].
  const head = !loop && !!options.header
  const loadAt = !loop && options.loading ? n : NaN
  const footAt = !loop && options.footer ? n + (options.loading ? 1 : 0) : NaN
  const min = head ? -1 : 0
  const max = footAt === footAt ? footAt : n - 1

  const label = (i: number) => {
    const o = latest.current
    return o.getLabel ? o.getLabel(o.items[i] as T, i) : String(o.items[i])
  }
  const itemAt = (j: number) => (loop ? mod(j, n) : j >= 0 && j < n ? j : -1)
  const enabled = (j: number) => {
    const i = itemAt(j)
    if (i < 0) return j !== loadAt
    const o = latest.current
    return !o.isDisabled?.(o.items[i] as T, i)
  }
  const indexOf = (v: T | undefined) => (v === undefined ? -1 : keysRef.current.indexOf(getKey(v, -1)))

  /** Virtual index the wheel rests on (may be a header/footer). */
  const [rest, setRest] = useState(() => Math.max(0, indexOf(options.value ?? options.defaultValue)))
  /** Last item index the wheel rested on. */
  const [sel, setSel] = useState(rest)
  const [announce, setAnnounce] = useState('')
  const span = (center: number, lead = 0): [number, number] => {
    const half = (visibleCount - 1) / 2
    return [Math.floor(center - half) - overscan - Math.max(0, -lead), Math.ceil(center + half) + overscan + Math.max(0, lead)]
  }
  const [win, setWin] = useState(() => span(rest))
  const winRef = useRef(win)
  winRef.current = win

  const root = useRef<HTMLElement | null>(null)
  const track = useRef<HTMLElement | null>(null)
  const subs = useRef(new Set<(f: DetentFrame) => void>())
  const committing = useRef(false)
  const emitted = useRef(sel)
  const endFor = useRef(-1)
  const spinning = useRef(false)

  const engineOptions = (): EngineOptions => ({
    ...latest.current,
    count: n,
    itemSize,
    visibleCount,
    orientation,
    loop,
    rtl,
    min,
    max,
    isEnabled: enabled,
    getLabel: label,
    onRender,
    onMode,
    onTick,
    onSettle,
  })

  const transform = (x: number) => {
    const d = base - x
    return vertical ? `translate3d(0,${d}px,0)` : `translate3d(${rtl ? -d : d}px,0,0)`
  }

  const publish = (f: DetentFrame) => subs.current.forEach((fn) => fn(f))

  function emit(i: number) {
    if (i === emitted.current) return
    emitted.current = i
    const o = latest.current
    o.onChange?.(o.items[i] as T, i)
  }

  function onRender(x: number, v: number) {
    const o = latest.current
    const c = x / itemSize
    const t = track.current
    if (t) {
      t.style.transform = transform(x)
      for (const r of t.children as unknown as HTMLElement[]) {
        const idx = r.dataset.detentIndex
        if (idx === undefined) continue
        const off = +idx - c
        const abs = Math.abs(off)
        const s = r.style
        s.setProperty('--offset', fmt(off))
        s.setProperty('--abs-offset', fmt(abs))
        s.setProperty('--progress', fmt(Math.max(0, 1 - abs / (visibleCount / 2))))
        s.setProperty('--selected', abs < 0.5 ? '1' : '0')
      }
    }
    // Keep the rendered window ahead of the motion (lead by ~3 frames of travel).
    const half = (visibleCount - 1) / 2
    const [a, b] = winRef.current
    if (Math.floor(c - half) - 1 < a || Math.ceil(c + half) + 1 > b) {
      const next = span(c, Math.round((v * 48) / itemSize))
      winRef.current = next
      if (committing.current || !t) setWin(next)
      else flushSync(() => setWin(next))
    }
    if (!loop && o.onEndReached && n && c >= n - 1 - (o.endReachedThreshold ?? 5) && endFor.current !== n) {
      endFor.current = n
      o.onEndReached()
    }
    o.onScrollProgress?.(c)
    if (subs.current.size) publish({ offset: c, velocity: v, mode: engine.mode })
  }

  function onMode(m: Mode) {
    const o = latest.current
    if (root.current) root.current.dataset.state = m
    if (track.current) track.current.style.willChange = m === 'idle' ? '' : 'transform'
    if (m !== 'idle' !== spinning.current) {
      spinning.current = m !== 'idle'
      spinning.current ? o.onSpinStart?.() : o.onSpinEnd?.()
    }
    if (subs.current.size) publish({ offset: engine.x / itemSize, velocity: engine.v, mode: m })
  }

  function onTick(j: number, v: number) {
    const o = latest.current
    const i = itemAt(j)
    if (i < 0) return
    o.onTick?.(i, v)
    if (o.changeOn === 'tick' && enabled(j)) emit(i)
  }

  function onSettle(j: number) {
    const o = latest.current
    setRest(j)
    if (j < 0) return o.onHeaderRest?.()
    if (j === footAt) return o.onFooterRest?.()
    const i = itemAt(j)
    if (i < 0) return
    setSel(i)
    setAnnounce(label(i))
    o.onSettle?.(o.items[i] as T, i)
    emit(i)
  }

  const [engine] = useState(() => createEngine(rest, engineOptions()))

  // Latest options into the engine every render (cheap object merge).
  useIso(() => engine.set(engineOptions()))

  // Attach input once mounted; pick up the text direction from the DOM.
  useEffect(() => (root.current ? engine.attach(root.current) : undefined), [engine])
  useIso(() => {
    const r = root.current
    if (r && options.dir === undefined) setRtl(getComputedStyle(r).direction === 'rtl')
  }, [])
  useIso(() => {
    engine.set({ rtl })
    engine.sync()
  }, [rtl])

  // Items changed: keep the centered item's identity (no jump), clamp if it vanished.
  useIso(() => {
    const prev = keysRef.current
    keysRef.current = keys
    if (prev === keys) return
    engine.set(engineOptions())
    const cv = engine.index
    const ci = loop ? mod(cv, prev.length || 1) : cv
    if (ci < 0 || ci >= prev.length) return // resting on a header/footer: nothing to keep
    const ni = keys.indexOf(prev[ci] as Key)
    committing.current = true
    if (ni >= 0 && ni !== ci) {
      engine.shift(ni - ci)
      setRest((s) => s + ni - ci)
      setSel(ni)
      emitted.current = ni
    } else if (ni < 0 && engine.mode === 'idle' && n) {
      engine.goTo(Math.min(n - 1, ci), false)
    }
    committing.current = false
  }, [keys])

  // Controlled value.
  const valueKey = options.value === undefined ? undefined : getKey(options.value, -1)
  useIso(() => {
    if (valueKey === undefined) return
    const i = keys.indexOf(valueKey)
    if (i < 0 || i === emitted.current) return
    emitted.current = i
    engine.scrollTo(i, options.animate ?? true)
  }, [valueKey])

  const optionId = (j: number) => `${id}-${j}`
  const offsetNow = engine.x / itemSize
  const style = (j: number, extra?: CSSProperties): CSSProperties => {
    const off = j - offsetNow
    const abs = Math.abs(off)
    return {
      position: 'absolute',
      ...(vertical
        ? { left: 0, right: 0, top: j * itemSize, height: itemSize }
        : { top: 0, bottom: 0, insetInlineStart: j * itemSize, width: itemSize }),
      ...({
        '--offset': fmt(off),
        '--abs-offset': fmt(abs),
        '--progress': fmt(Math.max(0, 1 - abs / (visibleCount / 2))),
        '--selected': abs < 0.5 ? 1 : 0,
      } as CSSProperties),
      ...extra,
    }
  }
  const slot = (j: number, role: string, extra?: (p: DetentPropsIn) => object): Slot => ({
    virtual: j,
    offset: j - offsetNow,
    selected: j === rest,
    getProps: (p = {}) =>
      ({
        ...p,
        id: optionId(j),
        role,
        'data-detent-index': j,
        'data-selected': j === rest ? '' : undefined,
        ...extra?.(p),
        style: style(j, p.style),
      }) as DetentProps,
  })
  const visible = (j: number) => j === j && j >= win[0] && j <= win[1]

  const rows: DetentRow<T>[] = []
  if (n) {
    for (let j = win[0]; j <= win[1]; j++) {
      const index = itemAt(j)
      if (index < 0) continue
      const item = items[index] as T
      const disabled = !enabled(j)
      rows.push({
        ...slot(j, 'option', () => ({
          'aria-selected': j === rest,
          'aria-disabled': disabled || undefined,
          'data-disabled': disabled ? '' : undefined,
        })),
        item,
        index,
        key: loop ? `${keys[index]}:${Math.floor(j / n)}` : (keys[index] as Key),
        disabled,
      })
    }
  }

  // The track's transform is owned by the engine after mount; React only ever sets the first one (SSR-correct).
  const [initialTransform] = useState(() => transform(rest * itemSize))
  const selectedIndex = n ? Math.min(n - 1, sel) : -1

  return {
    getRootProps: (p = {}) =>
      ({
        ...p,
        ref: merge(root, p.ref),
        role: 'listbox',
        tabIndex: options.disabled ? -1 : 0,
        'aria-label': options.label,
        'aria-orientation': orientation,
        'aria-activedescendant': n || head ? optionId(rest) : undefined,
        'aria-disabled': options.disabled || undefined,
        'data-detent': '',
        'data-state': 'idle',
        'data-orientation': orientation,
        style: {
          position: 'relative',
          overflow: 'hidden',
          [vertical ? 'height' : 'width']: itemSize * visibleCount,
          touchAction: vertical ? 'pan-x' : 'pan-y',
          // Contain only our axis: the root is a scroll container (overflow: hidden), so containing both
          // axes would also stop cross-axis pans (a vertical swipe over a horizontal wheel) reaching the page.
          [vertical ? 'overscrollBehaviorY' : 'overscrollBehaviorX']: 'contain',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
          ...p.style,
        } as CSSProperties,
      }) as DetentProps,
    getTrackProps: (p = {}) =>
      ({
        ...p,
        ref: merge(track, p.ref),
        role: 'presentation',
        style: {
          position: 'absolute',
          ...(vertical
            ? { left: 0, right: 0, top: 0, height: itemSize }
            : { top: 0, bottom: 0, insetInlineStart: 0, width: itemSize }),
          transform: initialTransform,
          ...p.style,
        },
      }) as DetentProps,
    getLiveRegionProps: (p = {}) =>
      ({
        ...p,
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': true,
        style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', ...p.style },
        children: announce,
      }) as DetentProps,
    rows,
    header: head && visible(-1) ? slot(-1, 'option', () => ({ 'aria-selected': rest === -1 })) : null,
    footer: visible(footAt) ? slot(footAt, 'option', () => ({ 'aria-selected': rest === footAt })) : null,
    loadingRow: visible(loadAt) ? slot(loadAt, 'presentation', () => ({ 'aria-busy': true })) : null,
    selectedIndex,
    selectedItem: selectedIndex >= 0 ? items[selectedIndex] : undefined,
    scrollTo: (i, o) => engine.scrollTo(i, o?.animate ?? options.animate ?? true),
    subscribe: (fn) => {
      subs.current.add(fn)
      return () => void subs.current.delete(fn)
    },
    engine,
  }
}
