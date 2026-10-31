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
  disabled?: boolean
  dragThreshold?: number
  dragRatio?: number
  wheelStep?: number
  wheelMode?: WheelMode
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

type Props = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }

export interface DetentRow<T> {
  item: T
  /** Index in `items`. */
  index: number
  /** Unwrapped position on the wheel (differs from `index` when looping). */
  virtual: number
  key: Key
  /** Distance from the center in rows at the last React render (live values are in CSS vars). */
  offset: number
  selected: boolean
  disabled: boolean
  getProps(props?: Props): Props
}

export interface DetentFrame {
  /** Position in rows (float). */
  offset: number
  /** px/ms */
  velocity: number
  mode: Mode
}

export interface DetentApi<T> {
  getRootProps(props?: Props): Props
  getTrackProps(props?: Props): Props
  /** Visually hidden live region announcing the selection when the wheel settles. */
  getLiveRegionProps(props?: Props): Props
  rows: DetentRow<T>[]
  selectedIndex: number
  selectedItem: T | undefined
  scrollTo(index: number, options?: { animate?: boolean }): void
  /** Per-frame position, outside React. Returns an unsubscribe function. */
  subscribe(fn: (frame: DetentFrame) => void): () => void
  engine: Engine
}

const hidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

function merge<E>(...refs: (Ref<E> | undefined)[]): RefCallback<E> {
  return (node) => {
    for (const r of refs) {
      if (typeof r === 'function') r(node)
      else if (r) (r as { current: E | null }).current = node
    }
  }
}

