// @vitest-environment happy-dom
import { act, startTransition, Suspense, useEffect, useLayoutEffect, version, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Detent, useDetent, type DetentApi, type DetentOptions } from '../src'
import { refractionMap } from '../src/react/refraction'

// React's act() needs to know it runs in a test environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
})

function render(node: ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return { host, rerender: (next: ReactNode) => act(() => root.render(next)) }
}

/** A minimal headless wheel that hands its API out for assertions. */
function Probe<T>({ options, out }: { options: DetentOptions<T>; out: { api?: DetentApi<T> } }) {
  const d = useDetent(options)
  out.api = d
  return (
    <div {...d.getRootProps()}>
      <div {...d.getTrackProps()}>
        {d.rows.map((r) => (
          <div key={r.key} {...r.getProps()}>
            <button type="button">{String(r.item)}</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

it(`runs on a supported React (${version})`, () => expect(Number(version.split('.')[0])).toBeGreaterThanOrEqual(18))

describe('geometry changes (itemSize)', () => {
  it('keeps the selected item centered when the row size changes', () => {
    const out: { api?: DetentApi<string> } = {}
    const base = { items: letters, label: 'Letters', defaultValue: 'C' }
    const { rerender } = render(<Probe options={{ ...base, itemSize: 40 }} out={out} />)
    expect(out.api!.engine.index).toBe(2)
    rerender(<Probe options={{ ...base, itemSize: 80 }} out={out} />)
    expect(out.api!.selectedItem).toBe('C')
    expect(out.api!.engine.index).toBe(2)
    expect(out.api!.engine.x).toBe(2 * 80)
  })

  it('also keeps it while shrinking', () => {
    const out: { api?: DetentApi<string> } = {}
    const base = { items: letters, label: 'Letters', defaultValue: 'F' }
    const { rerender } = render(<Probe options={{ ...base, itemSize: 48 }} out={out} />)
    rerender(<Probe options={{ ...base, itemSize: 30 }} out={out} />)
    expect(out.api!.engine.index).toBe(5)
    expect(out.api!.engine.x).toBe(5 * 30)
  })
})

describe('render stays pure (concurrent React)', () => {
  it('a render React discards leaves the engine on the layout that is on screen', async () => {
    const out: { api?: DetentApi<string> } = {}
    const never = new Promise<never>(() => {})
    function Suspends({ on }: { on: boolean }) {
      if (on) throw never
      return null
    }
    const page = (size: number, suspend: boolean) => (
      <Suspense fallback={<p>loading</p>}>
        <Probe options={{ items: letters, label: 'Letters', defaultValue: 'C', itemSize: size }} out={out} />
        <Suspends on={suspend} />
      </Suspense>
    )
    const { host, rerender } = render(page(40, false))
    const engine = out.api!.engine
    // In a transition, a suspending sibling makes React keep the current UI and throw this render away.
    await act(async () => startTransition(() => render2(host, rerender, page(80, true))))
    expect(host.textContent).not.toContain('loading') // the old UI stayed
    expect(engine.x).toBe(2 * 40) // the engine never saw the discarded 80px layout
    expect(engine.index).toBe(2)
    // Nor did the hook: a frame now still reports row 2 (an 80px row size would read it as row 1).
    const frames: number[] = []
    const off = out.api!.subscribe((f) => frames.push(f.offset))
    act(() => engine.sync())
    off()
    expect(frames.at(-1)).toBe(2)
  })
})

describe('<Detent> stays on the committed props (concurrent React)', () => {
  it('a discarded render reaches neither the indicator nor rowStyle', async () => {
    const never = new Promise<never>(() => {})
    function Suspends({ on }: { on: boolean }) {
      if (on) throw never
      return null
    }
    const page = (color: string, suspend: boolean) => (
      <Suspense fallback={<p>loading</p>}>
        <Detent
          items={letters}
          label="Letters"
          defaultValue="C"
          indicator={{ color: () => color }}
          rowStyle={() => ({ color })}
        />
        <Suspends on={suspend} />
      </Suspense>
    )
    const { host, rerender } = render(page('red', false))
    // The blue render is thrown away: React keeps the red UI on screen.
    await act(async () => startTransition(() => rerender(page('blue', true))))
    expect(host.textContent).not.toContain('loading')
    // Now the wheel moves: every frame must still paint the committed (red) props.
    const root = host.querySelector<HTMLElement>('[data-detent-ui]')!
    const detent = host.querySelector<HTMLElement>('[role=listbox]')!
    act(() => detent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    act(() => detent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(root.style.getPropertyValue('--indicator-color')).toBe('red')
    const row = host.querySelector<HTMLElement>('[role=option][aria-selected=true]')!
    expect(row.style.color).toBe('red')
  })
})

/** Re-render inside the caller's transition. */
function render2(_host: HTMLElement, rerender: (n: ReactNode) => void, next: ReactNode) {
  rerender(next)
}

describe('programmatic moves respect disabled items', () => {
  const isDisabled = (_: string, i: number) => i === 2
  it('scrollTo a disabled item lands on the nearest enabled one, never on it', () => {
    const out: { api?: DetentApi<string> } = {}
    const changes: string[] = []
    render(<Probe options={{ items: letters, label: 'Letters', isDisabled, onChange: (v) => changes.push(v) }} out={out} />)
    act(() => out.api!.scrollTo(2, { animate: false }))
    expect(out.api!.engine.index).not.toBe(2)
    expect(changes).not.toContain('C')
    expect([1, 3]).toContain(out.api!.engine.index)
  })

  it('also when looping, by the shortest way round', () => {
    const out: { api?: DetentApi<string> } = {}
    render(<Probe options={{ items: letters, label: 'Letters', loop: true, isDisabled, defaultValue: 'G' }} out={out} />)
    act(() => out.api!.scrollTo(2, { animate: false }))
    const i = ((out.api!.engine.index % 8) + 8) % 8
    expect(i).not.toBe(2)
    expect([1, 3]).toContain(i)
  })

  it('when looping, the nearest enabled item counts the way round the end', () => {
    const five = ['A', 'B', 'C', 'D', 'E']
    const only = (ok: number[]) => (_: string, i: number) => !ok.includes(i)
    const at = (out: { api?: DetentApi<string> }) => ((out.api!.engine.index % 5) + 5) % 5
    // 0 is disabled: 4 is one step back across the end, 2 is two steps ahead.
    const a: { api?: DetentApi<string> } = {}
    render(<Probe options={{ items: five, label: 'Five', loop: true, isDisabled: only([2, 4]), defaultValue: 'C' }} out={a} />)
    act(() => a.api!.scrollTo(0, { animate: false }))
    expect(at(a)).toBe(4)
    // And the mirror: 4 is disabled, 0 is one step ahead across the end.
    const b: { api?: DetentApi<string> } = {}
    render(<Probe options={{ items: five, label: 'Five', loop: true, isDisabled: only([0, 2]), defaultValue: 'C' }} out={b} />)
    act(() => b.api!.scrollTo(4, { animate: false }))
    expect(at(b)).toBe(0)
  })

  it('does nothing when every item is disabled', () => {
    const out: { api?: DetentApi<string> } = {}
    render(<Probe options={{ items: letters, label: 'Letters', isDisabled: () => true }} out={out} />)
    const before = out.api!.engine.index
    act(() => out.api!.scrollTo(5, { animate: false }))
    expect(out.api!.engine.index).toBe(before)
  })
})

describe('interactive rows', () => {
  it('clears inert from every row when interactive is turned off', () => {
    const out: { api?: DetentApi<string> } = {}
    const base = { items: letters, label: 'Letters', defaultValue: 'C', itemSize: 40 }
    const { host, rerender } = render(<Probe options={{ ...base, interactive: true }} out={out} />)
    expect(host.querySelectorAll('[role=option][inert]').length).toBeGreaterThan(0)
    // No motion, no manual sync: the prop change alone must update the rows (both ways).
    rerender(<Probe options={{ ...base, interactive: false }} out={out} />)
    expect(host.querySelectorAll('[role=option][inert]').length).toBe(0)
    rerender(<Probe options={{ ...base, interactive: true }} out={out} />)
    expect(host.querySelectorAll('[role=option][inert]').length).toBeGreaterThan(0)
  })
})

describe('options that change after mount', () => {
  it('follows a dir change (horizontal wheels mirror)', () => {
    const out: { api?: DetentApi<string> } = {}
    const base = { items: letters, label: 'Letters', orientation: 'horizontal' as const, defaultValue: 'B' }
    const { rerender } = render(<Probe options={{ ...base, dir: 'ltr' }} out={out} />)
    expect(out.api!.rtl).toBe(false)
    rerender(<Probe options={{ ...base, dir: 'rtl' }} out={out} />)
    expect(out.api!.rtl).toBe(true)
    expect(out.api!.selectedItem).toBe('B')
  })

  it('re-keys items when only getKey changes', () => {
    const out: { api?: DetentApi<{ id: number; name: string }> } = {}
    const people = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Bo' },
      { id: 3, name: 'Cy' },
    ]
    const { rerender } = render(<Probe options={{ items: people, label: 'People', getKey: (p) => p.id }} out={out} />)
    expect(out.api!.rows.map((r) => r.key)).toContain(1)
    rerender(<Probe options={{ items: people, label: 'People', getKey: (p) => p.name }} out={out} />)
    expect(out.api!.rows.map((r) => r.key)).toContain('Ada')
  })
})

describe("changeOn 'tick'", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
  })
  afterEach(() => vi.useRealTimers())
  const run = () => act(() => { for (let i = 0; i < 240; i++) vi.advanceTimersByTime(1000 / 60) })
  const at = (type: string, y: number, t: number) => {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: 10, clientY: y, buttons: type === 'pointerup' ? 0 : 1 })
    Object.defineProperty(e, 'timeStamp', { value: t })
    return e
  }

  it('reports every row a hand turns past, live', () => {
    const out: { api?: DetentApi<string> } = {}
    const seen: string[] = []
    render(<Probe options={{ items: letters, label: 'Letters', itemSize: 36, changeOn: 'tick', onChange: (v) => seen.push(v) }} out={out} />)
    const root = document.querySelector<HTMLElement>('[role=listbox]')!
    act(() => {
      root.dispatchEvent(at('pointerdown', 300, 0))
      for (let k = 1; k <= 12; k++) window.dispatchEvent(at('pointermove', 300 - k * 9, k * 16))
    })
    // Three rows up while the finger is still down: each was reported as it crossed the center.
    expect(seen).toEqual(['B', 'C', 'D'])
    act(() => window.dispatchEvent(at('pointerup', 192, 400)))
    run()
  })

  it("turns from a new value, keys or scrollTo report only where they land, not the rows on the way", () => {
    const out: { api?: DetentApi<string> } = {}
    const seen: string[] = []
    const opts = (value: string) => ({ items: letters, label: 'Letters', itemSize: 36, changeOn: 'tick' as const, value, onChange: (v: string) => seen.push(v) })
    const { rerender } = render(<Probe options={opts('A')} out={out} />)
    // The parent's own value: it turns there, and nothing comes back through onChange.
    rerender(<Probe options={opts('F')} out={out} />)
    run()
    expect(out.api!.engine.index).toBe(5)
    expect(seen).toEqual([])
    // scrollTo: only the destination.
    act(() => out.api!.scrollTo(1))
    run()
    expect(seen).toEqual(['B'])
    // Home from a key: only the destination.
    act(() => out.api!.scrollTo(6, { animate: false }))
    seen.length = 0
    const root = document.querySelector<HTMLElement>('[role=listbox]')!
    act(() => root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })))
    run()
    expect(seen).toEqual(['A'])
  })
})

