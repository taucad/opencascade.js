import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@taucad/opencascade.js', '@taucad/opencascade.js/multi'],
  },
  server: {
    port: 3003,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
