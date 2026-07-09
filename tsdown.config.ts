import { defineConfig } from 'tsdown'

// hono, hono/* subpaths, and @ipregistry/client are kept external
// automatically: tsdown never bundles peerDependencies and dependencies.
export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    target: 'es2022',
})
