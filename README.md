# detent

A wheel picker for React that clicks into place.

Custom physics (not `scroll-snap`): real inertia, a throw that lands exactly on a row with no visible correction, rubber-banded ends, and frame-rate independent motion at 60, 120 and 144 Hz. Vertical and horizontal, RTL-aware, accessible, zero dependencies.

> **Status:** pre-release. The API may still change.

Docs, playground and recipes live in the site (`apps/site` in this repo).

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
| `createEngine` (physics + engine, no React) | 4.56 kB |
| `detent/feedback` (haptics, tick sound) | 0.77 kB |

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

## License

MIT

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
