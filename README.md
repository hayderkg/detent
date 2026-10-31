# detent

A wheel picker for React that clicks into place.

Custom physics (not `scroll-snap`): real inertia, a throw that lands exactly on a row with no visible correction, rubber-banded ends, and frame-rate independent motion at 60, 120 and 144 Hz. Vertical and horizontal, RTL-aware, accessible, zero dependencies.

> **Status:** pre-release. The API may still change.

## Quickstart

The styled component looks finished with zero props (light and dark, a subtle drum, an iOS-style magnifying lens, soft edges):

```tsx
'use client'
import { Detent } from 'detent'

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
[role='option'] {
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

`fit: 'content'` sizes it to the centered item and morphs it as items pass; on a throw it holds steady while rows cross the center, then catches the target item over the last `catchRows` (1.5) rows, arriving with it. Set `morph: 'naive'` to recompute the width from the two rows around the center every frame instead (useful to compare; it jitters on fast throws). Shapes: `rounded`, `pill`, `lines`, `underline`, `brackets`, `dot`, `needle`, `none`. Materials: `solid`, `glass`, `outline`, `gradient-border`. `color` can be a function of the item (it cross-fades). Live values are CSS variables: `--indicator-w`, `--indicator-h`, `--indicator-progress`, `--indicator-velocity`, `--indicator-color`.

## Size

Real numbers, enforced in CI with [size-limit](https://github.com/ai/size-limit) (minified + gzipped, tree-shaken):

| Import | Size |
| --- | --- |
| `useDetent` (physics + engine + hook) | 6.68 kB |
| `<Detent>` (styled component: core + every visual prop + indicator) | 12.77 kB |
| `createEngine` (physics + engine, no React) | 4.26 kB |
| `detent/feedback` (haptics, tick sound) | 0.58 kB |

Presets other than the default are tree-shaken unless you import `presets`.

## Mouse wheels

`wheelMode` (default `'auto'`) tells a notched mouse wheel from a trackpad by the first event of a gesture: each notch moves exactly one row, and the accelerated bursts of a fast spin (or a free-spinning wheel like the MX Master) become a throw. Trackpads keep 1:1 tracking with momentum. Use `'smooth'` to follow every delta 1:1, or `'step'` to always step.

## Feedback (opt-in)

```tsx
import { ticks } from 'detent/feedback'

<Detent items={items} onTick={ticks({ haptics: true, sound: { volume: 0.4 } })} />
```

Both are no-ops where unsupported (the Vibration API does not exist on iOS Safari).

## License

MIT
