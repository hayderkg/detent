// @vitest-environment happy-dom
import { act, createRef, startTransition, StrictMode, Suspense, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetentText } from '../src/text'
import { align, segments } from '../src/text/layout'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
let now = 0, id = 0, reduced = false, scale = 1, jitter = 0
const resizes = new Set<() => void>()
const frames = new Map<number, FrameRequestCallback>()
const changes = new Set<() => void>()
// Deterministic shaped text geometry. Browser checks separately exercise the actual font and Range measurements.
const extent = (text: string) => [...text].reduce((n, c) => n + (c === 'i' ? 4 : 8), 0) - (text.includes('Se') ? 0.25 : 0)
// A class that redistributes the letters (ligatures, tracking, features) while keeping the label's width and height:
// under .even every grapheme takes the same share of the line.
const offset = (node: Node, text: string, i: number) =>
  node.parentElement?.closest('.even') ? extent(text) / [...text].length * i : extent(text.slice(0, i))
const rect = (x: number, width: number) => new DOMRect(x, 0, width, 20)
beforeEach(() => {
  now = id = 0; reduced = false; scale = 1; jitter = 0; frames.clear(); changes.clear(); resizes.clear()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: (_: string, cb: () => void) => changes.add(cb), removeEventListener: (_: string, cb: () => void) => changes.delete(cb) }))
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { resizes.add(callback) }
    observe() {}
    disconnect() { resizes.delete(this.callback) }
  })
  const computed = globalThis.getComputedStyle
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(el => {
    const cs = computed(el)
    return new Proxy(cs, { get(target, key) {
      if (el.hasAttribute('data-detent-text-content')) {
        if (key === 'width') return `${extent(el.textContent ?? '')}px`
        if (key === 'height') return '20px'
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, extent(this.textContent ?? '') * scale + (this.hasAttribute('data-detent-text-content') ? jitter : 0), 20 * scale)
  })
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const text = this.startContainer.textContent ?? ''
    const start = offset(this.startContainer, text, this.startOffset), end = offset(this.startContainer, text, this.endOffset)
    return rect(start * scale, (end - start) * scale)
  })
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function render(node: ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(node))
  return { host, rerender: (node: ReactNode) => act(() => root.render(node)) }
}
function advance(ms: number) {
  now += ms
  const work = [...frames.values()]; frames.clear()
  act(() => work.forEach(cb => cb(now)))
}
function content(host: HTMLElement) { return host.querySelector<HTMLElement>('[data-detent-text-content]')! }
const viewport = (part: HTMLElement) => part.firstElementChild as HTMLElement
const ink = (part: HTMLElement) => viewport(part).firstElementChild as HTMLElement
function part(host: HTMLElement, char: string) { return [...host.querySelectorAll<HTMLElement>('[data-detent-text-part]')].find(p => p.dataset.detentTextPart === char)! }

describe('text alignment', () => {
  it('preserves common prefixes and substitutions without a predefined list of labels', () => {
    expect(align(['S','e','n','d'], ['S','e','n','d','i','n','g','…'])).toEqual([[0,0],[1,1],[2,2],[3,3],[null,4],[null,5],[null,6],[null,7]])
    expect(align(['S','e','n','d'], ['S','e','n','t'])).toEqual([[0,0],[1,1],[2,2],[3,3]])
  })
  it('keeps emoji sequences and combining marks intact', () => {
    expect(segments('A👩🏽‍💻e\u0301').map(s => s.text)).toEqual(['A', '👩🏽‍💻', 'e\u0301'])
    expect(segments('A👩🏽‍💻e\u0301').map(s => s.end - s.start)).toEqual([1, 7, 2])
  })
  it('reconstructs both sides for insertions, deletions and repeated characters', () => {
    for (const [old, next] of [['book', 'back'], ['Send', 'Sent'], ['', 'Hello'], ['abc', ''], ['abba', 'baba']]) {
      const a = [...old!], b = [...next!], pairs = align(a, b)
      expect(pairs.filter(p => p[0] !== null).map(p => a[p[0]!]).join('')).toBe(old)
      expect(pairs.filter(p => p[1] !== null).map(p => b[p[1]!]).join('')).toBe(next)
    }
  })
})

