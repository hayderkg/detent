import { measureWhole as measure, type Layout, type Piece } from '../text/layout'
import { axis, exitTargets, fadeWindow, move, roll, sample, type Axis, type RollOptions } from '../text/roll'
import type { Token } from './tokens'

/** `snapshot`: the native text as it was measured, with its part spans and their classes, for the visual copies. */
type NumberLayout = Layout & { tokens: Token[]; snapshot: HTMLElement }
type Cell = {
  follow?: Cell
  exit?: HTMLElement
  node: HTMLElement; inner: HTMLElement; wheel: boolean; leaving: boolean
  x: Axis; y: Axis
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
    // Fixed glyph window, independent of the root's animated layout width. Side room keeps wide intermediate
    // digits intact in proportional fonts, even when the target digit is narrow or a new column is entering.
    const padX = l.height / 2
    cell.node.style.width = `${piece.width + 2 * padX}px`
    const pad = fadeWindow(cell.node, { ...l, left: l.left - padX })
    // Pin the column explicitly: inherited text-align must not move an absolute box's static position.
    cell.inner.style.left = `${padX}px`
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
    if (cell.exit) cell.exit.style.transform = `translateY(${cell.y.x}px)`
    cell.inner.style.transform = `translateY(${(cell.exit ? 0 : cell.y.x) - cell.pos.x}px)`
  }
  function make(token: Token, piece: Piece, l: NumberLayout, entering: boolean): Cell {
    const node = document.createElement('span'), inner = document.createElement('span')
    node.setAttribute('data-detent-number-part', token.text)
    node.style.position = inner.style.position = 'absolute'
    node.style.overflow = 'hidden'
    node.append(inner); layer.append(node)
    const wheel = token.digit >= 0
    // A new symbol or digit rolls in with the number's trend: from below when it grows.
    const cell: Cell = { node, inner, wheel, leaving: false, x: axis(piece.left),
      y: axis(entering ? l.height * (trend < 0 ? -1 : 1) : 0), pos: axis(wheel ? token.digit * l.height : 0), target: token.digit,
      height: l.height }
    place(cell, l, piece); draw(cell)
    return cell
  }

  const controller = roll<NumberLayout, RollOptions>(root, content, layer, {
    measure(text) {
      const l: NumberLayout = Object.assign(measure(root, content, text), { tokens, snapshot: content.cloneNode(true) as HTMLElement })
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
      const targets = new Map(next.tokens.flatMap((token, i) => {
        const cell = cells.get(token.key)
        return cell ? [[cell, next.pieces[i]!.left] as const] : []
      }))
      const exit = exitTargets([...cells.values()].filter(cell => !cell.leaving), targets)
      next.tokens.forEach((token, i) => {
        const piece = next.pieces[i]!
        const cell = cells.get(token.key) ?? make(token, piece, next, true)
        if (cell.exit) {
          cell.y.x += parseFloat(cell.inner.style.top) - cell.height / 8
          cell.exit.replaceWith(cell.inner); cell.exit = undefined
        }
        cell.leaving = false
        if (cell.wheel) {
          // Retarget from the visible turn, not the last destination: rapid updates must not queue whole revolutions.
          const at = row(cell), reached = cell.target
          cell.target = trend > 0 ? Math.ceil(at) : trend < 0 ? Math.floor(at) : Math.round(at)
          // A spring settling just past its row is still on that row: counting from the next one would send an
          // unchanged digit round a whole turn (80 → 81 during the tens' overshoot turning 8 through 9, 0… back to 8).
          if (trend > 0 ? at > reached && at < reached + 1 : trend < 0 && at < reached && at > reached - 1) cell.target = reached
          // Up rolls forward (7 → 2 passes 8, 9, 0, 1), down backward; no trend takes the shorter way.
          let delta = mod(token.digit - mod(cell.target))
          if (trend < 0 && delta) delta -= 10
          else if (!trend && delta > 5) delta -= 10
          cell.target += delta
        }
        place(cell, next, piece)
        if (cell.wheel) go(cell.pos, cell.target * next.height)
        go(cell.x, piece.left); go(cell.y, 0)
        nextCells.set(token.key, cell)
      })
      for (const [key, cell] of cells) {
        if (nextCells.has(key)) continue
        if (cell.leaving && Math.abs(cell.y.x) >= cell.height) { cell.node.remove(); continue }
        if (!cell.exit) {
          // Leave with only the currently visible slice. Moving a whole wheel backwards can bring a previous
          // row back into view (10,000 → 9 showing 9 999), even if its digit roll has already reached zero.
          const exit = document.createElement('span')
          Object.assign(exit.style, { position: 'absolute', inset: '0', overflow: 'hidden', maskImage: 'inherit' })
          cell.node.append(exit); exit.append(cell.inner); cell.exit = exit
          cell.pos.motion = undefined; cell.pos.v = 0
          // A column can be removed while still entering: bake its current offset into the frozen slice.
          cell.inner.style.top = `${parseFloat(cell.inner.style.top) + cell.y.x}px`
          cell.y.x = 0
        }
        cell.leaving = true
        go(cell.x, exit(cell)); go(cell.y, next.height * (trend < 0 ? 1 : -1))
        nextCells.set(key, cell)
      }
      cells = nextCells
      return duration
    },
    paint(t) {
      for (const cell of cells.values()) {
        sample(cell.x, t); sample(cell.y, t); sample(cell.pos, t)
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
