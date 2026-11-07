// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetentNumber } from '../src/number'
import { glyphsOf, tokens } from '../src/number/tokens'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
let now = 0, id = 0, reduced = false, scale = 1, jitter = 0, rounded = false, height = 20
const resizes = new Set<() => void>()
const frames = new Map<number, FrameRequestCallback>()
const changes = new Set<() => void>()
// Deterministic shaped text geometry. Browser checks separately exercise the actual font and Range measurements.
const extent = (text: string) => [...text].reduce((n, c) => n + (c === 'i' ? 4 : 8), 0) - (text.includes('Se') ? 0.25 : 0)
// A class that redistributes the letters (ligatures, tracking, features) while keeping the label's width and height:
// under .even every grapheme takes the same share of the line.
const offset = (node: Node, text: string, i: number) =>
  node.parentElement?.closest('.even') ? extent(text) / [...text].length * i : extent(text.slice(0, i))
const rect = (x: number, width: number) => new DOMRect(x, 0, width, height)
beforeEach(() => {
  now = id = 0; reduced = false; scale = 1; jitter = 0; rounded = false; height = 20; frames.clear(); changes.clear(); resizes.clear()
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
      if (el.hasAttribute('data-detent-number-content')) {
        if (key === 'width') return `${extent(el.textContent ?? '')}px`
        if (key === 'height') return `${height}px`
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, extent(this.textContent ?? '') * scale + (this.hasAttribute('data-detent-number-content') ? jitter : 0), height * scale)
  })
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    // Offsets in the whole label, which may be one text node or a span per part.
    const at = (node: Node, i: number) => {
      const host = node.parentElement!.closest<HTMLElement>('[data-detent-number-content]') ?? node.parentElement!
      const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
      while (walk.nextNode() && walk.currentNode !== node) i += (walk.currentNode as Text).length
      return { host, i }
    }
    const a = at(this.startContainer, this.startOffset), b = at(this.endContainer, this.endOffset)
    const text = a.host.textContent ?? ''
    const start = offset(a.host.firstChild!, text, a.i), end = offset(a.host.firstChild!, text, b.i)
    // WebKit returns whole-pixel range rectangles: floored left, rounded-up right, so neighbours overlap.
    if (rounded) return rect(Math.floor(start * scale) - 1, Math.ceil((end - start) * scale) + 1)
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

const content = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-detent-number-content]')!
const cells = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-detent-number-part]')]
const cell = (host: HTMLElement, text: string) => cells(host).find(c => c.dataset.detentNumberPart === text)!
/** The digits a wheel holds, top to bottom: every value it passes on its way. */
// Each entry draws the whole label shifted by -left; the digit it shows is the character that starts at left.
const shown = (entry: HTMLElement) => {
  const text = entry.textContent!, left = -parseFloat(entry.style.left)
  return [...text].find((_, i) => Math.abs(extent(text.slice(0, i)) - left) < 0.01)!
}
const inner = (node: HTMLElement) => {
  const child = node.firstElementChild as HTMLElement
  return child.style.maskImage === 'inherit' ? child.firstElementChild as HTMLElement : child
}
const wheel = (node: HTMLElement) => ([...inner(node).children] as HTMLElement[])
  .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(shown).join('')
const keys = (value: number, locales = 'en-US', format: Intl.NumberFormatOptions = {}) => {
  const f = new Intl.NumberFormat(locales, format)
  return tokens(f.formatToParts(value), glyphsOf(f))
}
const settle = () => { for (let i = 0; i < 200 && frames.size; i++) advance(16) }

