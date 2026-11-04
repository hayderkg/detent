import { measure, type Layout, type Piece } from '../text/layout'
import { axis, fadeWindow, move, roll, sample, type Axis, type RollOptions } from '../text/roll'
import type { Token } from './tokens'

/** `snapshot`: the native text as it was measured, with its part spans and their classes, for the visual copies. */
type NumberLayout = Layout & { tokens: Token[]; snapshot: HTMLElement }
type Cell = {
  node: HTMLElement; inner: HTMLElement; wheel: boolean; leaving: boolean
  x: Axis; width: Axis; y: Axis
  /**
   * Wheel position in px, one row height per digit: 7h shows a 7, 12h a 2. Unbounded, so a roll can pass through
   * every digit between. Pixels, like every other axis, so the springs' rest thresholds mean the same thing.
   */
  pos: Axis; target: number; height: number
}
const mod = (n: number) => ((n % 10) + 10) % 10
// Fractional line heights must not turn 3 into 2.9999999999999996 and queue an extra revolution.
const row = (cell: Cell) => Math.round(cell.pos.x / cell.height * 1e7) / 1e7
/** The text node and offset at a character offset of the whole label, whether it is one text node or part spans. */
function locate(node: Node, offset: number, end: boolean): [Text, number] {
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let text: Text | null = null
  while (walk.nextNode()) {
    text = walk.currentNode as Text
    if (offset < text.length || (end && offset === text.length)) break
    offset -= text.length
  }
  return [text!, Math.min(offset, text!.length)]
}
/**
 * A visual copy of the label as measured, shifted so that `piece` sits at the cell's origin: the cell offset and
 * this shift cancel, so the piece lands exactly where the native text draws it, with its part styles, even when the
 * browser rounds measured positions. Only the piece is visible: a neighbour's ink reaching past its advance would
 * otherwise slip into the cell as it rolls. With `glyph`, that digit is drawn in the piece's place.
 */
function copyOf(l: NumberLayout, piece: Piece, glyph?: string) {
  const node = l.snapshot.cloneNode(true) as HTMLElement
  node.removeAttribute('data-detent-number-content')
  const [text, at] = locate(node, piece.start, false)
  const shown = document.createElement('span')
  shown.style.visibility = 'visible'
  shown.textContent = glyph ?? piece.text
  text.splitText(at).splitText(piece.end - piece.start)
  text.nextSibling!.replaceWith(shown)
  Object.assign(node.style, { position: 'absolute', left: `${-piece.left}px`, opacity: '1', visibility: 'hidden' })
  return node
}

