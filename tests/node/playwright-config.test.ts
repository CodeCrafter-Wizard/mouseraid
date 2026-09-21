import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';

describe('Playwright-Konfiguration', () => {
  it('sammelt nur *.spec.ts aus tests/e2e ein – *.test.ts gehört Vitest', () => {
    expect(config.testDir).toBe('tests/e2e');
    expect(config.testMatch).toBe('**/*.spec.ts');
  });
});
