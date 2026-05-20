import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.unit.spec.ts'],
    environment: 'node',
    testTimeout: 5_000,
    hookTimeout: 5_000,
  },
});
