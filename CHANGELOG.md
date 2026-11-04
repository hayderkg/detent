# Changelog

## Unreleased

- `DetentText` and `DetentNumber` labels that grow from their right edge or middle (right-aligned, centred, or
  right-to-left) no longer carry their departing text sideways while their width springs: each transition finds the
  edge the label grows from, and the rolling copies stay put on screen. In such labels a changed letter whose slot
  would have to travel leaves where it is and its replacement comes in where it belongs. Left-aligned labels are
  unchanged.

- `DetentNumber` no longer shifts its rolling digits sideways inside centred or right-aligned text: each wheel's
  column is pinned to its window instead of following the inherited `text-align`.

- Faster `DetentText` and `DetentNumber` updates with long labels or many instances: a label is measured with one
  `Range` instead of one per grapheme (live Ranges slowed every later DOM write), and a resize that leaves the
  label's size unchanged no longer remeasures every glyph. 20 labels of ~150 characters: 1.4 s → 0.37 s per
  update at 4× CPU slowdown in Chromium; 100 in WebKit: 12.6 s → 1.5 s. No visual change.

- Exiting `DetentText` affixes follow the retained letters while intrinsic width changes, including interruptions.
  Their glyph windows stay wide until they leave, avoiding sideways drift and horizontal slicing in centered labels.

- `DetentText` and `DetentNumber` share a mask that is fully transparent outside the native line, with a small
  fade into its edges so descenders do not peek through between steps. Incoming and outgoing text
  rows travel exactly one line height, like each number-wheel step; retained letters keep their native baseline.

- Add the optional `detent/text` entry point with `DetentText`: arbitrary short labels, matching-grapheme or
  whole-label rolling, shared Detent spring physics, interruption handling, native text at rest, server rendering,
  reduced motion and accessible visual copies. No predefined item list or picker input handlers are required.
  Re-renders with the same text, options, `className`, `style`, `lang` and `dir` read no layout; `style` cannot
  unposition the rolling layer or remove its box (`display: contents`).
- Add the optional `detent/number` entry point with `DetentNumber`: a number formatted by `Intl.NumberFormat`
  (`locales`, `format`) whose digits roll by decimal place through the values between, up or down with the value's
  `trend`. New places grow in, symbols enter and leave, values that format the same do not move. Native text at
  rest, server rendering, interruptions and reduced motion as in `DetentText`, with which it shares its frame loop
  and springs (about 4.4 kB alone, 7.1 kB with `detent/text`). `classNames` styles each part (currency, fraction,
  separators, sign…) at rest and while it rolls.
- `DetentText` no longer merges neighbouring letters in WebKit, which rounds glyph positions to whole pixels.
- Rolling number copies refresh their part styles and numbering system when retargeted. Bursts of updates no
  longer queue unbounded digit revolutions; exceptionally long numbers update natively. Restyling a rolling label
  without changing its text cancels the old visual copies, including when its dimensions stay the same. Hidden
  labels update natively, so explicitly visible number copies cannot override `visibility: hidden`.

## 0.1.0

The first release. Pre-1.0: the API may still change between minor versions.

### `<Detent>` and `useDetent`

- A wheel picker with its own physics (not `scroll-snap`): a throw coasts with exponential decay, lands exactly on
  the row its projection points to and settles on a spring. Frame-rate independent; rubber-banded ends.
- `<Detent>`, styled, with every visual prop: drum (perspective, curvature, radius, tilt, skew), per-row falloffs
  (fade, scale, blur, dim, spacing, easing), the indicator (shapes, materials, `fit: 'content'`), magnify lens,
  masks, `gradientBlur`, glare, presets, `rowStyle` and `renderItem`.
- `useDetent`, headless: the same motion, input and accessibility with your own markup.
- Vertical and horizontal, right-to-left aware, `loop`, disabled items, header, footer and loading rows,
  `onEndReached`, interactive rows, controlled or uncontrolled, `name`/`form` for forms, `nonce` for strict CSP,
  server rendering with the selected row in the HTML.
- Input: pointer and touch (drag, throw, tap a row), mouse wheel and trackpad (`wheelMode`: `'auto'`, `'step'`,
  `'smooth'`), keyboard (arrows, Page Up/Down, Home/End, typeahead) with `keyAcceleration` when an arrow is held.
- Accessibility: a real listbox with `aria-activedescendant`, announcements on settle, reduced motion respected.
- Opt-in motion and optics effects: `motionBlur`, `velocityTilt`, `centerLight`, `selectedDepth`, `elasticRows`,
  `grip`, and `indicator.refraction` (with `refractionInverse` and `refractionRGB`).

### `detent/feedback`

- `ticks({ haptics, sound })`: a haptic tap and a soft click per row, opt-in. One shared audio context, started
  only after a user gesture and never during a spin; `dynamicTimbre` brightens fast ticks.

### Size (minified + gzipped)

- `useDetent` 7.36 kB, `<Detent>` with every preset 17.84 kB, `detent/feedback` 768 B. No runtime dependencies;
  React 18 or 19 as a peer.
