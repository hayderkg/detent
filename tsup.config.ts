import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', feedback: 'src/feedback/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  minify: false,
  target: 'es2020',
  external: ['react', 'react-dom'],
  banner: { js: "'use client';" },
})
