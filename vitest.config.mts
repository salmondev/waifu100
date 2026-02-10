/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});