describe('DetentText', () => {
  it('server-renders real text with no visual copies, including numeric zero and escaping', () => {
    const html = renderToString(<DetentText as="strong">{'<Send & save>'}</DetentText>)
    expect(html).toContain('&lt;Send &amp; save&gt;')
    expect(html).not.toContain('data-detent-text-part')
    expect(renderToString(<DetentText>{0}</DetentText>)).toContain('>0</span>')
  })
  it('forwards HTML attributes and refs, with no picker or focusable controls', () => {
    const ref = createRef<HTMLElement>()
    const { host } = render(<DetentText as="output" ref={ref} aria-live="polite" className="price">Ready</DetentText>)
    expect(ref.current?.tagName).toBe('OUTPUT')
    expect(ref.current?.getAttribute('aria-live')).toBe('polite')
    expect(host.querySelector('[role=listbox],[role=option],[tabindex]')).toBeNull()
    expect(frames.size).toBe(0)
    expect(changes.size).toBe(1)
  })
  it('measures a label with one Range, however many graphemes it has', () => {
    const ranges = vi.spyOn(document, 'createRange')
    const { rerender } = render(<DetentText>Hello, wonderful world</DetentText>)
    const before = ranges.mock.calls.length
    rerender(<DetentText>Good morning, everyone</DetentText>)
    // A Range per grapheme stayed alive until garbage collection and slowed every later DOM write.
    expect(ranges.mock.calls.length - before).toBe(1)
  })

  it('a resize that leaves the label its size reads no glyph positions', () => {
    const reads = vi.mocked(Range.prototype.getBoundingClientRect)
    render(<DetentText>Ready</DetentText>)
    const before = reads.mock.calls.length
    // The observer reports once on start, and again whenever something around the label resizes.
    act(() => resizes.forEach(cb => cb()))
    act(() => resizes.forEach(cb => cb()))
    expect(reads.mock.calls.length).toBe(before)
  })

  it('reads no layout when it re-renders with the same text and options', () => {
    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    const { rerender } = render(<DetentText className="a" onAnimationStart={() => {}}>Ready</DetentText>)
    const before = reads.mock.calls.length
    // New callbacks and unrelated props every render, as a parent re-render would pass them.
    for (let i = 0; i < 5; i++) rerender(<DetentText className="a" title={`t${i}`} onAnimationStart={() => {}}>Ready</DetentText>)
    expect(reads.mock.calls.length).toBe(before)
    rerender(<DetentText className="a">Set</DetentText>)
    expect(reads.mock.calls.length).toBeGreaterThan(before)
  })

  it('measures again when a class restyles the letters without changing the label size', () => {
    const { host, rerender } = render(<DetentText className="a">Wi</DetentText>)
    // Same width and height (no resize to observe), different letter positions: W 0–8, i 8–12 becomes W 0–6, i 6–12.
    rerender(<DetentText className="even">Wi</DetentText>)
    // The departing i starts where the class now draws it (6), not at its stale position (8).
    rerender(<DetentText className="even">Wo</DetentText>)
    const departing = [...host.querySelectorAll<HTMLElement>('[data-detent-text-part=""]')].find(p => ink(p).textContent === 'i')!
    expect(departing.style.transform).toBe('translateX(6px)')
    // Inline style, lang and dir restyle the label too.
    const reads = vi.mocked(Range.prototype.getBoundingClientRect)
    for (const props of [{ style: { letterSpacing: 1 } }, { lang: 'tr' }, { dir: 'rtl' as const }]) {
      const before = reads.mock.calls.length
      rerender(<DetentText className="even" {...props}>Wo</DetentText>)
      expect(reads.mock.calls.length).toBeGreaterThan(before)
    }
  })

  it('keeps the layer working whatever style it is given: positioned, and a box that takes a width', () => {
    const { host, rerender } = render(<DetentText style={{ position: 'static', display: 'inline', color: 'red' }}>Ready</DetentText>)
    const root = host.querySelector<HTMLElement>('[data-detent-text]')!
    expect(root.style.position).toBe('relative')
    expect(root.style.display).toBe('inline-block')
    expect(root.style.color).toBe('red')
    rerender(<DetentText style={{ position: 'absolute', display: 'block' }}>Ready</DetentText>)
    expect(root.style.position).toBe('absolute')
    expect(root.style.display).toBe('block')
    // display: contents removes the box the layer is positioned against.
    rerender(<DetentText style={{ display: 'contents' }}>Ready</DetentText>)
    expect(root.style.display).toBe('inline-block')
  })

  it('only rolls changed graphemes, shares one frame loop, then restores native typography and width', () => {
    const done = vi.fn()
    const { host, rerender } = render(<DetentText onAnimationComplete={done}>Send</DetentText>)
    rerender(<DetentText onAnimationComplete={done}>Sending…</DetentText>)
    const s = part(host, 'S')
    expect(s.children).toHaveLength(1)
    expect(ink(s).style.transform).toBe('')
    expect(ink(part(host, 'i')).getAttribute('style')).toContain('translateY(20px)')
    expect(frames.size).toBe(1)
    expect(content(host).textContent).toBe('Sending…')
    expect(content(host).style.opacity).toBe('0')
    expect(host.querySelector('[data-detent-text-layer]')?.getAttribute('aria-hidden')).toBe('true')
    advance(600)
    expect(done).toHaveBeenCalledTimes(1)
    expect(content(host).style.opacity).toBe('')
    expect(host.firstElementChild?.getAttribute('style')).not.toContain('width:')
    expect(host.querySelectorAll('[data-detent-text-part]')).toHaveLength(0)
    expect(frames.size).toBe(0)
  })
  it.each(['up', 'down'] as const)('fades just inside the line without shifting retained letters or clipping the native baseline (%s)', rollDirection => {
    const label = (text: string, morph = true) => <DetentText rollDirection={rollDirection} morph={morph}>{text}</DetentText>
    const { host, rerender } = render(label('play'))
    rerender(label('replay'))
    const p = part(host, 'p')
    expect(viewport(p).style.top).toBe('-2.5px')
    expect(viewport(p).style.height).toBe('25px')
    // The extended margins are fully transparent; only the innermost 1/32 of the line fades.
    expect(viewport(p).style.maskImage).toContain('transparent 2.5px')
    expect(viewport(p).style.maskImage).toContain('#000 3.125px')
    expect(viewport(p).style.maskImage).toContain('transparent calc(100% - 2.5px)')
    expect(ink(p).style.top).toBe('2.5px')
    expect(ink(p).style.transform).toBe('')
    const incoming = ink(part(host, 'r'))
    // Each roll advances one native line, just like a number wheel; the shared fade reaches just inside that line.
    expect(incoming.style.transform).toBe(`translateY(${rollDirection === 'up' ? 20 : -20}px)`)
    advance(80)
    rerender(label('replayed'))
    expect(part(host, 'p')).toBe(p)
    expect(ink(p).style.transform).toBe('')
    advance(600)
    expect(content(host).textContent).toBe('replayed')
    expect(content(host).style.opacity).toBe('')
    expect(host.querySelector('[data-detent-text-part]')).toBeNull()
    // Whole-label rolling gets the same soft window, including accented and descending glyphs.
    rerender(label('café gy', false))
    rerender(label('déjà joué', false))
    const whole = host.querySelector<HTMLElement>('[data-detent-text-part]')!
    expect(viewport(whole).style.maskImage).toContain('linear-gradient')
    expect(viewport(whole).style.height).toBe('25px')
    advance(600)
    expect(content(host).textContent).toBe('déjà joué')
    expect(content(host).style.opacity).toBe('')
  })

  it.each(['up', 'down'] as const)('keeps exiting affixes attached to the retained word instead of drifting and slicing them (%s)', rollDirection => {
    const label = (text: string) => <DetentText rollDirection={rollDirection}>{text}</DetentText>
    const { host, rerender } = render(label('replayed'))
    rerender(label('play'))
    const cells = [...host.querySelectorAll<HTMLElement>('[data-detent-text-part]')]
    const p = part(host, 'p')
    const x = (node: HTMLElement) => Number(node.style.transform.match(/translateX\(([-.\d]+)px\)/)?.[1])
    const affixes = [cells[0]!, cells[1]!, cells[6]!, cells[7]!]
    const gaps = affixes.map(cell => x(cell) - x(p))
    advance(80)
    expect(x(p)).toBeLessThan(16)
    affixes.forEach((cell, i) => {
      expect(x(cell) - x(p)).toBeCloseTo(gaps[i]!, 6)
      expect(cell.style.width).toBe('8px')
    })
    const positions = affixes.map(x)
    // Retarget while the affixes are still exiting: no jump and no new horizontal drift.
    rerender(label('playing'))
    affixes.forEach((cell, i) => expect(x(cell)).toBeCloseTo(positions[i]!, 6))
    advance(40)
    affixes.forEach((cell, i) => expect(x(cell) - x(p)).toBeCloseTo(gaps[i]!, 6))
    advance(600)
    expect(content(host).textContent).toBe('playing')
    expect(host.querySelector('[data-detent-text-part]')).toBeNull()
  })

  it('keeps departing letters in place on screen when the label is right-aligned or centred', () => {
    // A label whose right edge (end = 1) or middle (end = ½) stays put in its line: as its width springs, its left
    // edge travels. Departing letters must not ride along with it.
    for (const [end, morph, next] of [[1, false, 'Hi'], [0.5, false, 'Hi'], [1, true, '\u00a0'], [0.5, true, 'Hi']] as const) {
      const root = (el: HTMLElement) => el.classList.contains('anchored')
      const widthOf = (el: HTMLElement) => el.style.width ? parseFloat(el.style.width) : extent(content(el).textContent ?? '')
      const leftOf = (el: HTMLElement) => 200 - widthOf(el) * end
      const plain = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        return root(this) ? new DOMRect(leftOf(this), 0, widthOf(this), 20) : plain.call(this)
      })
      const { host, rerender } = render(<DetentText className="anchored" morph={morph}>CLASSICAL</DetentText>)
      const el = host.querySelector<HTMLElement>('.anchored')!
      rerender(<DetentText className="anchored" morph={morph}>{next}</DetentText>)
      // Nothing is kept, so every letter leaves. (Kept letters that glide are followed by their departing neighbours,
      // on purpose: see the anchors in the text controller.) The last one would travel furthest if anything carried it.
      const out = [...host.querySelectorAll<HTMLElement>('[data-detent-text-part=""]')].at(-1)!
      const screenX = () => leftOf(el) + (parseFloat(host.querySelector<HTMLElement>('[data-detent-text-layer]')!.style.translate) || 0) +
        parseFloat(/translateX\((-?[\d.]+)px\)/.exec(out.style.transform)![1]!)
      const start = screenX()
      for (const ms of [40, 120, 260]) {
        advance(ms)
        if (!out.isConnected) break
        expect(Math.abs(widthOf(el) - extent('CLASSICAL'))).toBeGreaterThan(0) // the width is moving
        expect(screenX()).toBeCloseTo(start, 3)
      }
      advance(2000)
      expect(host.querySelector<HTMLElement>('[data-detent-text-layer]')!.style.translate).toBe('')
      for (const r of roots.splice(0)) act(() => r.unmount())
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(plain)
    }
  })

  it.each(['up', 'down'] as const)('keeps old and new glyph windows whole and hides neighbouring ink (%s)', rollDirection => {
    const label = (text: string) => <DetentText rollDirection={rollDirection}>{text}</DetentText>
    const { host, rerender } = render(label('iii'))
    rerender(label('WWW'))
    const slot = part(host, 'W')
    const windows = [...slot.children] as HTMLElement[]
    expect(windows).toHaveLength(2)
    // The old i and the wider W keep independent painting extents, including overhang room.
    const widths = windows.map(w => w.style.width)
    expect(widths).toEqual(['24px', '28px'])
    expect(slot.style.overflow).not.toBe('hidden')
    for (const [i, w] of windows.entries()) {
      const copy = w.firstElementChild as HTMLElement
      expect(copy.textContent).toBe(i ? 'W' : 'i')
      expect(copy.style.left).toBe('10px')
    }
    const reads = vi.mocked(Range.prototype.getBoundingClientRect).mock.calls.length
    for (const ms of [16, 32, 48]) {
      advance(ms)
      expect(windows.map(w => w.style.width)).toEqual(widths)
    }
    // Moving a glyph never measures it again.
    expect(vi.mocked(Range.prototype.getBoundingClientRect).mock.calls.length).toBe(reads)
    advance(1000)
    expect(host.querySelector('[data-detent-text-part]')).toBeNull()
    expect(content(host).style.opacity).toBe('')
  })

  it.each(['up', 'down'] as const)('keeps a deleted interior run spaced during centered contraction (%s)', rollDirection => {
    const plain = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('centered')) {
        const w = this.style.width ? parseFloat(this.style.width) : extent(content(this).textContent ?? '')
        return new DOMRect(200 - w / 2, 0, w, 20)
      }
      return plain.call(this)
    })
    const label = (text: string) => <DetentText className="centered" rollDirection={rollDirection}>{text}</DetentText>
    const { host, rerender } = render(label('Hello, paraceta'))
    rerender(label('Hello, parse'))
    const outgoing = [...host.querySelectorAll<HTMLElement>('[data-detent-text-part=""]')]
    const x = (node: HTMLElement) => parseFloat(node.style.transform.slice('translateX('.length))
    const c = outgoing.find(p => ink(p).textContent === 'c')!
    const a = outgoing.filter(p => ink(p).textContent === 'a' && x(p) < x(c)).sort((a, b) => x(b) - x(a))[0]!
    const gap = x(c) - x(a)
    expect(gap).toBeGreaterThan(0)
    for (const ms of [16, 32, 48]) {
      advance(ms)
      expect(x(c) - x(a)).toBeCloseTo(gap, 6)
    }
    advance(1000)
    expect(content(host).textContent).toBe('Hello, parse')
  })

  it('keeps wide substituted glyphs apart in left-aligned WWW → iii', () => {
    const { host, rerender } = render(<DetentText>WWW</DetentText>)
    rerender(<DetentText>iii</DetentText>)
    const slots = [...host.querySelectorAll<HTMLElement>('[data-detent-text-part]')]
      .filter(p => [...p.children].some(w => w.firstElementChild?.textContent === 'W'))
    const x = (node: HTMLElement) => parseFloat(node.style.transform.slice('translateX('.length))
    const gaps = slots.map(p => x(p) - x(slots[0]!))
    for (const ms of [16, 32, 48]) {
      advance(ms)
      slots.forEach((p, i) => expect(x(p) - x(slots[0]!)).toBeCloseTo(gaps[i]!, 6))
    }
  })

  it('preserves positions when retargeted mid-flight and cancels the previous completion', () => {
    const complete = vi.fn(), cancel = vi.fn(), start = vi.fn()
    const label = (text: string) => <DetentText onAnimationComplete={complete} onAnimationCancel={cancel} onAnimationStart={start}>{text}</DetentText>
    const { host, rerender } = render(label('Send'))
    rerender(label('Sending…')); advance(80)
    const s = part(host, 'S'), x = s.style.transform
    rerender(label('Sent'))
    expect(part(host, 'S')).toBe(s)
    expect(s.style.transform).toBe(x)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(2)
    expect(frames.size).toBe(1)
    advance(600)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(content(host).textContent).toBe('Sent')
  })
  it('cleans up frames, observers and preference subscriptions on unmount (including StrictMode remounts)', () => {
    const { rerender } = render(<StrictMode><DetentText>One</DetentText></StrictMode>)
    rerender(<StrictMode><DetentText>Two</DetentText></StrictMode>)
    expect(frames.size).toBe(1)
    rerender(null)
    expect(frames.size).toBe(0)
    expect(changes.size).toBe(0)
  })
  it('settles immediately when reduced motion is enabled during a transition', () => {
    const cancel = vi.fn()
    const { host, rerender } = render(<DetentText>Send</DetentText>)
    rerender(<DetentText onAnimationCancel={cancel}>Sending…</DetentText>)
    reduced = true
    act(() => changes.forEach(fn => fn()))
    expect(frames.size).toBe(0)
    expect(content(host).style.opacity).toBe('')
    expect(cancel).toHaveBeenCalledTimes(1)
    rerender(<DetentText>Sent</DetentText>)
    expect(frames.size).toBe(0)
  })
  it('supports whole-label rolling, empty labels, animation opt-out and fixed widths', () => {
    const { host, rerender } = render(<DetentText morph={false} style={{ width: 120 }}>Send</DetentText>)
    rerender(<DetentText morph={false} style={{ width: 120 }}>Sending…</DetentText>)
    expect(host.querySelectorAll('[data-detent-text-part]')).toHaveLength(1)
    advance(600)
    expect((host.firstElementChild as HTMLElement).style.width).toBe('120px')
    rerender(<DetentText animate={false}>{''}</DetentText>)
    expect(content(host).textContent).toBe('')
    expect(frames.size).toBe(0)
    rerender(<DetentText>Hello 👋</DetentText>); advance(600)
    expect(content(host).textContent).toBe('Hello 👋')
  })
  it.each([false, true])('keeps Send → Sending alive through press-scale changes and fractional resize noise (morph=%s)', morph => {
    const cancel = vi.fn(), complete = vi.fn()
    const label = (text: string) => <DetentText morph={morph} onAnimationCancel={cancel} onAnimationComplete={complete}>{text}</DetentText>
    const { host, rerender } = render(label('Send'))
    scale = 0.97
    rerender(label('Sending…'))
    advance(16)
    scale = 0.985; jitter = 0.00006
    act(() => resizes.forEach(cb => cb()))
    expect(cancel).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    expect(content(host).style.opacity).toBe('0')
    scale = 1; jitter = 0
    act(() => resizes.forEach(cb => cb()))
    advance(600)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(content(host).textContent).toBe('Sending…')
  })
  it('respects a fixed width introduced while intrinsic width is animating', () => {
    const { host, rerender } = render(<DetentText>Send</DetentText>)
    rerender(<DetentText>Sending…</DetentText>); advance(60)
    rerender(<DetentText style={{ width: 180 }}>Sending…</DetentText>)
    advance(600)
    expect((host.firstElementChild as HTMLElement).style.width).toBe('180px')
    expect(content(host).style.opacity).toBe('')
  })
  it('bounds transient parts during repeated interruptions and settles the latest arbitrary label', () => {
    const { host, rerender } = render(<DetentText>A</DetentText>)
    for (let i = 0; i < 80; i++) {
      advance(8)
      rerender(<DetentText>{`${i % 2 ? 'Ready' : 'Sending'} ${i} 👩🏽‍💻`}</DetentText>)
      expect(frames.size).toBe(1)
      expect(host.querySelectorAll('[data-detent-text-part]').length).toBeLessThan(513)
    }
    advance(600)
    expect(content(host).textContent).toBe('Ready 79 👩🏽‍💻')
    expect(host.querySelectorAll('[data-detent-text-part]')).toHaveLength(0)
  })
  it('retains native rendering for multiline and complex directionality', () => {
    const { host, rerender } = render(<DetentText>First</DetentText>)
    rerender(<DetentText>{'First\nSecond'}</DetentText>)
    expect(frames.size).toBe(0)
    expect(content(host).style.opacity).toBe('')
    rerender(<DetentText dir="rtl">مرحبا</DetentText>)
    expect(frames.size).toBe(0)
    expect(content(host).textContent).toBe('مرحبا')
  })
  it('does not run transitions or expose text from a discarded concurrent render', async () => {
    const never = new Promise<never>(() => {})
    function Wait({ suspend }: { suspend: boolean }) { if (suspend) throw never; return null }
    const page = (text: string, suspend: boolean) => <Suspense fallback="loading"><DetentText>{text}</DetentText><Wait suspend={suspend} /></Suspense>
    const { host, rerender } = render(page('Send', false))
    await act(async () => startTransition(() => rerender(page('Discarded', true))))
    expect(content(host).textContent).toBe('Send')
    expect(frames.size).toBe(0)
  })
})