describe('number tokens', () => {
  it('keys digits by decimal place, so the units stay the units from 99 to 100', () => {
    expect(keys(99).map(t => t.key)).toEqual(['i1', 'i0'])
    expect(keys(100).map(t => t.key)).toEqual(['i2', 'i1', 'i0'])
    expect(keys(1.25).map(t => t.key)).toEqual(['i0', 'decimal>:1:.', 'f0', 'f1'])
  })
  it('keys symbols by kind, side and text: a different symbol leaves and the new one enters', () => {
    const usd = keys(-1234.5, 'en-US', { style: 'currency', currency: 'USD' }).map(t => t.key)
    expect(usd).toEqual(['minusSign<:1:-', 'currency<:1:$', 'i3', 'group3:1:,', 'i2', 'i1', 'i0', 'decimal>:1:.', 'f0', 'f1'])
    const eur = keys(1234.5, 'de-DE', { style: 'currency', currency: 'EUR' }).map(t => t.key)
    expect(eur).toContain('group3:1:.')
    expect(eur).toContain('currency>:1:€')
  })
  it('reads digits in any numbering system', () => {
    const t = keys(1234, 'en-US', { numberingSystem: 'fullwide', useGrouping: false })
    expect(t.map(t => t.digit)).toEqual([1, 2, 3, 4])
    expect(t[0]!.text).toBe('１')
  })
})

