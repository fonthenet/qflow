import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['electron/**/*.ts'],
      exclude: ['electron/**/*.test.*', 'electron/**/__tests__/**'],
      thresholds: { lines: 50 },
    },
  },
});
