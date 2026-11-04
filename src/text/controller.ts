import { align, measure, segments, type Layout, type Piece } from './layout'
import { axis, copy, fadeWindow, move, roll, sample, type Axis, type RollOptions } from './roll'

export interface TextOptions extends RollOptions {
  morph: boolean
  locale?: string
  rollDirection: 'up' | 'down'
}
type Row = { node: HTMLElement; y: Axis; incoming: boolean }
type Part = { node: HTMLElement; text: string | null; x: Axis; width: Axis; rows: Row[] }

/** Matching graphemes keep their place; changed ones roll. */
export function textController(root: HTMLElement, content: HTMLElement, layer: HTMLElement) {
  let parts: Part[] = []
  const leaf = (piece: Piece, source: Layout, incoming: boolean, y = 0): Row =>
    ({ node: copy(source.text, -piece.left), incoming, y: axis(y) })
  function place(part: Part, l: Layout) {
    // Keep the copies on the native baseline within the shared soft viewport.
    const pad = fadeWindow(part.node, l)
    for (const row of part.rows) row.node.style.top = `${pad}px`
  }
  function make(piece: Piece, source: Layout, o: TextOptions, appearing = false): Part {
    const node = document.createElement('span')
    node.setAttribute('data-detent-text-part', piece.text)
    Object.assign(node.style, { position: 'absolute', overflow: 'hidden',
      transform: `translateX(${piece.left}px)`, width: `${appearing ? 0 : piece.width}px` })
    layer.append(node)
    const row = leaf(piece, source, true, appearing ? source.height * (o.rollDirection === 'up' ? 1 : -1) : 0)
    node.append(row.node)
    const part = { node, text: piece.text, x: axis(piece.left), width: axis(appearing ? 0 : piece.width), rows: [row] }
    place(part, source)
    return part
  }

  return roll<Layout, TextOptions>(root, content, layer, {
    measure: (text, o) => measure(root, content, text, o.morph ? t => segments(t, o.locale) : undefined),
    animatable: (old, next, previous, o) =>
      old.safe && next.safe && previous.morph === o.morph && previous.locale === o.locale && parts.length <= 512,
    begin(old, o) { parts = old.pieces.map(piece => make(piece, old, o)) },
    transition(_, measured, o, anchored) {
      const oldParts = parts.filter(part => part.text !== null)
      const outgoing = parts.filter(part => part.text === null)
      // A changed grapheme normally rolls in its slot, which glides to the new place. In a label that grows from its
      // right edge or middle, that place can be far (the whole label shifts): the old one leaves where it is and the
      // new one comes in where it belongs, rather than one slot flying across.
      const pairs = align(oldParts.map(part => part.text!), measured.pieces.map(piece => piece.text)).flatMap(([i, j]) =>
        anchored && i !== null && j !== null && oldParts[i]!.text !== measured.pieces[j]!.text &&
          Math.abs(measured.pieces[j]!.left - oldParts[i]!.x.x) > 0.5 ? [[i, null], [null, j]] as const : [[i, j]] as const)
      const nextParts: Part[] = []
      let duration = 0
      const go = (a: Axis, to: number) => { duration = Math.max(duration, move(a, to, o)) }
      // Snapshot retained slots before retargeting: exiting ink follows the nearest slot's displacement and
      // velocity, so a shrinking, centered label does not carry its discarded affixes in the opposite direction.
      const anchors = pairs.flatMap(([i, j]) => i !== null && j !== null
        ? [{ x: oldParts[i]!.x.x, v: oldParts[i]!.x.v, to: measured.pieces[j]!.left }] : [])
      const leave = (part: Part) => {
        let anchor = anchors[0]
        for (const a of anchors) if (!anchor || Math.abs(a.x - part.x.x) < Math.abs(anchor.x - part.x.x)) anchor = a
        if (anchor) part.x.v = anchor.v
        go(part.x, part.x.x + (anchor ? anchor.to - anchor.x : 0))
        // The root still closes the layout gap; don't slice the departing glyph's own viewport horizontally.
        go(part.width, part.width.x)
      }
      const reach = measured.height
      const exitY = reach * (o.rollDirection === 'up' ? -1 : 1)
      for (const [i, j] of pairs) {
        const piece = j === null ? null : measured.pieces[j]!
        const part = i === null ? make(piece!, measured, o, true) : oldParts[i]!
        const changed = part.text !== piece?.text
        // Retarget from the actual on-screen positions and velocities. Off-screen historical rows can be dropped.
        part.rows = part.rows.filter(row => {
          if (!row.incoming && Math.abs(row.y.x) >= reach) { row.node.remove(); return false }
          return true
        })
        if (changed && piece) {
          part.rows.forEach(row => { row.incoming = false })
          const row = leaf(piece, measured, true, -exitY)
          part.node.append(row.node); part.rows.push(row)
        } else if (piece) {
          const row = part.rows.find(row => row.incoming)!
          row.node.textContent = measured.text
          row.node.style.left = `${-piece.left}px`
        }
        if (!piece) part.rows.forEach(row => { row.incoming = false })
        for (const row of part.rows) go(row.y, row.incoming ? 0 : exitY)
        if (piece) { go(part.x, piece.left); go(part.width, piece.width) }
        else leave(part)
        part.text = piece?.text ?? null
        part.node.setAttribute('data-detent-text-part', part.text ?? '')
        place(part, measured)
        nextParts.push(part)
      }
      for (const part of outgoing) {
        if (part.width.x <= 0.001 || part.rows.every(row => Math.abs(row.y.x) >= reach)) { part.node.remove(); continue }
        leave(part)
        for (const row of part.rows) go(row.y, exitY)
        place(part, measured)
        nextParts.push(part)
      }
      parts = nextParts
      return duration
    },
    paint(t) {
      for (const part of parts) {
        sample(part.x, t); sample(part.width, t)
        if (part.x.motion) part.node.style.transform = `translateX(${part.x.x}px)`
        if (part.width.motion) part.node.style.width = `${Math.max(0, part.width.x)}px`
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