describe('a tap on a row off the center', () => {
  it('on the header, turns the wheel to it and lets no click through to its button', () => {
    // Rows laid out by index (happy-dom has no layout): each 36px tall, row 0's center at y=100.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const i = Number(this.dataset.detentIndex ?? 0)
      return { left: 0, width: 200, top: 82 + i * 36, height: 36, right: 200, bottom: 118 + i * 36, x: 0, y: 82 + i * 36, toJSON: () => ({}) } as DOMRect
    })
    let api: DetentApi<string> | undefined
    const clicked = vi.fn()
    function Wheel() {
      const d = (api = useDetent({ items: letters, label: 'Letters', header: true, itemSize: 36, animate: false }))
      return (
        <div {...d.getRootProps()}>
          <div {...d.getTrackProps()}>
            {d.header && <div {...d.header.getProps()}><button type="button" onClick={clicked}>Search</button></div>}
            {d.rows.map((r) => <div key={r.key} {...r.getProps()}>{String(r.item)}</div>)}
          </div>
        </div>
      )
    }
    render(<Wheel />)
    const button = document.querySelector('button')!
    const tap = (type: string, t: number) => {
      const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 64, buttons: type === 'pointerup' ? 0 : 1 })
      Object.defineProperty(e, 'timeStamp', { value: t })
      return e
    }
    // The wheel rests on row 0; the header is the row above it. A tap there: down, up, and the browser's click.
    act(() => {
      button.dispatchEvent(tap('pointerdown', 10))
      window.dispatchEvent(tap('pointerup', 60))
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      Object.defineProperty(click, 'timeStamp', { value: 70 })
      button.dispatchEvent(click)
    })
    expect(api!.engine.target).toBe(-1) // turned to the header
    expect(clicked).not.toHaveBeenCalled() // and the click was the wheel's, not the button's
  })
})

