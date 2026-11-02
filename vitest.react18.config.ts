import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * The same suite against React 18 (the peer range is >=18; the workspace installs 19).
 * REACT_DIR is a node_modules holding react@18 and react-dom@18, e.g. `npm i --prefix /tmp/r18 react@18 react-dom@18`.
 */
const dir = process.env.REACT_DIR
if (!dir) throw new Error('Set REACT_DIR to a node_modules folder with react@18 and react-dom@18')
const to = (pkg: string) => [
  { find: new RegExp(`^${pkg}$`), replacement: join(dir, pkg) },
  { find: new RegExp(`^${pkg}/(.*)$`), replacement: join(dir, pkg, '$1') },
]

export default defineConfig({
  resolve: { alias: [...to('react-dom'), ...to('react')] },
  test: { server: { deps: { inline: [/react/] } } },
})
