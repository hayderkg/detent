export interface Token { key: string; text: string; digit: number }

const length = (s: string) => [...s].length

/**
 * One token per digit and one per symbol. Digits are keyed by decimal place, not by index, so the units stay the
 * units across 99 → 100, a sign change or a locale change. Symbols are keyed by what they are, which side of the
 * integer digits they sit on and their text: a different symbol leaves and the new one enters. A digit is its value
 * in `glyphs` (0–9 in the formatter's numbering system), or -1 when it is not one of them.
 */
export function tokens(parts: readonly Intl.NumberFormatPart[], glyphs: readonly string[]): Token[] {
  let integer = 0, fraction = 0
  for (const part of parts) if (part.type === 'integer') integer += length(part.value)
  const seen: Record<string, number> = {}
  return parts.flatMap(({ type, value }) => {
    if (type === 'integer' || type === 'fraction') return [...value].map(text => {
      const digit = glyphs.indexOf(text)
      return { key: (type === 'integer' ? `i${--integer}` : `f${fraction++}`) + (digit < 0 ? text : ''), text, digit }
    })
    const name = type + (type === 'group' ? integer : integer ? '<' : '>')
    seen[name] = (seen[name] ?? 0) + 1
    return [{ key: `${name}:${seen[name]}:${value}`, text: value, digit: -1 }]
  })
}

/** 0–9 as the formatter writes them (latn, arab, deva, fullwide…). */
export const glyphsOf = (format: Intl.NumberFormat) => {
  const plain = new Intl.NumberFormat('en', { numberingSystem: format.resolvedOptions().numberingSystem, useGrouping: false })
  return Array.from({ length: 10 }, (_, i) => plain.format(i))
}