describe('onEndReached', () => {
  it('asks only when the wheel moves near the end: not on mount there, nor as rows come in while it rests', () => {
    const asked = vi.fn()
    const out: { api?: DetentApi<string> } = {}
    // Mounted on the last letter, within the threshold.
    const opts = (items: string[]) => ({ items, label: 'Letters', animate: false, endReachedThreshold: 2, onEndReached: asked, defaultValue: 'H' })
    const { rerender } = render(<Probe options={opts(letters)} out={out} />)
    expect(asked).not.toHaveBeenCalled()
    // Rows inserted above the centered one: it stays near the end, and nothing is asked.
    rerender(<Probe options={opts(['0', '1', ...letters])} out={out} />)
    rerender(<Probe options={opts(['00', '0', '1', ...letters])} out={out} />)
    expect(asked).not.toHaveBeenCalled()
    // Moved: asked.
    act(() => out.api!.engine.goTo(out.api!.engine.index - 1, false))
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('asks again after a load that brought no rows, the next time the wheel nears the end', () => {
    const asked = vi.fn()
    const out: { api?: DetentApi<string> } = {}
    const opts = (loading: boolean) => ({ items: letters, label: 'Letters', animate: false, endReachedThreshold: 2, onEndReached: asked, loading })
    const { rerender } = render(<Probe options={opts(false)} out={out} />)
    act(() => out.api!.engine.goTo(6, false))
    expect(asked).toHaveBeenCalledTimes(1)
    act(() => out.api!.engine.goTo(5, false))
    expect(asked).toHaveBeenCalledTimes(1) // same length: not again while nothing changed
    rerender(<Probe options={opts(true)} out={out} />)
    rerender(<Probe options={opts(false)} out={out} />) // the load ended, with nothing new
    act(() => out.api!.engine.goTo(6, false))
    expect(asked).toHaveBeenCalledTimes(2)
  })
})

describe('header and footer rows', () => {
  it('are not options: resting on one, nothing is announced as selected', () => {
    let api: DetentApi<string> | undefined
    function Wheel() {
      const d = (api = useDetent({ items: letters, label: 'Letters', header: true, footer: true, animate: false }))
      return (
        <div {...d.getRootProps()}>
          <div {...d.getTrackProps()}>
            {d.header && <div {...d.header.getProps()}><button type="button">Search</button></div>}
            {d.rows.map((r) => <div key={r.key} {...r.getProps()}>{String(r.item)}</div>)}
            {d.footer && <div {...d.footer.getProps()}>More</div>}
          </div>
        </div>
      )
    }
    const { host } = render(<Wheel />)
    const root = host.querySelector<HTMLElement>('[role=listbox]')!
    const options = () => [...host.querySelectorAll('[role=option]')].map((o) => o.textContent)
    expect(options()).not.toContain('Search')
    expect(root.getAttribute('aria-activedescendant')).toBe(host.querySelector('[role=option][aria-selected=true]')!.id)
    act(() => api!.engine.goTo(-1, false)) // rest on the header
    const header = [...host.querySelectorAll<HTMLElement>('[data-detent-index]')].find((r) => r.textContent === 'Search')!
    expect(header.getAttribute('role')).toBe('presentation')
    expect(header.hasAttribute('aria-selected')).toBe(false)
    expect(root.hasAttribute('aria-activedescendant')).toBe(false)
    expect(host.querySelector('[aria-selected=true]')).toBeNull()
  })
})

describe('controlled value', () => {
  it('turns back to the parent value when the wheel settles elsewhere and the parent keeps its value', () => {
    const out: { api?: DetentApi<string> } = {}
    const base = { items: letters, label: 'Letters', animate: false }
    const { rerender } = render(<Probe options={{ ...base, value: 'A' }} out={out} />)
    // The user moves the wheel to C; the parent rejects it (keeps A) and re-renders.
    act(() => out.api!.engine.goTo(2, false))
    rerender(<Probe options={{ ...base, value: 'A' }} out={out} />)
    expect(out.api!.selectedItem).toBe('A')
    expect(out.api!.engine.index).toBe(0)
  })

  it('follows the parent when it accepts the change', () => {
    const out: { api?: DetentApi<string> } = {}
    let value = 'A'
    const opts = () => ({ items: letters, label: 'Letters', animate: false, value, onChange: (v: string) => (value = v) })
    const { rerender } = render(<Probe options={opts()} out={out} />)
    act(() => out.api!.engine.goTo(2, false))
    rerender(<Probe options={opts()} out={out} />)
    expect(value).toBe('C')
    expect(out.api!.selectedItem).toBe('C')
    expect(out.api!.engine.index).toBe(2)
  })

  it('still moves when the parent changes value', () => {
    const out: { api?: DetentApi<string> } = {}
    const base = { items: letters, label: 'Letters', animate: false }
    const { rerender } = render(<Probe options={{ ...base, value: 'A' }} out={out} />)
    rerender(<Probe options={{ ...base, value: 'E' }} out={out} />)
    expect(out.api!.engine.index).toBe(4)
    expect(out.api!.selectedItem).toBe('E')
  })

  it('a looping wheel that rests past its start (a negative position) agrees with the parent without looping', () => {
    // Regression: −2 in a loop of 8 is item 6, not a header. Taken for a header, the selection went stale, the
    // wheel kept "turning back" to where it already was, and React stopped it with "Maximum update depth exceeded".
    const out: { api?: DetentApi<string> } = {}
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onHeaderRest = vi.fn()
    const base = { items: letters, label: 'Letters', animate: false, loop: true, onHeaderRest }
    const { rerender } = render(<Probe options={{ ...base, value: 'A' }} out={out} />)
    act(() => out.api!.engine.goTo(-2, false)) // the user turns back past A, to G; the parent keeps A
    rerender(<Probe options={{ ...base, value: 'A' }} out={out} />)
    expect(out.api!.selectedItem).toBe('A')
    rerender(<Probe options={{ ...base, value: 'G' }} out={out} />) // the parent accepts G, reached backwards
    act(() => out.api!.engine.goTo(-2, false))
    rerender(<Probe options={{ ...base, value: 'G' }} out={out} />)
    expect(out.api!.selectedItem).toBe('G')
    expect(onHeaderRest).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

describe('<Detent> loop mount', () => {
  it('mounts centered when almost every item is visible (8 items, 7 visible)', () => {
    const { host } = render(
      <Detent items={letters} label="Letters" loop orientation="horizontal" visibleCount={7} itemHeight={60} defaultValue="D" />,
    )
    const sel = host.querySelector<HTMLElement>('[role=listbox] [aria-selected=true]')!
    expect(sel.textContent).toContain('D')
    expect(Number(sel.style.getPropertyValue('--offset'))).toBe(0)
  })
})

describe('<Detent> forms and CSP', () => {
  it('submits the selected key through a hidden input when given a name', () => {
    const { host } = render(<Detent items={letters} label="Letters" name="letter" defaultValue="B" />)
    const input = host.querySelector<HTMLInputElement>('input[type=hidden][name=letter]')!
    expect(input).not.toBeNull()
    expect(input.value).toBe('B')
  })

  it('a disabled wheel is left out of the form data, like any disabled field', () => {
    const { host } = render(
      <form>
        <Detent items={letters} label="Letters" name="letter" defaultValue="B" disabled />
      </form>,
    )
    expect(new FormData(host.querySelector('form')!).has('letter')).toBe(false)
  })

  it('form reset turns the wheel back to its defaultValue', async () => {
    const { host } = render(
      <form>
        <Detent items={letters} label="Letters" name="letter" defaultValue="B" animate={false} />
      </form>,
    )
    const form = host.querySelector('form')!
    const lb = host.querySelector<HTMLElement>('[role=listbox]')!
    const settle = () => act(() => new Promise((r) => setTimeout(r, 900))) // keys turn the wheel with its spring
    act(() => lb.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    await settle()
    expect(new FormData(form).get('letter')).toBe('H')
    act(() => form.reset())
    await settle()
    expect(new FormData(form).get('letter')).toBe('B')
  })

  it('puts the nonce on its style element', () => {
    render(<Detent items={letters} label="Letters" nonce="abc123" />)
    expect(document.querySelector('style')!.getAttribute('nonce')).toBe('abc123')
  })
})

describe('<Detent> focus ring', () => {
  it('outlines a box band', () => {
    const { host } = render(<Detent items={letters} label="Letters" />)
    expect(host.querySelector('[data-detent-band][data-ring]')).not.toBeNull()
  })
  it('rings the whole wheel instead when the indicator is a needle, lines or a dot', () => {
    for (const shape of ['needle', 'lines', 'dot'] as const) {
      const { host } = render(<Detent items={letters} label="Letters" indicator={{ shape }} />)
      expect(host.querySelector('[data-detent-band]')).not.toBeNull()
      expect(host.querySelector('[data-ring]')).toBeNull()
    }
  })
})

describe('aria-activedescendant always points at a rendered row', () => {
  /** Checks, on every render, that the option the listbox references is among the rendered ones. */
  function Checked({ out, broken, ...options }: DetentOptions<string> & { out: { api?: DetentApi<string> }; broken: string[] }) {
    const d = useDetent(options)
    out.api = d
    const root = d.getRootProps()
    const ids = new Set(d.rows.map((r) => r.getProps().id))
    const ref = root['aria-activedescendant']
    if (ref && !ids.has(ref)) broken.push(`${ref} not in rows ${d.rows[0]?.index}…${d.rows.at(-1)?.index}`)
    return (
      <div {...root}>
        <div {...d.getTrackProps()}>
          {d.rows.map((r) => (
            <div key={r.key} {...r.getProps()}>
              {r.item}
            </div>
          ))}
        </div>
      </div>
    )
  }
  const many = Array.from({ length: 300 }, (_, i) => `#${i}`)

  it('during a long animated move and after it settles', async () => {
    const out: { api?: DetentApi<string> } = {}
    const broken: string[] = []
    render(<Checked items={many} label="Many" itemSize={40} out={out} broken={broken} />)
    await act(async () => {
      out.api!.scrollTo(180) // animated: the window moves with the wheel, the selection only when it lands
      await new Promise((r) => setTimeout(r, 1500))
    })
    expect(out.api!.selectedIndex).toBe(180)
    expect(broken).toEqual([])
  })

  it('after a far jump without animation', () => {
    const out: { api?: DetentApi<string> } = {}
    const broken: string[] = []
    render(<Checked items={many} label="Many" itemSize={40} out={out} broken={broken} />)
    act(() => out.api!.scrollTo(250, { animate: false }))
    expect(out.api!.selectedIndex).toBe(250)
    expect(broken).toEqual([])
  })
})

describe('programmatic moves from effects', () => {
  const many = Array.from({ length: 300 }, (_, i) => `#${i}`)
  function Mover({ to, layout }: { to: number; layout: boolean }) {
    const d = useDetent({ items: many, label: 'Many', itemSize: 40 })
    ;(layout ? useLayoutEffect : useEffect)(() => d.scrollTo(to, { animate: false }), [to]) // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <div {...d.getRootProps()}>
        <div {...d.getTrackProps()}>
          {d.rows.map((r) => (
            <div key={r.key} {...r.getProps()}>
              {r.item}
            </div>
          ))}
        </div>
      </div>
    )
  }
  for (const layout of [false, true])
    for (const to of [1, 250])
      it(`scrollTo(${to}) from ${layout ? 'useLayoutEffect' : 'useEffect'} lands without React warnings`, () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        const { host } = render(<Mover to={to} layout={layout} />)
        const warned = errors.mock.calls.map((c) => String(c[0]))
        errors.mockRestore()
        expect(warned).toEqual([])
        expect(host.querySelector('[aria-selected=true]')!.textContent).toBe(`#${to}`)
      })
})

describe('optional motion blur', () => {
  afterEach(() => vi.unstubAllGlobals())

  function media(reduced: boolean) {
    const changes = new EventTarget()
    const mq = { matches: reduced, addEventListener: changes.addEventListener.bind(changes), removeEventListener: changes.removeEventListener.bind(changes) }
    vi.stubGlobal('matchMedia', () => mq)
    return { mq, change: () => act(() => changes.dispatchEvent(new Event('change'))) }
  }

  function swipe(host: HTMLElement, horizontal = false) {
    const lb = host.querySelector('[role=listbox]')!
    for (const t of [100, 116]) {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: horizontal ? 80 : 0, deltaY: horizontal ? 0 : 80 })
      Object.defineProperty(e, 'timeStamp', { value: t })
      act(() => lb.dispatchEvent(e))
    }
  }

  it('adds no filter definition when disabled', () => {
    const { host } = render(<Detent items={letters} label="Letters" />)
    expect(host.querySelector('feGaussianBlur')).toBeNull()
  })

  for (const horizontal of [false, true]) {
    it(`blurs along the ${horizontal ? 'horizontal' : 'vertical'} axis, combines with row blur, and clears when motion is reduced`, () => {
      const { mq, change } = media(false)
      const items = Array.from({ length: 100 }, (_, i) => String(i))
      const { host, rerender } = render(<Detent items={items} label="Numbers" motionBlur={3} velocityTilt={2} blur={0.5} wheelMode="smooth" orientation={horizontal ? 'horizontal' : 'vertical'} />)
      swipe(host, horizontal)
      const filter = host.querySelector('feGaussianBlur')!
      const std = filter.getAttribute('stdDeviation')!.split(' ').map(Number)
      expect(std[horizontal ? 0 : 1]).toBeGreaterThan(0)
      expect(std[horizontal ? 0 : 1]).toBeLessThanOrEqual(3)
      expect(std[horizontal ? 1 : 0]).toBe(0)
      expect(host.querySelector<HTMLElement>('[role=option]')!.style.filter).toContain('var(--b)')
      expect(host.querySelector<HTMLElement>('[aria-hidden] [data-detent-row]')!.style.filter).toContain('--detent-motion-filter')
      const lean = parseFloat(host.querySelector<HTMLElement>('[role=listbox]')!.style.getPropertyValue('--detent-velocity-tilt'))
      expect(Math.abs(lean)).toBeGreaterThan(0)
      expect(Math.abs(lean)).toBeLessThanOrEqual(2)
      mq.matches = true
      change()
      expect(host.querySelector<HTMLElement>('[role=listbox]')!.style.getPropertyValue('--detent-velocity-tilt')).toBe('0deg')
      expect(filter.getAttribute('stdDeviation')).toBe('0 0')
      expect(host.querySelector<HTMLElement>('[role=listbox]')!.style.getPropertyValue('--detent-motion-filter')).toBe('blur(0px)')
      rerender(<Detent items={items} label="Numbers" motionBlur={false} />)
      expect(host.querySelector('feGaussianBlur')).toBeNull()
      expect(host.querySelector<HTMLElement>('[role=option]')!.style.filter).toBe('')
    })
  }
})

describe('indicator landing response', () => {
  for (const reduced of [false, true]) {
    it(`responds only after settling, clears after 280ms, reduced motion=${reduced}`, () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
      vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
      try {
        const { host } = render(<Detent items={Array.from({ length: 100 }, (_, i) => String(i))} label="Numbers" velocityTilt indicator={{ impact: true }} wheelMode="smooth" />)
        const el = host.querySelector<HTMLElement>('[role=listbox]')!
        const impact = () => Number(el.style.getPropertyValue('--indicator-impact'))
        for (const t of [100, 116]) {
          const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })
          Object.defineProperty(e, 'timeStamp', { value: t })
          act(() => el.dispatchEvent(e))
        }
        expect(impact()).toBe(0) // moving rows do not squash the marker
        for (let n = 0; n < 200 && el.dataset.state !== 'idle'; n++) act(() => vi.advanceTimersByTime(16))
        expect(el.dataset.state).toBe('idle')
        if (reduced) expect(impact()).toBe(0)
        else expect(impact()).toBeGreaterThan(0)
        expect(el.style.getPropertyValue('--detent-velocity-tilt')).toBe('0deg')
        act(() => vi.advanceTimersByTime(320))
        expect(impact()).toBe(0)
      } finally {
        for (const r of mounted.splice(0)) act(() => r.unmount())
        vi.useRealTimers()
        vi.unstubAllGlobals()
      }
    })
  }
})

