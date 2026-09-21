// Spike (d): Kann der Agent den Chrome auf dem per USB verbundenen Android-Handy fernsteuern?
// Voraussetzung: adb installiert, USB-Debugging an, Chrome auf dem Handy geöffnet.
import { execSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const URL_TO_OPEN = process.argv[2] ?? 'https://codecrafter-wizard.github.io/mouseraid/';

const devices = execSync('adb devices').toString();
console.log(devices);
if (!/\tdevice/.test(devices)) {
  console.error('Kein autorisiertes Gerät gefunden (USB-Debugging-Dialog am Handy bestätigen?).');
  process.exit(2);
}
execSync('adb forward tcp:9222 localabstract:chrome_devtools_remote');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
if (context === undefined) {
  console.error('Kein Browser-Kontext – ist Chrome auf dem Handy geöffnet?');
  process.exit(3);
}
const page = await context.newPage();
page.on('console', (message) => console.log(`[handy-konsole] ${message.type()}: ${message.text()}`));
await page.goto(URL_TO_OPEN);
const info = await page.evaluate(() => ({
  userAgent: navigator.userAgent,
  dpr: devicePixelRatio,
  viewport: `${innerWidth}x${innerHeight}`,
  title: document.title,
}));
console.log(info);
await writeFile('test-results/handy-screenshot.png', await page.screenshot());
console.log('✓ Screenshot: test-results/handy-screenshot.png');
await page.close();
await browser.close();
