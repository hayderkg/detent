# detent

A wheel picker for React that clicks into place.

Custom physics (not `scroll-snap`): real inertia, a throw that lands exactly on a row with no visible correction, rubber-banded ends, and frame-rate independent motion at 60, 120 and 144 Hz. Vertical and horizontal, RTL-aware, accessible, zero dependencies.

> **Status:** pre-release. The API may still change.

## Quickstart

```tsx
'use client'
import { useDetent } from 'detent'

const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

export function MinutePicker() {
  const d = useDetent({ items: minutes, defaultValue: '30', itemSize: 44, visibleCount: 5, label: 'Minutes' })
  return (
    <div {...d.getRootProps()}>
      <div {...d.getTrackProps()}>
        {d.rows.map((r) => <div key={r.key} {...r.getProps()}>{r.item}</div>)}
      </div>
      <div {...d.getLiveRegionProps()} />
    </div>
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

## Size

Real numbers, enforced in CI with [size-limit](https://github.com/ai/size-limit) (minified + gzipped, tree-shaken):

| Import | Size |
| --- | --- |
| `useDetent` (physics + engine + hook) | 6.21 kB |
| `createEngine` (physics + engine, no React) | 3.94 kB |
| `detent/feedback` (haptics, tick sound) | 0.52 kB |

Presets other than the default are tree-shaken unless you import `presets`.

## Feedback (opt-in)

```tsx
import { haptics, tickSound, ticks } from 'detent/feedback'

useDetent({ items, onTick: ticks(haptics(), tickSound({ volume: 0.4 })) })
```

Both are no-ops where unsupported (the Vibration API does not exist on iOS Safari).

## License

MIT
