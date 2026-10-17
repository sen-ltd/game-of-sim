import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/portfolio/game-of-sim/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    testTimeout: 180000,
  },
});
