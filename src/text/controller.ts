import { align, measure, segments, type Layout, type Piece } from './layout'
import { axis, copy, exitTargets, fadeWindow, move, roll, sample, type Axis, type RollOptions } from './roll'

export interface TextOptions extends RollOptions {
  morph: boolean
  locale?: string
  rollDirection: 'up' | 'down'
}
type Row = { node: HTMLElement; window: HTMLElement; y: Axis; incoming: boolean }
type Part = { follow?: Part; node: HTMLElement; text: string | null; x: Axis; rows: Row[] }

/** Matching graphemes keep their place; changed ones roll. */
export function textController(root: HTMLElement, content: HTMLElement, layer: HTMLElement) {
  let parts: Part[] = []
  // Layout measures the shaped run, so isolated graphemes use its native positions (including kerning).
  // Each row has its own stationary viewport: layout width must never reveal a glyph sideways as it rolls.
  function update(row: Row, piece: Piece, source: Layout) {
    const padX = source.height / 2
    row.node.textContent = piece.text
    row.node.style.left = `${padX}px`
    // Side room belongs to this glyph, not to its advance: italic overhangs and negative tracking stay intact.
    Object.assign(row.window.style, { position: 'absolute', overflow: 'hidden', width: `${piece.width + 2 * padX}px` })
    const pad = fadeWindow(row.window, { ...source, left: source.left - padX })
    row.node.style.top = `${pad}px`
  }
  function leaf(piece: Piece, source: Layout, incoming: boolean, y = 0): Row {
    const row = { node: copy('', 0), window: document.createElement('span'), incoming, y: axis(y) }
    row.window.append(row.node)
    update(row, piece, source)
    return row
  }
  function make(piece: Piece, source: Layout, o: TextOptions, appearing = false): Part {
    const node = document.createElement('span')
    node.setAttribute('data-detent-text-part', piece.text)
    Object.assign(node.style, { position: 'absolute', left: '0', top: '0', transform: `translateX(${piece.left}px)`, width: `${piece.width}px` })
    layer.append(node)
    const row = leaf(piece, source, true, appearing ? source.height * (o.rollDirection === 'up' ? 1 : -1) : 0)
    node.append(row.window)
    return { node, text: piece.text, x: axis(piece.left), rows: [row] }
  }

  return roll<Layout, TextOptions>(root, content, layer, {
    measure: (text, o) => measure(root, content, text, o.morph ? t => segments(t, o.locale) : undefined),
    animatable: (old, next, previous, o) =>
      old.safe && next.safe && previous.morph === o.morph && previous.locale === o.locale && parts.length <= 512,
    begin(old, o) { parts = old.pieces.map(piece => make(piece, old, o)) },
    transition(_, measured, o) {
      const oldParts = parts.filter(part => part.text !== null)
      const outgoing = parts.filter(part => part.text === null)
      // Keep a departing glyph at its own horizontal origin. If its replacement belongs elsewhere, give
      // that replacement a new slot; moving one shared slot would squeeze wide outgoing neighbours together.
      const pairs = align(oldParts.map(part => part.text!), measured.pieces.map(piece => piece.text)).flatMap(([i, j]) =>
        i !== null && j !== null && oldParts[i]!.text !== measured.pieces[j]!.text &&
          Math.abs(measured.pieces[j]!.left - oldParts[i]!.x.x) > 0.5 ? [[i, null], [null, j]] as const : [[i, j]] as const)
      const nextParts: Part[] = []
      let duration = 0
      const go = (a: Axis, to: number) => { duration = Math.max(duration, move(a, to, o)) }
      const targets = new Map(pairs.flatMap(([i, j]) => i !== null && j !== null
        ? [[oldParts[i]!, measured.pieces[j]!.left] as const] : []))
      const exit = exitTargets(oldParts, targets)
      const leave = (part: Part) => go(part.x, exit(part))
      const reach = measured.height
      const exitY = reach * (o.rollDirection === 'up' ? -1 : 1)
      for (const [i, j] of pairs) {
        const piece = j === null ? null : measured.pieces[j]!
        const part = i === null ? make(piece!, measured, o, true) : oldParts[i]!
        const changed = part.text !== piece?.text
        // Retarget from the actual on-screen positions and velocities. Off-screen historical rows can be dropped.
        part.rows = part.rows.filter(row => {
          if (!row.incoming && Math.abs(row.y.x) >= reach) { row.window.remove(); return false }
          return true
        })
        if (changed && piece) {
          part.rows.forEach(row => { row.incoming = false })
          const row = leaf(piece, measured, true, -exitY)
          part.node.append(row.window); part.rows.push(row)
        } else if (piece) {
          const row = part.rows.find(row => row.incoming)!
          update(row, piece, measured)
        }
        if (!piece) part.rows.forEach(row => { row.incoming = false })
        for (const row of part.rows) go(row.y, row.incoming ? 0 : exitY)
        if (piece) { go(part.x, piece.left); part.node.style.width = `${piece.width}px` }
        else leave(part)
        part.text = piece?.text ?? null
        part.node.setAttribute('data-detent-text-part', part.text ?? '')
        nextParts.push(part)
      }
      for (const part of outgoing) {
        if (part.rows.every(row => Math.abs(row.y.x) >= reach)) { part.node.remove(); continue }
        leave(part)
        for (const row of part.rows) go(row.y, exitY)
        nextParts.push(part)
      }
      parts = nextParts
      return duration
    },
    paint(t) {
      for (const part of parts) {
        sample(part.x, t)
        if (part.x.motion) part.node.style.transform = `translateX(${part.x.x}px)`
        for (const row of part.rows) {
          sample(row.y, t)
          if (row.y.motion) row.node.style.transform = `translateY(${row.y.x}px)`
        }
      }
    },
    shift(dx) {
      for (const part of parts) { part.x.x += dx; part.node.style.transform = `translateX(${part.x.x}px)` }
    },
    clear() { parts = [] },
  })
}
