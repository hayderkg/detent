# detent

A wheel picker for React that clicks into place.

Custom physics (not `scroll-snap`): real inertia, a throw that lands exactly on a row with no visible correction, rubber-banded ends, and frame-rate independent motion at 60, 120 and 144 Hz. Vertical and horizontal, RTL-aware, accessible, zero dependencies.

> **Status:** pre-release. The API may still change.

Docs, playground and examples: **[detent.hayder.sh](https://detent.hayder.sh)**.

## Install

```sh
npm i detent
```

## Quickstart

The styled component looks finished with no styling props (light and dark, a subtle drum, an iOS-style magnifying lens, soft edges). Give it `items` and a `label`, its accessible name:

```tsx
'use client'
import { Detent } from 'detent'

const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

export const Minutes = () => <Detent items={minutes} defaultValue="30" label="Minutes" />
```

Or go headless:

```tsx
'use client'
import { useDetent } from 'detent'

const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

export function MinutePicker() {
  const d = useDetent({ items: minutes, defaultValue: '30', itemSize: 44, visibleCount: 5, label: 'Minutes' })
  return (
    <>
      <div {...d.getRootProps()}>
        <div {...d.getTrackProps()}>
          {d.rows.map((r) => <div key={r.key} {...r.getProps()}>{r.item}</div>)}
        </div>
      </div>
      <div {...d.getLiveRegionProps()} />
    </>
  )
}
```

Every row gets `--offset`, `--abs-offset`, `--progress` and `--selected` CSS variables, updated every frame outside React, so drum effects are plain CSS:

```css
[data-detent] [role='option'] {
  transform: rotateX(calc(var(--offset) * -17deg));
  opacity: calc(1 - var(--abs-offset) * 0.25);
}
```

## Indicator

The selection marker is a first-class part: shape, material, style, and fit.

```tsx
<Detent
  items={words}
  indicator={{ fit: 'content', shape: 'pill', material: 'glass' }}
/>
```

`fit: 'content'` sizes it to the centered item and morphs it as items pass; on a throw it holds steady while rows cross the center, then catches the target item over the last `catchRows` (1.5) rows, arriving with it. Set `morph: 'naive'` to recompute the width from the two rows around the center every frame instead (useful to compare; it jitters on fast throws). Shapes: `rounded`, `pill`, `lines`, `underline`, `brackets`, `dot`, `needle`, `none`. Materials (rounded and pill only): `solid`, `glass`, `outline`, `gradient-border`. `color` can be a function of the item (it cross-fades). Live values are CSS variables, written every frame: `--indicator-w`, `--indicator-h`, `--indicator-r`, `--indicator-progress`, `--indicator-velocity`, and `--indicator-color` when `color` is a function. The older `highlight`, `highlightStyle` and `highlightShadow` props are aliases for `indicator.shape` and `indicator.shadow`.

## Size

Real numbers, enforced in CI with [size-limit](https://github.com/ai/size-limit) (minified + gzipped, tree-shaken):

| Import | Size |
| --- | --- |
| `useDetent` (physics + engine + hook) | 7.36 kB |
| `<Detent>` (styled component: core + every visual prop + indicator + every preset) | 17.84 kB |
| `createEngine` (physics + engine, no React) | 4.54 kB |
| `detent/feedback` (haptics, tick sound) | 0.77 kB |
| `detent/text` (`DetentText`) | 4.21 kB |
| `detent/number` (`DetentNumber`) | 4.66 kB |
| `detent/text` and `detent/number` together | 7.41 kB |

With `useDetent` and `createEngine`, presets other than the default are tree-shaken unless you import `presets`. `<Detent>` accepts preset names as strings, so it includes them all.

## Mouse wheels

`wheelMode` (default `'auto'`) tells a notched mouse wheel from a trackpad by the first event of a gesture: each notch moves exactly one row, and the accelerated bursts of a fast spin (or a free-spinning wheel like the MX Master) become a throw. Trackpads keep 1:1 tracking with momentum. Use `'smooth'` to follow every delta 1:1, or `'step'` to always step.

## Feedback (opt-in)

```tsx
import { ticks } from 'detent/feedback'

// Create it once (module scope or useMemo): a new handler per render restarts its throttle and audio.
const onTick = ticks({ haptics: true, sound: { volume: 0.4 } })

<Detent items={items} label="Value" onTick={onTick} />
```

Both are no-ops where unsupported (the Vibration API does not exist on iOS Safari). Browsers only allow audio after a user gesture.

## Motion blur (opt-in)

`<Detent items={items} label="Value" motionBlur />` adds a directional blur along the scroll axis, proportional to velocity. `true` caps it at 4px; `motionBlur={6}` sets a custom cap (0–24px). The indicator stays sharp, the lens follows the same blur, and the effect clears at rest. It combines with the distance-based `blur` prop and turns off with reduced motion. Filtering adds rendering work: test rich rows and mobile devices before enabling it broadly.

## Subtle motion accents

```tsx
<Detent
  items={items}
  label="Value"
  velocityTilt
  indicator={{ impact: true }}
/>
```

Both effects are opt-in and respect reduced motion. `velocityTilt` leans moving rows, including the lens, by up to 2 degrees; a number sets the maximum (0–6 degrees). It follows velocity and direction and returns to zero at rest. `indicator.impact` gives rounded and pill markers a brief compression and rebound after a moving wheel settles, without deforming the row content. `true` uses a subtle intensity, or pass 0–1. A new movement interrupts the response. This is separate from `indicator.overshoot`, which controls fitted size during the approach.

## Light, depth and sound

```tsx
const onTick = ticks({ sound: { dynamicTimbre: true } }) // once, outside the component

<Detent items={items} label="Value" centerLight selectedDepth onTick={onTick} />
```

Import `ticks` from `detent/feedback`. `centerLight` brightens rows as they pass through the center (`true` = 0.12; intensity 0–0.5). `selectedDepth` brings the centered row forward and its neighbors back with a per-row perspective transform (`true` = 8px; range 0–24px). Both are off by default, apply to the magnifying lens too, and turn off with reduced motion. A custom `rowStyle.transform` overrides the built-in depth transform.

`dynamicTimbre` is an optional `tickSound` option (also accepted through `ticks`): `true` or intensity 0–1. Fast ticks sound brighter and less resonant; slow ticks sound more defined. The normal fixed timbre remains the default. Audio still requires browser support and a prior user gesture.

## Elastic rows

```tsx
<Detent items={items} label="Value" elasticRows={0.3} />
```

`elasticRows` adds independent spring lag to the outer rows during movement and direction changes. `true` uses intensity 0.3; pass 0–6 to adjust it. Values up to 1 are subtle; 2–6 make it more pronounced. The velocity response is sensitive to slow, sustained input as well as fast throws. Displacement is capped at 70% of a row pitch and 48px, and the center half-row stays fixed. The engine and selection are unchanged. Rows recover their exact spacing after motion, the lens and slots follow the same displacement, and reduced motion disables it. The effect is off by default. A custom `rowStyle.translate` overrides the elastic displacement; custom `rowStyle.transform` can still be used alongside it.

## Refraction and grip

```tsx
<Detent
  items={items}
  label="Value"
  indicator={{ refraction: 0.5 }}
  grip={0.5}
/>
```

`indicator.refraction` bends the visible rows through a stationary lens inside the selection band. `true` uses strength 0.5; the numeric range is 0–4. Values through 2 retain their previous response; above 2 the increase progressively softens to prevent pixel folding. By default the central 60% stays flat, with distortion confined to the two edge regions along the scroll axis. It works on either axis and follows fitted indicator dimensions. Set `indicator.refractionInverse: true` alongside `refraction` to restore the original center lens, which distorts the selected content too. The inverse option alone does not enable refraction. The distortion is bounded to keep the sampling curve monotonic, even at the maximum. Start around 0.5–1; high values are deliberately pronounced.

`indicator.refractionRGB` adds optional chromatic dispersion near the refracting regions. Use `true` for a subtle intensity of 0.35, or 0–1 to adjust it: `indicator={{ refraction: 2, refractionRGB: 0.35 }}`. The red and blue samples separate across the scroll axis by up to ±3px (6px total, reduced for short rows). The RGB pass replaces the original edge pixels and adds colored contour fringes for dark as well as light text. The neutral reading area is excluded. It appears as details enter or leave the edge regions; a resting item entirely within the clear center remains unchanged. RGB requires refraction, is off by default, and adds filter passes only when enabled. It follows the same reduced-motion preference and works with the inverse lens too.

Refraction reuses the existing inert magnification copy, so it does not create additional row copies when magnify is already on. With `magnify={false}`, refraction still needs that second copy at scale 1: `renderItem` runs twice per visible row. Keep both effects off for rows with ids, effects or heavy content. The displacement map is an embedded SVG image; a strict CSP needs to allow `data:` in `img-src`. Filtering costs rendering time, so check complex rows on your target mobile devices.

`grip` adds a short visual absorption when a primary pointer catches a moving wheel. `true` uses intensity 0.5; pass 0–2 to adjust it. It finishes in 180ms, without delaying pointer control or changing the engine position, selected value or snapping. It affects the main track, slots and lens together, composes with `elasticRows`, and does nothing when grabbing a wheel at rest. Keyboard, wheel input and pointer cancellation clear the response.

Both effects are off by default and disable themselves with reduced motion, including when that preference changes while mounted.

## Detent Text

`DetentText` animates short interface labels (a button's state, a counter, a status) with the same spring that settles the wheel. What sets it apart:

- **Native text at rest.** The server renders the real text. While a change rolls, a visual copy is drawn over it and the text underneath stays in the DOM, so screen readers, selection and hydration only ever see plain text.
- **No list of values.** Pass the current string or number. Changes are matched grapheme by grapheme (emoji and combining marks stay whole), so `Send` → `Sending…` keeps `Send` and rolls the rest.
- **Separate and small.** `detent/text` is its own entry point, about 4.2 kB gzipped: importing `detent` does not include it, and it does not include the wheel.
- **Interruptible.** A new label mid-roll continues from where each letter is, at its speed, with no jump.

It mounts no picker, attaches no gesture handlers and runs no React renders per frame.

```tsx
import { DetentText } from 'detent/text'

<DetentText>{status}</DetentText>
// Send → Sending… → Sent: matching graphemes remain, changed ones roll.

<DetentText morph={false}>{status}</DetentText>
// Roll the entire label instead.
```

The value is a string or number; no predefined `items` are required. Numbers passed here match by character; for digits that roll by decimal place, use [`DetentNumber`](#detent-number).

| Prop | Default | Purpose |
| --- | --- | --- |
| `children` | required | Current string or number |
| `morph` | `true` | Preserve matching graphemes; `false` rolls the whole label |
| `animate` | `true` | Set `false` for immediate updates |
| `spring` | `{ stiffness: 420, damping: 32, mass: 1 }` | Partial spring configuration |
| `snapDuration` | `550` | Maximum spring duration, in ms |
| `rollDirection` | `'up'` | `'up'` or `'down'` for changing text |
| `locale` | browser default | Grapheme segmentation locale |
| `as` | `'span'` | Text element such as `span`, `strong`, `output`, `code`, or a heading |
| `style` | — | Yours, except that `position: static` becomes `relative` and `display: inline` or `contents` becomes `inline-block`: the rolling layer needs a positioned box of its own |
| `onAnimationStart` | — | A transition starts |
| `onAnimationComplete` | — | A transition settles |
| `onAnimationCancel` | — | A running transition is interrupted or removed |

`className`, `style`, HTML attributes, ARIA attributes and a forwarded `HTMLElement` ref are supported. Typography is inherited. The label is measured when its text, `className`, `style`, `lang` or `dir` changes, when it resizes and when a font loads; if an ancestor restyles its letters without changing its size, give it a new `key`. Intrinsic width animates with the label; an explicit inline `style.width` keeps the container fixed. Use `aria-live="polite"` only when changes need announcing; inside a button the native text already supplies its accessible name.

Real text is rendered on the server and remains available to assistive technology and text selection. Temporary visual slices are `aria-hidden` and disappear at rest, so native typography, kerning and ligatures are restored exactly. Each label has one animation frame loop, one resize observer and one reduced-motion listener; only changed graphemes roll. Interrupted transitions retain their on-screen positions and velocities. Reduced motion is always respected, including changes during an animation.

This first version targets short, single-line LTR interface text. Multiline text, RTL/complex bidirectional text and vertical writing render natively with immediate updates. Labels longer than 160 UTF-16 code units, or browsers without `Intl.Segmenter`, roll as a whole rather than allocating a large character alignment. It is not yet a feature-for-feature replacement for a general text-layout animation library. Migrate individual labels and review their actual typography and transitions.

## Detent Number

`DetentNumber` shows a formatted number whose digits roll on the same spring, through the values between, like an odometer. It understands what it shows: digits are matched by decimal place, so the units stay the units from 99 to 100, through a change of sign or of locale.

```tsx
import { DetentNumber } from 'detent/number'

<DetentNumber value={amount} locales="es-ES" format={{ style: 'currency', currency: 'EUR' }} />
```

- **Formatted by `Intl.NumberFormat`.** `locales` and `format` go straight to it: currencies, percentages, units, compact notation, grouping, signs and any numbering system.
- **Digits roll by place.** Up when the value grows, down when it shrinks (`trend`); a digit going from 7 to 2 passes 8, 9, 0 and 1. New places grow in from zero width and the rest slide over; signs, separators and symbols enter and leave.
- **Only what is shown moves.** Values that format the same (1.001 and 1.002 with one decimal) do not animate.
- **Native text at rest**, server rendered, with `font-variant-numeric: tabular-nums` by default. While it rolls, an `aria-hidden` copy is drawn over the real text.
- **Interruptible**, with reduced motion respected, like `DetentText`, with which it shares its frame loop and springs: about 4.7 kB gzipped alone, 7.4 kB together with `detent/text`.

| Prop | Default | Purpose |
| --- | --- | --- |
| `value` | required | A `number` or `bigint` |
| `locales` | browser default | Passed to `Intl.NumberFormat` |
| `format` | — | `Intl.NumberFormatOptions` |
| `trend` | `'auto'` | `'auto'` rolls up when the value grows and down when it shrinks; `'up'` or `'down'` always |
| `classNames` | — | A class per part: `integer`, `fraction`, `decimal`, `group`, `currency`, `sign`, `unit` |
| `animate` | `true` | Set `false` for immediate updates |
| `spring` | `{ stiffness: 460, damping: 38, mass: 1 }` | Partial spring configuration |
| `snapDuration` | `700` | Maximum spring duration, in ms |
| `as` | `'span'` | Text element such as `span`, `strong`, `output`, `data`, or a heading |
| `style` | — | As in `DetentText`. `fontVariantNumeric` can be overridden |
| `onAnimationStart` / `onAnimationComplete` / `onAnimationCancel` | — | As in `DetentText` |

To style the parts (a quieter currency, smaller decimals, faint separators), pass `classNames`:

```tsx
<DetentNumber value={price} format={{ style: 'currency', currency: 'USD' }}
  classNames={{ currency: 'price-currency', fraction: 'price-cents', decimal: 'price-cents', group: 'price-group' }} />
```

The native text is then split into a span per part, still one selectable, accessible label, and the rolling copies carry the same classes, so the styles hold during the roll. Keep the parts on the baseline (size, weight, colour, margins): each digit rolls through a window the height of the line, so a part raised or lowered with `vertical-align` is cut off while it moves. Give large numbers some line height for the same reason. Without `classNames` it stays a single text node.

`className`, HTML and ARIA attributes and a forwarded ref are supported, and the label is measured on the same changes as `DetentText`, and when `classNames` change. A number with right-to-left or bidirectional marks in its formatting (Arabic locales, for example) updates natively without rolling. Numbers with more than 160 formatted tokens also update natively, keeping the temporary DOM bounded. Pass an explicit `locales` value when server rendering so the server and browser use the same format. Format the value you show, not a running counter: each change rolls from where the digits are.

## License

[MIT](./LICENSE)
