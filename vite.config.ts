/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run build` produces the client served by the Node server.
// `npm run build:demo` produces a self-contained demo that stores data in the browser.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  define: {
    __DEMO__: JSON.stringify(mode === 'demo'),
  },
  build: {
    outDir: mode === 'demo' ? 'dist/demo' : 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