describe('center lighting and selection depth', () => {
  for (const reduced of [false, true]) {
    it(`is optional, follows committed props and respects reduced motion=${reduced}`, () => {
      vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
      try {
        const { host, rerender } = render(<Detent items={letters} label="Letters" centerLight selectedDepth defaultValue="D" />)
        const root = host.querySelector<HTMLElement>('[role=listbox]')!
        expect(root.style.getPropertyValue('--detent-center-light')).toBe(reduced ? '0' : '0.12')
        expect(root.style.getPropertyValue('--detent-depth')).toBe(reduced ? '0' : '8')
        const row = host.querySelector<HTMLElement>('[role=option][aria-selected=true]')!
        expect(row.style.filter).toContain('brightness')
        // Depth as a scale (what translateZ under an 800px perspective would give), no second perspective().
        expect(row.style.transform).toContain('scale(calc(800 / (800 - var(--detent-depth')
        expect(row.style.transform.match(/perspective\(/g)?.length ?? 0).toBeLessThanOrEqual(1)
        const mirror = host.querySelector<HTMLElement>('[data-detent-mirror]')!
        expect(mirror.style.filter).toContain('brightness')
        expect(mirror.style.getPropertyValue('--abs-offset')).not.toBe('')
        rerender(<Detent items={letters} label="Letters" centerLight={false} selectedDepth={false} />)
        expect(root.style.getPropertyValue('--detent-depth')).toBe('0')
        expect(host.querySelector<HTMLElement>('[role=option]')!.style.filter).toBe('')
        expect(host.querySelector<HTMLElement>('[role=option]')!.style.transform).not.toContain('--detent-depth')
      } finally {
        for (const r of mounted.splice(0)) act(() => r.unmount())
        vi.unstubAllGlobals()
      }
    })
  }
})

describe('elastic rows', () => {
  for (const reduced of [false, true]) for (const axis of ['vertical', 'horizontal', 'rtl'] as const) {
    it(`outer rows yield, the centered row stays exact, and spacing recovers; reduced=${reduced}, axis=${axis}`, () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
      vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
      try {
        const { host, rerender } = render(<Detent items={Array.from({ length: 100 }, (_, i) => String(i))} label="Numbers" elasticRows={1} wheelMode="smooth" orientation={axis === 'vertical' ? 'vertical' : 'horizontal'} dir={axis === 'rtl' ? 'rtl' : 'ltr'} />)
        const root = host.querySelector<HTMLElement>('[role=listbox]')!
        for (const t of [100, 116]) {
          const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: axis === 'vertical' ? 80 : 0, deltaX: axis === 'vertical' ? 0 : axis === 'rtl' ? -80 : 80 })
          Object.defineProperty(e, 'timeStamp', { value: t })
          act(() => root.dispatchEvent(e))
        }
        act(() => vi.advanceTimersByTime(32))
        const lag = (el: Element) => Number((el as HTMLElement).style.getPropertyValue('--detent-row-lag'))
        const row = root.querySelector('[data-detent-index="4"]')!
        expect(lag(row)).toBe(0) // the physical center is index 4 after two 80px deltas
        const outer = root.querySelector('[data-detent-index="6"]')!
        if (reduced) expect(lag(outer)).toBe(0)
        else {
          expect(lag(outer) * (axis === 'rtl' ? -1 : 1)).toBeGreaterThan(0)
          expect(Math.abs(lag(outer))).toBeLessThanOrEqual(6) // 15% of 40px pitch
          expect(lag(root.querySelector('[data-detent-mirror="6"]')!)).toBe(lag(outer))
          const low = Math.abs(lag(outer))
          rerender(<Detent items={Array.from({ length: 100 }, (_, i) => String(i))} label="Numbers" elasticRows={3} wheelMode="smooth" orientation={axis === 'vertical' ? 'vertical' : 'horizontal'} dir={axis === 'rtl' ? 'rtl' : 'ltr'} />)
          act(() => vi.advanceTimersByTime(32))
          expect(Math.abs(lag(root.querySelector('[data-detent-index="6"]')!))).toBeGreaterThan(low)
          expect(Math.abs(lag(root.querySelector('[data-detent-index="6"]')!))).toBeLessThanOrEqual(18)
          expect(lag(root.querySelector('[data-detent-index="4"]')!)).toBe(0)
          const before = lag(root.querySelector('[data-detent-index="6"]')!) * (axis === 'rtl' ? -1 : 1)
          for (const t of [132, 148]) {
            const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: axis === 'vertical' ? -80 : 0, deltaX: axis === 'vertical' ? 0 : axis === 'rtl' ? 80 : -80 })
            Object.defineProperty(e, 'timeStamp', { value: t })
            act(() => root.dispatchEvent(e))
          }
          act(() => vi.advanceTimersByTime(64))
          expect(lag(root.querySelector('[data-detent-index="6"]')!) * (axis === 'rtl' ? -1 : 1)).toBeLessThan(before)

        }
        act(() => vi.advanceTimersByTime(3000))
        expect(root.dataset.state).toBe('idle')
        for (const el of root.querySelectorAll('[role=option]')) expect(lag(el)).toBe(0)
        rerender(<Detent items={letters} label="Letters" elasticRows={false} />)
        for (const el of root.querySelectorAll<HTMLElement>('[role=option]')) expect(el.style.translate).toBe('')
      } finally {
        for (const r of mounted.splice(0)) act(() => r.unmount())
        vi.useRealTimers()
        vi.unstubAllGlobals()
      }
    })
  }
})


