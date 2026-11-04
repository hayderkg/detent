# Changelog

## 0.1.1

- Types for `@hayderkg/detent/text`, `/number` and `/feedback` resolve under TypeScript's older `node10`
  module resolution too (CommonJS projects, older Jest setups), through `typesVersions`. No code changes.

## 0.1.0

The first release, published as `@hayderkg/detent`. Pre-1.0: the API may still change between minor versions.

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

### `@hayderkg/detent/feedback`

- `ticks({ haptics, sound })`: a haptic tap and a soft click per row, opt-in. One shared audio context, started
  only after a user gesture and never during a spin; `dynamicTimbre` brightens fast ticks.

### `@hayderkg/detent/text`

- `DetentText`: short labels that roll on Detent's spring physics, with no list of possible values. Matching
  graphemes keep their place and only the changed ones roll (`morph`), or the whole label rolls; `rollDirection`.
  Native text at rest and in the server render, interruptible from where it is drawn, reduced motion respected,
  accessible (the visual copies are hidden from assistive technology).
- Labels that grow from their right edge or middle (right-aligned, centred, right-to-left) keep their departing
  letters still on screen while their width springs; departing letters follow the ones that stay.
- Cheap to update: a label is measured with one `Range`, re-renders with the same text and options read no
  layout, and a resize that leaves the label's size unchanged remeasures nothing.

### `@hayderkg/detent/number`

- `DetentNumber`: a number formatted by `Intl.NumberFormat` (`locales`, `format`) whose digits roll by decimal place
  through the values between, up or down with the value's `trend`. New places grow in, symbols enter and leave,
  values that format the same do not move; bursts of updates never queue whole revolutions.
- `classNames` styles each part (currency, fraction, separators, sign…) at rest and while it rolls. Digits stay in
  their columns whatever `text-align` they inherit.
- Shares its frame loop and springs with `DetentText`; native text at rest, server rendering, interruptions and
  reduced motion as there.

### Size (minified + gzipped)

- `useDetent` 7.36 kB, `<Detent>` with every preset 17.84 kB, `@hayderkg/detent/feedback` 768 B, `@hayderkg/detent/text` 4.21 kB,
  `@hayderkg/detent/number` 4.66 kB (7.41 kB together). No runtime dependencies; React 18 or 19 as a peer.
