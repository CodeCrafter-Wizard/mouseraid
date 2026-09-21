import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('test-build') },
  test: {
    environment: 'node',
    // Konvention: Vitest = `*.test.ts`, Playwright = `*.spec.ts`. Ein neuer Ordner unter tests/
    // wird dadurch automatisch mitgetestet, statt still übersehen zu werden.
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
