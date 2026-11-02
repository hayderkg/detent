# Changelog

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
