export interface Piece { text: string; start: number; end: number; left: number; width: number }
export interface Layout { text: string; width: number; height: number; left: number; top: number; pieces: Piece[]; safe: boolean }

/** Keep entire graphemes together. Older browsers roll the whole label rather than splitting an emoji. */
export function segments(text: string, locale?: string): Segment[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: { granularity: string }) => {
    segment(text: string): Iterable<{ segment: string; index: number }>
  } }).Segmenter
  if (!Segmenter) return text ? [{ text, start: 0, end: text.length }] : []
  return [...new Segmenter(locale, { granularity: 'grapheme' }).segment(text)].map(s => ({ text: s.segment, start: s.index, end: s.index + s.segment.length }))
}

/** Monotonic edit alignment: equal graphemes retain their visual identity, substitutions share one wheel. */
export function align(old: readonly string[], next: readonly string[]): [number | null, number | null][] {
  const n = old.length, m = next.length
  const cost = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n; i >= 0; i--) for (let j = m; j >= 0; j--) {
    cost[i]![j] = i === n ? m - j : j === m ? n - i : Math.min(
      cost[i + 1]![j + 1]! + (old[i] === next[j] ? 0 : 1), 1 + cost[i + 1]![j]!, 1 + cost[i]![j + 1]!,
    )
  }
  const pairs: [number | null, number | null][] = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && cost[i]![j] === cost[i + 1]![j + 1]! + (old[i] === next[j] ? 0 : 1)) pairs.push([i++, j++])
    else if (i < n && cost[i]![j] === 1 + cost[i + 1]![j]!) pairs.push([i++, null])
    else pairs.push([null, j++])
  }
  return pairs
}

/** Read complete shaped runs. Adjacent slices reconstruct the exact word, including fractional kerning. */
export type Segment = { text: string; start: number; end: number }
/** `split` cuts the label into the pieces that move independently; without it the label moves as one. */
export function measure(root: HTMLElement, content: HTMLElement, text: string, split?: (text: string) => Segment[]): Layout {
  const box = content.getBoundingClientRect(), outer = root.getBoundingClientRect(), cs = getComputedStyle(content)
  // DOMRects include an ancestor's press/hover scale. Resolved CSS dimensions remain in layout pixels.
  const resolvedWidth = parseFloat(cs.width), resolvedHeight = parseFloat(cs.height)
  const width = Number.isFinite(resolvedWidth) ? resolvedWidth : box.width
  const height = resolvedHeight || box.height || parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 20
  const scaleX = width > 0 && box.width > 0 ? box.width / width : 1
  const scaleY = height > 0 && box.height > 0 ? box.height / height : 1
  // Complex directionality and line breaks retain their correct native rendering, without simulated glyph layout.
  const safe = cs.visibility !== 'hidden' && !/[\n\r\t\u0590-\u08ff\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text) && cs.direction !== 'rtl' && cs.writingMode !== 'vertical-rl' && cs.writingMode !== 'vertical-lr'
  const whole = text ? [{ text, start: 0, end: text.length, left: 0, width }] : []
  const layout: Layout = { text, width, height, left: (box.left - outer.left) / scaleX, top: (box.top - outer.top) / scaleY, pieces: whole, safe }
  if (!safe || !split || !text || text.length > 160 || !content.firstChild) return layout
  const pieces: Piece[] = []
  // One Range for the whole label, moved from piece to piece. A Range per grapheme left thousands alive until
  // garbage collection, and the browser updates every live Range on every DOM mutation: with 20 long labels, each
  // update's own DOM writes became several times slower (13× in WebKit).
  const range = document.createRange()
  for (const part of split(text)) {
    range.setStart(content.firstChild, part.start)
    range.setEnd(content.firstChild, part.end)
    const rect = range.getBoundingClientRect()
    const left = (rect.left - box.left) / scaleX, own = rect.width / scaleX
    const prev = pieces[pieces.length - 1]
    // A ligature can give several graphemes the same glyph rectangle. Keep that glyph on one wheel. WebKit rounds
    // range rectangles to whole pixels, so neighbours overlap by up to a pixel: only a real share of the glyph counts.
    if (prev && prev.left + prev.width - left > Math.min(prev.width, own) / 2) {
      prev.text += part.text; prev.end = part.end; prev.width = Math.max(prev.width, (rect.right - box.left) / scaleX - prev.left)
    } else pieces.push({ ...part, left, width: own })
  }
  pieces.forEach((piece, i) => { piece.width = Math.max(0, (pieces[i + 1]?.left ?? width) - piece.left) })
  layout.pieces = pieces
  return layout
}
