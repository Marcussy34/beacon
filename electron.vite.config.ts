import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Force CommonJS output (index.js, not index.mjs): a `sandbox: true` preload runs as plain
    // JS without an ESM loader, so an ESM preload would silently fail to load and `window.beacon`
    // would be undefined. CJS + the .js name also matches main's `../preload/index.js` reference.
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    // base: './' makes built asset URLs relative, so the packaged file:// load resolves them
    // (Vite's default base '/' breaks under file://).
    base: './',
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
    resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
});