describe('DetentNumber', () => {
  it('server-renders the formatted number as native text, with no visual copies', () => {
    const html = renderToString(<DetentNumber value={1234.5} locales="en-US" format={{ style: 'currency', currency: 'USD' }} />)
    expect(html).toContain('$1,234.50')
    expect(html).toMatch(/data-detent-number-layer=""[^>]*><\/span>/)
    expect(html).toContain('tabular-nums')
  })

  it('hydrates styled, server-formatted bigint text without recovery or an initial animation', async () => {
    const node = <DetentNumber value={12345678901234567890n} locales="de-DE"
      format={{ style: 'currency', currency: 'EUR' }} classNames={{ currency: 'cur', fraction: 'frac' }} />
    const host = document.createElement('div')
    host.innerHTML = renderToString(node)
    document.body.append(host)
    const html = host.innerHTML, recover = vi.fn()
    await act(async () => { roots.push(hydrateRoot(host, node, { onRecoverableError: recover })) })
    expect(recover).not.toHaveBeenCalled()
    expect(host.innerHTML).toBe(html)
    expect(cells(host)).toHaveLength(0)
    expect(frames.size).toBe(0)
  })

  it('rolls a digit through every value between, then returns to native text', () => {
    const start = vi.fn(), complete = vi.fn()
    const { host, rerender } = render(<DetentNumber value={3} onAnimationStart={start} onAnimationComplete={complete} />)
    rerender(<DetentNumber value={7} onAnimationStart={start} onAnimationComplete={complete} />)
    expect(start).toHaveBeenCalledTimes(1)
    expect(content(host).style.opacity).toBe('0')
    expect(wheel(cell(host, '3'))).toBe('34567')
    settle()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(cells(host)).toHaveLength(0)
    expect(content(host).style.opacity).toBe('')
    expect(content(host).textContent).toBe('7')
  })

  it('rolls with the trend: down when the value shrinks, and the way it is told', () => {
    const { host, rerender } = render(<DetentNumber value={17} />)
    rerender(<DetentNumber value={12} />)
    expect(wheel(cell(host, '7'))).toBe('234567')
    settle()
    // 3 → 7 rolling down passes 2, 1, 0, 9, 8.
    rerender(<DetentNumber value={3} trend="down" />); settle()
    rerender(<DetentNumber value={7} trend="down" />)
    expect(wheel(cell(host, '3'))).toBe('7890123')
  })

  it('does not move when a different value formats the same', () => {
    const start = vi.fn()
    const { host, rerender } = render(<DetentNumber value={1.001} format={{ maximumFractionDigits: 1 }} onAnimationStart={start} />)
    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length
    rerender(<DetentNumber value={1.002} format={{ maximumFractionDigits: 1 }} onAnimationStart={start} />)
    expect(start).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
    expect(cells(host)).toHaveLength(0)
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(reads)
  })

  it('opens the layout gap while the new place rolls in whole (99 → 100)', () => {
    const { host, rerender } = render(<DetentNumber value={99} />)
    rerender(<DetentNumber value={100} />)
    expect(cells(host)).toHaveLength(3)
    const entering = cell(host, '1')
    expect(parseFloat(entering.style.width)).toBeGreaterThan(8)
    expect(wheel(entering)).toBe('1')
    // The units wheel is the units wheel: it starts at 8px and slides to 16px.
    const unitsWheel = cells(host).find(c => c.style.transform === 'translateX(8px)' && c !== entering)!
    expect(wheel(unitsWheel)).toBe('90')
    settle()
    expect(content(host).textContent).toBe('100')
  })

  it('lets a sign and decimals leave and enter without touching the digits around them', () => {
    const format = { maximumFractionDigits: 1 }
    const { host, rerender } = render(<DetentNumber value={-12} format={format} />)
    rerender(<DetentNumber value={12.5} format={format} />)
    expect(cell(host, '-')).toBeTruthy()
    expect(parseFloat(cell(host, '.').style.width)).toBeGreaterThan(0)
    expect(parseFloat(cell(host, '5').style.width)).toBeGreaterThan(0)
    expect(wheel(cell(host, '1'))).toBe('1')
    advance(5000); settle()
    expect(cells(host)).toHaveLength(0)
    expect(content(host).textContent).toBe('12.5')
  })

  it('does not squeeze a new digit or an exiting sign through the layout width', () => {
    const { host, rerender } = render(<DetentNumber value={-9} />)
    rerender(<DetentNumber value={100} />)
    const entering = cell(host, '1'), leaving = cell(host, '-')
    const root = host.querySelector<HTMLElement>('[data-detent-number]')!
    const layoutWidth = root.style.width
    const leavingWidth = leaving.style.width
    const width = entering.style.width
    expect(parseFloat(width)).toBeGreaterThan(8) // painting includes side room for proportional glyphs
    for (const ms of [16, 32, 64]) {
      advance(ms)
      expect(entering.style.width).toBe(width)
      expect(leaving.style.width).toBe(leavingWidth)
    }
    expect(root.style.width).not.toBe(layoutWidth)
    settle()
    expect(content(host).style.opacity).toBe('')
    expect(cells(host)).toHaveLength(0)
  })

  it('keeps removed columns separated from the surviving units during 10,000 → 9', () => {
    const { host, rerender } = render(<DetentNumber value={10000} locales="en-US" />)
    rerender(<DetentNumber value={9} locales="en-US" />)
    // The next map starts with the surviving units; the other columns remain until their exit finishes.
    const [units, ...leaving] = cells(host)
    expect(leaving.length).toBeGreaterThan(1)
    const x = (node: HTMLElement) => parseFloat(node.style.transform.slice('translateX('.length))
    const gaps = leaving.map(c => x(c) - x(units!))
    for (const ms of [16, 32, 48, 64]) {
      advance(ms)
      leaving.forEach((c, i) => expect(x(c) - x(units!)).toBeCloseTo(gaps[i]!, 6))
    }
    settle()
    expect(content(host).textContent).toBe('9')
    expect(cells(host)).toHaveLength(0)
  })

  it.each([[79, 80, 81], [81, 80, 79]])('keeps an unchanged digit still when %i → %i is interrupted by %i, overshoot included', (a, b, c) => {
    // The tens' spring settles just past its row; an update then must not count from the next row and send the
    // unchanged digit round a whole turn.
    for (const snap of [320, 700]) for (let ms = 16; ms <= 640; ms += 16) {
      const { host, rerender } = render(<DetentNumber value={a} snapDuration={snap} />)
      settle()
      rerender(<DetentNumber value={b} snapDuration={snap} />)
      advance(ms)
      rerender(<DetentNumber value={c} snapDuration={snap} />)
      const tens = cells(host)[0]
      if (tens) expect(wheel(tens).length, `${snap} ms roll, interrupted at ${ms} ms`).toBeLessThanOrEqual(2)
      settle()
      expect(content(host).textContent).toBe(String(c))
    }
  })

  it('retargets a rolling wheel from where it is drawn, without a jump', () => {
    const cancel = vi.fn()
    const { host, rerender } = render(<DetentNumber value={0} onAnimationCancel={cancel} />)
    rerender(<DetentNumber value={5} onAnimationCancel={cancel} />)
    advance(80)
    const node = cell(host, '0')
    const drawn = inner(node)
    const before = drawn.style.transform
    rerender(<DetentNumber value={9} onAnimationCancel={cancel} />)
    expect(cancel).toHaveBeenCalledTimes(1)
    const y = (t: string) => parseFloat(t.slice('translateY('.length))
    expect(y(drawn.style.transform)).toBeCloseTo(y(before), 6)
    // Digits already passed are dropped; the rest of the way, up to 9, is added.
    expect(wheel(node)).toMatch(/^[1-5]+6789$/)
    settle()
    expect(content(host).textContent).toBe('9')
  })

  it.each([16, 80, 160, 320])('does not rewind departing wheels when 9,999 → 10,000 is interrupted after %s ms', ms => {
    const { host, rerender } = render(<DetentNumber value={9999} locales="en-US" />)
    rerender(<DetentNumber value={10000} locales="en-US" />)
    advance(ms)
    // These three rolling columns disappear on the next update; the rightmost (units) survives.
    const removed = cells(host).filter(c => c.dataset.detentNumberPart === '9').slice(0, 3)
    expect(removed).toHaveLength(3)
    const before = removed.map(c => inner(c).style.transform)
    rerender(<DetentNumber value={9} locales="en-US" />)
    expect(removed.map(c => inner(c).style.transform)).toEqual(before)
    const exits = removed.map(c => inner(c).parentElement!)
    exits.forEach(exit => {
      expect(exit.style.overflow).toBe('hidden')
      expect(exit.style.maskImage).toBe('inherit')
    })
    advance(32)
    expect(removed.map(c => inner(c).style.transform)).toEqual(before)
    expect(exits.every(exit => exit.style.transform !== 'translateY(0px)')).toBe(true)
    // Interrupt again while the same historical columns are still leaving.
    const interrupted = removed.map(c => inner(c).style.transform)
    rerender(<DetentNumber value={0} locales="en-US" />)
    expect(removed.map(c => inner(c).style.transform)).toEqual(interrupted)
    settle()
    expect(content(host).textContent).toBe('0')
    expect(cells(host)).toHaveLength(0)
  })

  it('unwraps a frozen exit when an interrupted contraction restores its decimal place', () => {
    const { host, rerender } = render(<DetentNumber value={9999} locales="en-US" />)
    rerender(<DetentNumber value={10000} locales="en-US" />)
    advance(80)
    const thousands = cells(host).find(c => c.dataset.detentNumberPart === '9')!
    rerender(<DetentNumber value={9} locales="en-US" />)
    expect(inner(thousands).parentElement).not.toBe(thousands)
    advance(32)
    rerender(<DetentNumber value={10000} locales="en-US" />)
    expect(inner(thousands).parentElement).toBe(thousands)
    settle()
    expect(content(host).textContent).toBe('10,000')
    expect(cells(host)).toHaveLength(0)
  })

  it('preserves the visible offset when a newly entering column leaves and then returns', () => {
    const { host, rerender } = render(<DetentNumber value={9} locales="en-US" />)
    rerender(<DetentNumber value={10000} locales="en-US" />)
    advance(80)
    const entering = cell(host, '1')
    const y = (s: string) => parseFloat(s.slice('translateY('.length))
    const painted = () => {
      const ink = inner(entering)
      return parseFloat(ink.style.top) + y(ink.style.transform) + (ink.parentElement === entering ? 0 : y(ink.parentElement!.style.transform))
    }
    const before = painted()
    rerender(<DetentNumber value={9} locales="en-US" />)
    expect(painted()).toBeCloseTo(before, 6)
    advance(32)
    const leaving = painted()
    rerender(<DetentNumber value={10000} locales="en-US" />)
    expect(painted()).toBeCloseTo(leaving, 6)
    settle()
    expect(content(host).textContent).toBe('10,000')
  })

  it('rolls when the browser rounds glyph positions to whole pixels (WebKit), drawing digits where the text does', () => {
    rounded = true
    scale = 1.37
    const { host, rerender } = render(<DetentNumber value={12} />)
    rerender(<DetentNumber value={13} />)
    expect(cells(host)).toHaveLength(2)
    const units = cell(host, '2')
    expect(inner(units).children).toHaveLength(2) // 2 and 3
    // Cell offset and entry offset cancel: the digit sits at the native text's position, whatever the rounding.
    const entry = inner(units).firstElementChild as HTMLElement
    expect(parseFloat(units.style.transform.slice('translateX('.length)) + parseFloat(entry.style.left)).toBeCloseTo(0, 5)
  })

  it('splits the native text into a span per part with classNames, and the rolling copies carry the classes', () => {
    const classNames = { currency: 'cur', integer: 'int', fraction: 'frac', decimal: 'dec', group: 'grp', sign: 'sgn' }
    const format = { style: 'currency', currency: 'USD' } as const
    const html = renderToString(<DetentNumber value={-1234.5} locales="en-US" format={format} classNames={classNames} />)
    expect(html).toContain('<span class="sgn">-</span><span class="cur">$</span><span class="int">1</span><span class="grp">,</span>')
    const { host, rerender } = render(<DetentNumber value={1234.5} locales="en-US" format={format} classNames={classNames} />)
    expect(content(host).textContent).toBe('$1,234.50')
    rerender(<DetentNumber value={1234.75} locales="en-US" format={format} classNames={classNames} />)
    // The tenths wheel (5 → 7) is drawn from copies of the styled label, positioned on the 5's own text node.
    const tenths = cell(host, '5')
    expect(wheel(tenths)).toBe('567')
    const entry = inner(tenths).firstElementChild as HTMLElement
    expect(entry.querySelector('.frac')).toBeTruthy()
    expect(entry.querySelector('.cur')!.textContent).toBe('$')
    expect(parseFloat(tenths.style.transform.slice('translateX('.length))).toBe(extent('$1,234.'))
    settle()
    expect(content(host).querySelector('.frac')!.textContent).toBe('75')
  })

  it('measures again when classNames change', () => {
    const reads = vi.mocked(Range.prototype.getBoundingClientRect)
    const { rerender } = render(<DetentNumber value={12} classNames={{ integer: 'a' }} />)
    const before = reads.mock.calls.length
    rerender(<DetentNumber value={12} classNames={{ integer: 'a' }} />)
    expect(reads.mock.calls.length).toBe(before)
    rerender(<DetentNumber value={12} classNames={{ integer: 'b' }} />)
    expect(reads.mock.calls.length).toBeGreaterThan(before)
  })

  it('uses the new part classes on every wheel when the value and classes change together', () => {
    const { host, rerender } = render(<DetentNumber value={12} classNames={{ integer: 'old-font' }} />)
    rerender(<DetentNumber value={13} classNames={{ integer: 'new-font' }} />)
    for (const c of cells(host)) {
      for (const entry of inner(c).children) {
        expect(entry.querySelector('.new-font')).toBeTruthy()
        expect(entry.querySelector('.old-font')).toBeNull()
      }
    }
  })

  it('updates retained digits when the numbering system changes', () => {
    const { host, rerender } = render(<DetentNumber value={12} locales="en-US" />)
    rerender(<DetentNumber value={13} locales="en-US" />)
    advance(80)
    rerender(<DetentNumber value={14} locales="en-US" format={{ numberingSystem: 'fullwide' }} />)
    for (const c of cells(host)) {
      for (const entry of inner(c).children) {
        const visible = entry.querySelector<HTMLElement>('span[style*="visibility: visible"]')!
        expect(visible.textContent).toMatch(/^[０-９]$/u)
      }
    }
  })

  it('bounds the pending digit rows during a burst of interrupted updates', () => {
    const { host, rerender } = render(<DetentNumber value={0} />)
    for (let i = 1; i <= 100; i++) rerender(<DetentNumber value={i} />)
    expect(Math.max(...cells(host).map(c => inner(c).children.length))).toBeLessThanOrEqual(12)
    settle()
    expect(content(host).textContent).toBe('100')
  })

  it.each([20, 48])('keeps the extra mask margins transparent at a line height of %s', lineHeight => {
    height = lineHeight
    const { host, rerender } = render(<DetentNumber value={1} locales="en-US" />)
    rerender(<DetentNumber value={2} locales="en-US" />)
    const cell = host.querySelector<HTMLElement>('[data-detent-number-part]')!
    const pad = lineHeight / 8, edge = pad + lineHeight / 32
    expect(cell.style.maskImage).toContain(`transparent ${pad}px`)
    expect(cell.style.maskImage).toContain(`#000 ${edge}px`)
    expect(cell.style.maskImage).toContain(`transparent calc(100% - ${pad}px)`)
    advance(800)
    expect(host.querySelector('[data-detent-number-part]')).toBeNull()
    expect(host.querySelector<HTMLElement>('[data-detent-number-content]')!.style.opacity).toBe('')
  })

  it('keeps an unchanged digit still with a fractional line height', () => {
    height = 26.4
    const { host, rerender } = render(<DetentNumber value={34} />)
    rerender(<DetentNumber value={33} />)
    expect(wheel(cell(host, '3'))).toBe('3')
  })

  it('falls back to native text for unusually long numbers instead of cloning a huge label per digit', () => {
    const { host, rerender } = render(<DetentNumber value={10n ** 200n} />)
    rerender(<DetentNumber value={10n ** 200n + 1n} />)
    expect(cells(host)).toHaveLength(0)
    expect(content(host).textContent).toBe(new Intl.NumberFormat().format(10n ** 200n + 1n))
  })

  it('cancels the old styled copies when classes change mid-animation without a value change', () => {
    const cancel = vi.fn()
    const { host, rerender } = render(<DetentNumber value={12} classNames={{ integer: 'old-font' }} />)
    rerender(<DetentNumber value={13} classNames={{ integer: 'old-font' }} onAnimationCancel={cancel} />)
    advance(80)
    rerender(<DetentNumber value={13} classNames={{ integer: 'new-font' }} onAnimationCancel={cancel} />)
    expect(cells(host)).toHaveLength(0)
    expect(content(host).style.opacity).toBe('')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('measures a number with one Range, however many digits and symbols it has', () => {
    const ranges = vi.spyOn(document, 'createRange')
    const { rerender } = render(<DetentNumber value={1234567.89} locales="en-US" format={{ style: 'currency', currency: 'USD' }} />)
    const before = ranges.mock.calls.length
    rerender(<DetentNumber value={7654321.98} locales="en-US" format={{ style: 'currency', currency: 'USD' }} />)
    expect(ranges.mock.calls.length - before).toBe(1)
  })

  it('pins every rolling column to its cell, whatever text-align it inherits', () => {
    const { host, rerender } = render(<div style={{ textAlign: 'center' }}><DetentNumber value={50.5} /></div>)
    rerender(<div style={{ textAlign: 'center' }}><DetentNumber value={37.88} /></div>)
    expect(cells(host).length).toBeGreaterThan(0)
    for (const c of cells(host)) expect(inner(c).style.left).toBe(`${height / 2}px`)
  })

  it('settles at once with reduced motion or animate={false}', () => {
    reduced = true
    const { host, rerender } = render(<DetentNumber value={1} />)
    rerender(<DetentNumber value={2} />)
    expect(cells(host)).toHaveLength(0)
    reduced = false
    rerender(<DetentNumber value={3} animate={false} />)
    expect(cells(host)).toHaveLength(0)
    expect(content(host).textContent).toBe('3')
  })

  it('keeps a visibility-hidden number hidden rather than creating explicitly visible digit copies', () => {
    const { host, rerender } = render(<DetentNumber value={12} style={{ visibility: 'hidden' }} />)
    rerender(<DetentNumber value={13} style={{ visibility: 'hidden' }} />)
    expect(cells(host)).toHaveLength(0)
    expect(content(host).textContent).toBe('13')
  })

  it('cleans up frames, observers and subscriptions on unmount, including StrictMode remounts', () => {
    const { rerender } = render(<StrictMode><DetentNumber value={1} /></StrictMode>)
    rerender(<StrictMode><DetentNumber value={2} /></StrictMode>)
    expect(resizes.size).toBe(1)
    act(() => roots.pop()!.unmount())
    expect(resizes.size).toBe(0)
    expect(changes.size).toBe(0)
    expect(frames.size).toBe(0)
  })
})
