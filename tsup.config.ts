import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: 'es2020',
  external: ['react', 'react-dom'],
})