it('elastic rows remain visible during slow sustained scrolling, reverse direction and recover at rest', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  try {
    const { host } = render(<Detent items={Array.from({ length: 100 }, (_, i) => String(i))} label="Slow" defaultValue="40" elasticRows={6} wheelMode="smooth" />)
    const root = host.querySelector<HTMLElement>('[role=listbox]')!
    const lags = () => Array.from(root.querySelectorAll<HTMLElement>('[role=option]'), (el) => Number(el.style.getPropertyValue('--detent-row-lag')))
    for (const direction of [1, -1]) {
      const samples: number[] = []
      for (let n = 0; n < 50; n++) {
        const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 2 * direction })
        Object.defineProperty(e, 'timeStamp', { value: performance.now() })
        act(() => root.dispatchEvent(e))
        act(() => vi.advanceTimersByTime(16))
        samples.push(Math.max(...lags().map((x) => x * direction)))
      }
      expect(Math.min(...samples.slice(-15))).toBeGreaterThan(3)
      expect(Math.max(...lags().map(Math.abs))).toBeLessThanOrEqual(28)
    }
    act(() => vi.advanceTimersByTime(2000))
    expect(root.dataset.state).toBe('idle')
    expect(lags().every((n) => n === 0)).toBe(true)
  } finally {
    for (const r of mounted.splice(0)) act(() => r.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

describe('refraction and grip', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('inverse alone enables no optics filter and grip stays off by default', () => {
    const { host } = render(<Detent items={letters} label="Default" indicator={{ refractionInverse: true, refractionRGB: true }} />)
    expect(host.querySelector('feDisplacementMap')).toBeNull()
    expect(host.querySelector<HTMLElement>('[data-detent-index]')!.parentElement!.style.translate).toBe('')
  })

  it('refracts the existing inert lens, works without magnify, switches axes, and responds to reduced motion', () => {
    const changes = new EventTarget()
    const mq = { matches: false, addEventListener: changes.addEventListener.bind(changes), removeEventListener: changes.removeEventListener.bind(changes) }
    vi.stubGlobal('matchMedia', () => mq)
    const { host, rerender } = render(<Detent items={letters} label="Optics" magnify={false} indicator={{ refraction: true }} />)
    const scale = () => Number(host.querySelector('feDisplacementMap')?.getAttribute('scale'))
    expect(scale()).toBeCloseTo(0.9)
    const image = host.querySelector('feImage')!
    expect(parseFloat(image.getAttribute('height')!)).toBeCloseTo(100 / 7)
    expect(image.getAttribute('width')).toBe('100%')
    expect(decodeURIComponent(image.getAttribute('href')!)).toContain('<linearGradient')
    const edgeSource = image.getAttribute('href')
    const mirror = host.querySelector('[data-detent-mirror]')!
    expect(mirror.closest('[aria-hidden]')?.hasAttribute('inert')).toBe(true)
    expect(host.querySelectorAll('[data-detent-mirror]').length).toBe(host.querySelectorAll('[data-detent-index]').length)
    rerender(<Detent items={letters} label="Optics" magnify={false} orientation="horizontal" indicator={{ refraction: 2, refractionInverse: true }} />)
    expect(scale()).toBe(9.6)
    expect(image.getAttribute('href')).not.toBe(edgeSource)
    expect(image.getAttribute('height')).toBe('100%')
    expect(image.getAttribute('y')).toBe('0')
    expect(parseFloat(image.getAttribute('width')!)).toBeCloseTo(100 / 7)
    mq.matches = true
    act(() => changes.dispatchEvent(new Event('change')))
    expect(scale()).toBe(0)
    expect(host.querySelector<HTMLElement>('[role=listbox]')!.style.getPropertyValue('--detent-refraction-filter')).toBe('none')
    mq.matches = false
    act(() => changes.dispatchEvent(new Event('change')))
    expect(scale()).toBe(9.6)
    rerender(<Detent items={letters} label="Optics" magnify={false} orientation="horizontal" indicator={{ refraction: 2, refractionInverse: false }} />)
    expect(scale()).toBeCloseTo(3.6)
    expect(image.getAttribute('href')).toBe(refractionMap(false))
    rerender(<Detent items={letters} label="Optics" magnify={false} />)
    expect(host.querySelector('feDisplacementMap')).toBeNull()
    expect(host.querySelector('[data-detent-optics]')).toBeNull()
  })

  it('on WebKit, runs the lens in fractions of the wheel box (user-space units render it empty there)', () => {
    vi.stubGlobal('navigator', { ...navigator, vendor: 'Apple Computer, Inc.' })
    try {
      const { host, rerender } = render(<Detent items={letters} label="Optics" magnify={false} indicator={{ refraction: true, refractionRGB: true }} />)
      const filter = host.querySelector('filter')!
      const image = host.querySelector('feImage')!
      // 7 rows of 40px: the same lens as elsewhere, each length divided by the side it runs along.
      expect(filter.getAttribute('primitiveUnits')).toBe('objectBoundingBox')
      expect(image.getAttribute('width')).toBe('1')
      expect(parseFloat(image.getAttribute('height')!)).toBeCloseTo(1 / 7)
      expect(parseFloat(image.getAttribute('y')!)).toBeCloseTo(3 / 7)
      expect(Number(host.querySelector('feDisplacementMap')!.getAttribute('scale')) * 280).toBeCloseTo(0.9)
      expect(Number(host.querySelectorAll('feOffset')[1]!.getAttribute('dx')) * 280).toBeCloseTo(0.35 * Math.min(3, 40 * 0.15))
      rerender(<Detent items={letters} label="Optics" magnify={false} orientation="horizontal" indicator={{ refraction: 2, refractionInverse: true }} />)
      expect(image.getAttribute('height')).toBe('1')
      expect(parseFloat(image.getAttribute('width')!)).toBeCloseTo(1 / 7)
      expect(Number(host.querySelector('feDisplacementMap')!.getAttribute('scale')) * 280).toBeCloseTo(9.6)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  for (const reduced of [false, true]) for (const axis of ['vertical', 'horizontal', 'rtl'] as const) {
    it(`grip catches only a moving wheel, preserves immediate dragging and recovers; axis=${axis}, reduced=${reduced}`, () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
      vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
      try {
        const items = Array.from({ length: 100 }, (_, i) => String(i))
        const props = { items, label: 'Grip', defaultValue: '40', orientation: axis === 'vertical' ? 'vertical' as const : 'horizontal' as const, dir: axis === 'rtl' ? 'rtl' as const : 'ltr' as const, wheelMode: 'smooth' as const }
        const { host, rerender } = render(<Detent {...props} grip={1} />)
        const root = host.querySelector<HTMLElement>('[role=listbox]')!
        const property = axis === 'vertical' ? '--detent-grip-y' : '--detent-grip-x'
        const pointer = (type: string, n = 0) => new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: n, clientY: n })
        act(() => root.dispatchEvent(pointer('pointerdown')))
        act(() => vi.advanceTimersByTime(48))
        expect(root.style.getPropertyValue(property)).toBe('')
        act(() => window.dispatchEvent(pointer('pointerup')))
        for (let n = 0; n < 2; n++) {
          const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: axis === 'vertical' ? 40 : 0, deltaX: axis === 'vertical' ? 0 : axis === 'rtl' ? -40 : 40 })
          Object.defineProperty(e, 'timeStamp', { value: 100 + n * 16 })
          act(() => root.dispatchEvent(e))
        }
        const track = root.querySelector<HTMLElement>('[data-detent-index]')!.parentElement!
        const held = track.style.transform
        act(() => root.dispatchEvent(pointer('pointerdown')))
        act(() => vi.advanceTimersByTime(48))
        expect(track.style.transform).toBe(held)
        expect(root.querySelector<HTMLElement>('[data-detent-mirror]')!.parentElement!.style.translate).toBe(track.style.translate)
        const shift = parseFloat(root.style.getPropertyValue(property)) || 0
        if (reduced) expect(shift).toBe(0)
        else {
          expect(shift * (axis === 'rtl' ? 1 : -1)).toBeGreaterThan(0)
          expect(Math.abs(shift)).toBeLessThanOrEqual(8)
        }
        // The visual catch never waits before allowing a drag.
        act(() => window.dispatchEvent(pointer('pointermove', 20)))
        expect(root.dataset.state).toBe('drag')
        expect(root.hasAttribute('data-dragging')).toBe(true)
        act(() => vi.advanceTimersByTime(200))
        expect(root.style.getPropertyValue(property)).toBe('')
        act(() => window.dispatchEvent(pointer('pointerup', 20)))
        rerender(<Detent {...props} grip={false} />)
        expect(root.style.getPropertyValue(property)).toBe('')
      } finally {
        for (const r of mounted.splice(0)) act(() => r.unmount())
        vi.useRealTimers()
        vi.unstubAllGlobals()
      }
    })
  }
})

