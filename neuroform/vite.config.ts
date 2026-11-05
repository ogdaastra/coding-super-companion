import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './scripts/vite-sw-plugin.ts';
import { singleFile } from './scripts/vite-single-file-plugin.ts';

// `base: './'` makes the build work from any path on any static host.
//
// `vite build --mode single` (npm run build:single) produces one self-contained
// HTML file instead (dist-single/NEUROFORM.html) that runs when opened from disk:
// everything, including the engine and the simulation worker, is embedded.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single
      ? [react(), singleFile({ fileName: 'NEUROFORM.html', favicon: 'public/favicon.svg' })]
      : [react(), serviceWorker()],
    // The single file has no web app manifest, icons or service worker to copy.
    publicDir: single ? false : 'public',
    resolve: single
      ? { alias: [{ find: /^\.\/workerFactory\.ts$/, replacement: './workerFactory.single.ts' }] }
      : undefined,
    // A page opened from disk has an opaque origin, and Chromium will not start a
    // module worker from a blob: URL there; the embedded worker is a classic script.
    worker: { format: single ? ('iife' as const) : ('es' as const) },
    build: single
      ? {
          target: 'es2022',
          outDir: 'dist-single',
          sourcemap: false,
          // Inline every asset (fonts) as a data: URL.
          assetsInlineLimit: () => true,
          cssCodeSplit: false,
          modulePreload: false,
          chunkSizeWarningLimit: 4000,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {
          target: 'es2022',
          sourcemap: true,
          chunkSizeWarningLimit: 1600,
          assetsInlineLimit: 0,
        },
    server: { port: 5173, host: true },
    preview: { port: 4173, host: true },
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    },
  };
});
