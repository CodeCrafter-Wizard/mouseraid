import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('test-build') },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/node/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