for (const vertical of [false, true]) for (const inverse of [false, true]) {
  it(`refraction protects reading space and never folds pixels at maximum strength; vertical=${vertical}, inverse=${inverse}`, () => {
    const svg = new DOMParser().parseFromString(decodeURIComponent(refractionMap(vertical, inverse).split(',')[1]!), 'image/svg+xml')
    const stops = Array.from(svg.querySelectorAll('stop'), (el) => {
      const channels = el.getAttribute('stop-color')!.match(/\d+/g)!.map(Number)
      expect(channels[vertical ? 0 : 1]).toBe(128) // no distortion across the scroll axis
      return { t: Number(el.getAttribute('offset')), channel: channels[vertical ? 1 : 0]! }
    })
    if (!inverse) {
      expect(stops.filter(({ t }) => t >= 0.2 && t <= 0.8)).toEqual([{ t: 0.2, channel: 128 }, { t: 0.8, channel: 128 }])
      expect(stops.some(({ t, channel }) => t < 0.2 && channel > 128)).toBe(true)
      expect(stops.some(({ t, channel }) => t > 0.8 && channel < 128)).toBe(true)
    } else {
      // Preserve the exact original map for consumers opting into inverse.
      expect(stops.map(({ channel }) => channel)).toEqual([128, 177, 218, 245, 255, 245, 218, 177, 128, 79, 38, 11, 1, 11, 38, 79, 128])
    }
    const maxScalePerBand = inverse ? 0.32 : 0.12
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!, b = stops[i]!
      const slope = (b.channel - a.channel) / 255 / (b.t - a.t)
      expect(1 + maxScalePerBand * slope).toBeGreaterThan(0)
    }
  })
}