const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4)

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
  const label = (i: number) => {
    const o = latest.current
    const it = o.items[i] as T
    return o.getLabel ? o.getLabel(it, i) : String(it)
  }
  const indexOf = (v: T | undefined) => (v === undefined ? -1 : keysRef.current.indexOf(getKey(v, -1)))

  const [sel, setSel] = useState(() => Math.max(0, indexOf(options.value ?? options.defaultValue)))
  const selRef = useRef(sel)
  selRef.current = sel
  const [announce, setAnnounce] = useState('')
  const span = (center: number, lead = 0): [number, number] => {
    const half = (visibleCount - 1) / 2
    let a = Math.floor(center - half) - overscan - Math.max(0, -lead)
    let b = Math.ceil(center + half) + overscan + Math.max(0, lead)
    if (!latest.current.loop) {
      a = Math.max(0, a)
      b = Math.min(latest.current.items.length - 1, b)
    }
    return [a, b]
  }
  const [win, setWin] = useState(() => span(sel))
  const winRef = useRef(win)
  winRef.current = win

  const root = useRef<HTMLElement | null>(null)
  const track = useRef<HTMLElement | null>(null)
  const subs = useRef(new Set<(f: DetentFrame) => void>())
  const committing = useRef(false)
  const emitted = useRef(sel)
  const endFor = useRef(-1)

  const engineOptions = (): EngineOptions => {
    const o = latest.current
    return {
      ...o,
      count: o.items.length,
      itemSize,
      visibleCount,
      orientation,
      loop: o.loop,
      isEnabled: o.isDisabled ? (i) => !o.isDisabled!(o.items[i] as T, i) : undefined,
      getLabel: label,
      onRender,
      onMode,
      onTick,
      onSettle,
    }
  }

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
      const d = base - x
      t.style.transform = vertical ? `translate3d(0,${d}px,0)` : `translate3d(${d}px,0,0)`
      for (const r of t.children as unknown as HTMLElement[]) {
        const idx = r.dataset.detentIndex
        if (idx === undefined) continue
        const off = Number(idx) - c
        const abs = Math.abs(off)
        r.style.setProperty('--offset', fmt(off))
        r.style.setProperty('--abs-offset', fmt(abs))
        r.style.setProperty('--progress', fmt(Math.max(0, 1 - abs / (visibleCount / 2))))
        r.style.setProperty('--selected', abs < 0.5 ? '1' : '0')
      }
    }
    // Keep the rendered window ahead of the motion (lead by ~3 frames of travel).
    const half = (visibleCount - 1) / 2
    const [a, b] = winRef.current
    const need = span(c, 0)
    const lo = o.loop ? Math.floor(c - half) - 1 : need[0]
    const hi = o.loop ? Math.ceil(c + half) + 1 : need[1]
    if (lo < a || hi > b) {
      const next = span(c, Math.round((v * 48) / itemSize))
      winRef.current = next
      if (committing.current || !t) setWin(next)
      else flushSync(() => setWin(next))
    }
    if (!o.loop && o.onEndReached && n > 0 && c >= o.items.length - 1 - (o.endReachedThreshold ?? 5) && endFor.current !== o.items.length) {
      endFor.current = o.items.length
      o.onEndReached()
    }
    o.onScrollProgress?.(c)
    if (subs.current.size) {
      const f = { offset: c, velocity: v, mode: engine.mode }
      subs.current.forEach((fn) => fn(f))
    }
  }

  function onMode(m: Mode) {
    const o = latest.current
    const r = root.current
    if (r) r.dataset.state = m
    if (track.current) track.current.style.willChange = m === 'idle' ? '' : 'transform'
    if (m !== 'idle' && !spinning.current) {
      spinning.current = true
      o.onSpinStart?.()
    } else if (m === 'idle' && spinning.current) {
      spinning.current = false
      o.onSpinEnd?.()
    }
    if (subs.current.size) {
      const f = { offset: engine.x / itemSize, velocity: engine.v, mode: m }
      subs.current.forEach((fn) => fn(f))
    }
  }

  function onTick(virtual: number, v: number) {
    const o = latest.current
    const len = o.items.length
    if (!len) return
    const i = o.loop ? mod(virtual, len) : virtual
    if (i < 0 || i >= len) return
    o.onTick?.(i, v)
    if (o.changeOn === 'tick' && !o.isDisabled?.(o.items[i] as T, i)) emit(i)
  }

  function onSettle(virtual: number) {
    const o = latest.current
    const len = o.items.length
    if (!len) return
    const i = o.loop ? mod(virtual, len) : Math.max(0, Math.min(len - 1, virtual))
    setSel(virtual)
    setAnnounce(label(i))
    o.onSettle?.(o.items[i] as T, i)
    emit(i)
  }

  const spinning = useRef(false)
  const [engine] = useState(() => createEngine(sel, engineOptions()))

  // Latest options into the engine every render (cheap object merge).
  useIso(() => {
    engine.set(engineOptions())
  })

  // Attach input once mounted.
  useEffect(() => (root.current ? engine.attach(root.current) : undefined), [engine])

  // Items changed: keep the centered item's identity (no jump), clamp if it vanished.
  useIso(() => {
    const prev = keysRef.current
    keysRef.current = keys
    if (prev === keys) return
    engine.set(engineOptions())
    const cv = engine.index
    const ci = loop ? mod(cv, prev.length || 1) : cv
    const k = prev[ci]
    const ni = k === undefined ? -1 : keys.indexOf(k)
    committing.current = true
    if (ni >= 0 && ni !== cv) {
      engine.shift(ni - cv)
      setSel((s) => s + ni - cv)
      emitted.current = ni
    } else if (ni < 0 && engine.mode === 'idle' && n > 0) {
      engine.goTo(Math.max(0, Math.min(n - 1, ci)), false)
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

  const optionId = (virtual: number) => `${id}-${virtual}`
  const selectedIndex = n ? (loop ? mod(sel, n) : Math.min(n - 1, sel)) : -1
  const offsetNow = engine.x / itemSize

  const rows: DetentRow<T>[] = []
  if (n) {
    for (let j = win[0]; j <= win[1]; j++) {
      const index = loop ? mod(j, n) : j
      if (index < 0 || index >= n) continue
      const item = items[index] as T
      const offset = j - offsetNow
      const abs = Math.abs(offset)
      const selected = j === sel
      const disabled = !!options.isDisabled?.(item, index)
      rows.push({
        item,
        index,
        virtual: j,
        key: loop ? `${keys[index]}:${Math.floor(j / n)}` : (keys[index] as Key),
        offset,
        selected,
        disabled,
        getProps: (p = {}) => ({
          ...p,
          id: optionId(j),
          role: 'option',
          'aria-selected': selected,
          'aria-disabled': disabled || undefined,
          'data-detent-index': j,
          'data-selected': selected ? '' : undefined,
          'data-disabled': disabled ? '' : undefined,
          style: {
            position: 'absolute',
            ...(vertical
              ? { left: 0, right: 0, top: j * itemSize, height: itemSize }
              : { top: 0, bottom: 0, left: j * itemSize, width: itemSize }),
            ...({
              '--offset': fmt(offset),
              '--abs-offset': fmt(abs),
              '--progress': fmt(Math.max(0, 1 - abs / (visibleCount / 2))),
              '--selected': abs < 0.5 ? 1 : 0,
            } as CSSProperties),
            ...p.style,
          },
        }) as Props,
      })
    }
  }

  // The track's transform is owned by the engine after mount; React only ever sets the first one (SSR-correct).
  const [initialTransform] = useState(() => {
    const d = base - sel * itemSize
    return vertical ? `translate3d(0,${d}px,0)` : `translate3d(${d}px,0,0)`
  })

  return {
    getRootProps: (p = {}) =>
      ({
        ...p,
        ref: merge(root, p.ref),
        role: 'listbox',
        tabIndex: options.disabled ? -1 : 0,
        'aria-label': options.label,
        'aria-orientation': orientation,
        'aria-activedescendant': n ? optionId(sel) : undefined,
        'aria-disabled': options.disabled || undefined,
        'data-detent': '',
        'data-orientation': orientation,
        style: {
          position: 'relative',
          overflow: 'hidden',
          [vertical ? 'height' : 'width']: itemSize * visibleCount,
          touchAction: vertical ? 'pan-x' : 'pan-y',
          overscrollBehavior: 'contain',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
          ...p.style,
        } as CSSProperties,
      }) as Props,
    getTrackProps: (p = {}) =>
      ({
        ...p,
        ref: merge(track, p.ref),
        role: 'presentation',
        style: {
          position: 'absolute',
          ...(vertical ? { left: 0, right: 0, top: 0, height: itemSize } : { top: 0, bottom: 0, left: 0, width: itemSize }),
          transform: initialTransform,
          ...p.style,
        },
      }) as Props,
    getLiveRegionProps: (p = {}) => ({ ...p, role: 'status', 'aria-live': 'polite', 'aria-atomic': true, style: { ...hidden, ...p.style }, children: announce }) as Props,
    rows,
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