/** Digits are wheels that roll through the values between; symbols enter and leave; everything slides into place. */
export function numberController(root: HTMLElement, content: HTMLElement, layer: HTMLElement) {
  let tokens: Token[] = [], glyphs: readonly string[] = [], trend = 0
  let cells = new Map<string, Cell>()

  /** Entries for every digit the wheel shows on its way, and none it no longer will. */
  function place(cell: Cell, l: NumberLayout, piece: Piece) {
    // Keep the native baseline; the shared mask hides neighbouring digits outside the line and softens its edges.
    const pad = fadeWindow(cell.node, l)
    // Pin the rolling column to the cell's left edge. Left unset, an absolute box sits at its static position, which
    // an inherited text-align (a centred or right-aligned label) moves: the copies would land beside their window.
    cell.inner.style.left = '0'
    cell.inner.style.top = `${pad}px`
    // A new font size keeps the wheel on the same digit, moving at the same rate.
    const scale = l.height / cell.height || 1
    cell.pos.x *= scale; cell.pos.v *= scale
    cell.height = l.height
    // A new layout may change part classes, digit glyphs or their offsets. Never retain copies of the old label.
    cell.inner.replaceChildren()
    if (!cell.wheel) { cell.inner.append(copyOf(l, piece)); return }
    const at = row(cell)
    const from = Math.floor(Math.min(at, cell.target)), to = Math.ceil(Math.max(at, cell.target))
    for (let i = from; i <= to; i++) {
      const node = copyOf(l, piece, glyphs[mod(i)])
      cell.inner.append(node)
      node.style.top = `${i * l.height}px`
    }
  }
  function draw(cell: Cell) {
    cell.node.style.transform = `translateX(${cell.x.x}px)`
    cell.node.style.width = `${Math.max(0, cell.width.x)}px`
    cell.inner.style.transform = `translateY(${cell.y.x - cell.pos.x}px)`
  }
  function make(token: Token, piece: Piece, l: NumberLayout, entering: boolean): Cell {
    const node = document.createElement('span'), inner = document.createElement('span')
    node.setAttribute('data-detent-number-part', token.text)
    node.style.position = inner.style.position = 'absolute'
    node.style.overflow = 'hidden'
    node.append(inner); layer.append(node)
    const wheel = token.digit >= 0
    // A new symbol or digit rolls in with the number's trend: from below when it grows.
    const cell: Cell = { node, inner, wheel, leaving: false, x: axis(piece.left), width: axis(entering ? 0 : piece.width),
      y: axis(entering ? l.height * (trend < 0 ? -1 : 1) : 0), pos: axis(wheel ? token.digit * l.height : 0), target: token.digit,
      height: l.height }
    place(cell, l, piece); draw(cell)
    return cell
  }

  const controller = roll<NumberLayout, RollOptions>(root, content, layer, {
    measure(text) {
      const l = measure(root, content, text) as NumberLayout
      l.tokens = tokens
      l.snapshot = content.cloneNode(true) as HTMLElement
      // One range per token, wherever its characters are (a single text node, or the part spans of `classNames`).
      // No ligature merging: digits are never joined, and the copies place every glyph exactly anyway.
      if (l.safe && text && content.firstChild) {
        const box = content.getBoundingClientRect(), scaleX = box.width / l.width || 1
        let at = 0
        // One Range moved from token to token: live Ranges slow every DOM mutation until they are collected.
        const range = document.createRange()
        l.pieces = tokens.map(t => {
          range.setStart(...locate(content, at, false))
          range.setEnd(...locate(content, at += t.text.length, true))
          return { text: t.text, start: at - t.text.length, end: at, left: (range.getBoundingClientRect().left - box.left) / scaleX, width: 0 }
        })
        // Each piece reaches the next: margins and letter spacing between parts travel with the piece before them.
        l.pieces.forEach((piece, i) => { piece.width = Math.max(0, (l.pieces[i + 1]?.left ?? l.width) - piece.left) })
      }
      // Bidirectional text cannot be cut into tokens: such a label changes without rolling.
      l.safe &&= l.pieces.length === tokens.length
      return l
    },
    animatable: (old, next) => old.safe && next.safe && old.tokens.length <= 160 && next.tokens.length <= 160 && cells.size <= 256,
    begin(old) { cells = new Map(old.tokens.map((t, i) => [t.key, make(t, old.pieces[i]!, old, false)])) },
    transition(_, next, o) {
      let duration = 0
      const go = (a: Axis, to: number) => { duration = Math.max(duration, move(a, to, o)) }
      const nextCells = new Map<string, Cell>()
      next.tokens.forEach((token, i) => {
        const piece = next.pieces[i]!
        const cell = cells.get(token.key) ?? make(token, piece, next, true)
        cell.leaving = false
        if (cell.wheel) {
          // Retarget from the visible turn, not the last destination: rapid updates must not queue whole revolutions.
          const at = row(cell)
          cell.target = trend > 0 ? Math.ceil(at) : trend < 0 ? Math.floor(at) : Math.round(at)
          // Up rolls forward (7 → 2 passes 8, 9, 0, 1), down backward; no trend takes the shorter way.
          let delta = mod(token.digit - mod(cell.target))
          if (trend < 0 && delta) delta -= 10
          else if (!trend && delta > 5) delta -= 10
          cell.target += delta
        }
        place(cell, next, piece)
        if (cell.wheel) go(cell.pos, cell.target * next.height)
        go(cell.x, piece.left); go(cell.width, piece.width); go(cell.y, 0)
        nextCells.set(token.key, cell)
      })
      for (const [key, cell] of cells) {
        if (nextCells.has(key)) continue
        if (cell.leaving && cell.width.x <= 0.001) { cell.node.remove(); continue }
        cell.leaving = true
        go(cell.x, cell.x.x); go(cell.width, 0); go(cell.y, next.height * (trend < 0 ? 1 : -1))
        nextCells.set(key, cell)
      }
      cells = nextCells
      return duration
    },
    paint(t) {
      for (const cell of cells.values()) {
        sample(cell.x, t); sample(cell.width, t); sample(cell.y, t); sample(cell.pos, t)
        draw(cell)
      }
    },
    shift(dx) {
      for (const cell of cells.values()) { cell.x.x += dx; draw(cell) }
    },
    clear() { cells = new Map() },
  })
  return {
    /** `direction`: 1 when the value grew, -1 when it shrank, 0 to take each digit's shorter way. */
    commit(text: string, o: RollOptions, look: unknown, next: Token[], digits: readonly string[], direction: number) {
      tokens = next; glyphs = digits; trend = direction
      controller.commit(text, o, look)
    },
    destroy: controller.destroy,
  }
}