for (const inverse of [false, true]) for (const horizontal of [false, true]) {
  it(`RGB splits contours across the axis, replaces the original edges and clears with reduced motion; inverse=${inverse}, horizontal=${horizontal}`, () => {
    const changes = new EventTarget()
    const mq = { matches: false, addEventListener: changes.addEventListener.bind(changes), removeEventListener: changes.removeEventListener.bind(changes) }
    vi.stubGlobal('matchMedia', () => mq)
    try {
      const view = (strength: number, rgb: boolean | number = false) => <Detent items={letters} label="RGB" magnify={false} orientation={horizontal ? 'horizontal' : 'vertical'} indicator={{ refraction: strength, refractionInverse: inverse, refractionRGB: rgb }} />
      const { host, rerender } = render(view(2))
      const scale = () => Number(host.querySelector('feDisplacementMap')?.getAttribute('scale'))
      const offsets = () => Array.from(host.querySelectorAll('feOffset'), (el) => Number(el.getAttribute(horizontal ? 'dy' : 'dx')))
      const oldMaximum = scale()
      expect(host.querySelectorAll('feOffset')).toHaveLength(0)
      expect(host.querySelector('feColorMatrix')).toBeNull()
      rerender(view(4, true))
      const next = scale()
      expect(host.querySelectorAll('feDisplacementMap')).toHaveLength(1)
      expect(next).toBeGreaterThan(oldMaximum)
      expect(next).toBeCloseTo(40 * (inverse ? 0.12 : 0.045) * (8 / 3))
      expect(offsets()[0]).toBeCloseTo(-1.05)
      expect(offsets()[1]).toBeCloseTo(1.05)
      for (const el of host.querySelectorAll('feOffset')) expect(el.getAttribute(horizontal ? 'dx' : 'dy')).toBe('0')
      expect(host.querySelector('feComposite[in="chromatic"]')?.getAttribute('in2')).toBe('dispersion-mask')
      expect(host.querySelector('feComposite[in="refracted"][operator="out"]')?.getAttribute('in2')).toBe('dispersion-mask')
      expect(host.querySelector('feFlood[flood-color="#ff3040"]')).not.toBeNull()
      expect(host.querySelector('feFlood[flood-color="#00cfff"]')).not.toBeNull()
      expect(host.querySelector('feComposite[result="red-rim"]')?.getAttribute('k3')).toBe('-1')
      expect(host.querySelector('feComposite[result="cyan-rim"]')?.getAttribute('k3')).toBe('-1')
      const count = host.querySelectorAll('[data-detent-mirror]').length
      rerender(view(400, 100))
      expect(scale()).toBe(next)
      expect(offsets()).toEqual([-3, 3])
      expect(host.querySelectorAll('[data-detent-mirror]')).toHaveLength(count)
      mq.matches = true
      act(() => changes.dispatchEvent(new Event('change')))
      expect(scale()).toBe(0)
      expect(offsets()).toEqual([0, 0])
      mq.matches = false
      act(() => changes.dispatchEvent(new Event('change')))
      expect(scale()).toBe(next)
      expect(offsets()).toEqual([-3, 3])
      rerender(view(4, false))
      expect(host.querySelectorAll('feOffset')).toHaveLength(0)
      expect(host.querySelector('feColorMatrix')).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })
}
