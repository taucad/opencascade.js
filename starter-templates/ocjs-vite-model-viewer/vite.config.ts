import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['opencascade.js'],
  },
  assetsInclude: ['**/*.wasm'],
});
