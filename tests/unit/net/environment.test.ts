import { describe, expect, it } from 'vitest';
import { detectEngine } from '../../../src/net/environment';

const WEBKIT_537 = 'AppleWebKit/537.36 (KHTML, like Gecko)';
const WEBKIT_605 = 'AppleWebKit/605.1.15 (KHTML, like Gecko)';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

const CASES: readonly { name: string; userAgent: string; engine: ReturnType<typeof detectEngine> }[] = [
  { name: 'Chrome auf Android', userAgent: `Mozilla/5.0 (Linux; Android 10; K) ${WEBKIT_537} Chrome/128.0.0.0 Mobile Safari/537.36`, engine: 'chromium' },
  { name: 'Chrome am Desktop', userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${WEBKIT_537} Chrome/128.0.0.0 Safari/537.36`, engine: 'chromium' },
  { name: 'Edge', userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${WEBKIT_537} Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0`, engine: 'chromium' },
  { name: 'Samsung Internet', userAgent: `Mozilla/5.0 (Linux; Android 10; K) ${WEBKIT_537} SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36`, engine: 'chromium' },
  { name: 'Safari auf iOS', userAgent: `${IPHONE} ${WEBKIT_605} Version/17.5 Mobile/15E148 Safari/604.1`, engine: 'webkit' },
  { name: 'Safari auf macOS', userAgent: `${MAC} ${WEBKIT_605} Version/17.5 Safari/605.1.15`, engine: 'webkit' },
  { name: 'Chrome auf iOS (CriOS)', userAgent: `${IPHONE} ${WEBKIT_605} CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1`, engine: 'webkit' },
  { name: 'Firefox auf iOS (FxiOS)', userAgent: `${IPHONE} ${WEBKIT_605} FxiOS/130.0 Mobile/15E148 Safari/605.1.15`, engine: 'webkit' },
  { name: 'Chrome auf dem iPad im Desktop-Modus', userAgent: `${MAC} ${WEBKIT_605} CriOS/128.0.6613.98 Version/17.5 Safari/605.1.15`, engine: 'webkit' },
  { name: 'Firefox am Desktop', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0', engine: 'gecko' },
  { name: 'Firefox auf Android', userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0', engine: 'gecko' },
  { name: 'leerer Text', userAgent: '', engine: 'unknown' },
  { name: 'Kommandozeilen-Client', userAgent: 'curl/8.9.1', engine: 'unknown' },
  { name: 'abgeschnittener Text', userAgent: 'Mozilla/5.0', engine: 'unknown' },
];

describe('detectEngine', () => {
  for (const { name, userAgent, engine } of CASES) {
    it(`${name} → ${engine}`, () => {
      expect(detectEngine(userAgent)).toBe(engine);
    });
  }

  it('lässt sich von „like Gecko" in Chromium- und WebKit-Kennungen nicht täuschen', () => {
    expect(detectEngine(`Mozilla/5.0 (X11; Linux x86_64) ${WEBKIT_537} Chrome/128.0.0.0 Safari/537.36`)).not.toBe('gecko');
    expect(detectEngine(`${MAC} ${WEBKIT_605} Version/17.5 Safari/605.1.15`)).not.toBe('gecko');
  });
});
