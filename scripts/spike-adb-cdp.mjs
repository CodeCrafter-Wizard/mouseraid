// Spike (d): Kann der Agent den Chrome auf dem per USB verbundenen Android-Handy fernsteuern?
// Voraussetzung: adb installiert, USB-Debugging an, Chrome auf dem Handy geöffnet.
//
// Datenschutz: Geräte-Seriennummern und der vollständige Geräte-User-Agent werden NIE in die
// Repo-Dokumentation übernommen – dort stehen nur Art und Anzahl der Befunde.
//
// Exit-Codes: 0 ok, 2 kein Gerät, 3 kein Browser-Kontext, 4 keine CDP-Verbindung.
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const URL_TO_OPEN = process.argv[2] ?? 'https://codecrafter-wizard.github.io/mouseraid/';
const PORT = 9222;

const devices = execSync('adb devices').toString();
console.log(devices);
if (!/\tdevice/.test(devices)) {
  console.error('Kein autorisiertes Gerät gefunden (USB-Debugging-Dialog am Handy bestätigen?).');
  process.exit(2);
}

/** @returns {Promise<number>} Exit-Code */
async function inspectPhone() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch((error) => {
    console.error(`Keine CDP-Verbindung auf 127.0.0.1:${PORT} – ${error}`);
    console.error('Ist Chrome am Handy wirklich geöffnet (nicht nur der Bildschirm an) und die USB-Debugging-Erlaubnis erteilt?');
    return null;
  });
  if (browser === null) return 4;
  try {
    const context = browser.contexts()[0];
    if (context === undefined) {
      console.error('Kein Browser-Kontext – ist Chrome auf dem Handy geöffnet?');
      return 3;
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
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/handy-screenshot.png', await page.screenshot());
    console.log('✓ Screenshot: test-results/handy-screenshot.png');
    await page.close();
    return 0;
  } finally {
    await browser.close();
  }
}

execSync(`adb forward tcp:${PORT} localabstract:chrome_devtools_remote`);
try {
  process.exitCode = await inspectPhone();
} finally {
  // Der Forward überlebt den Prozess und blockiert sonst den nächsten Lauf.
  try {
    execSync(`adb forward --remove tcp:${PORT}`);
  } catch {
    console.error(`Hinweis: „adb forward --remove tcp:${PORT}" ist fehlgeschlagen – bitte von Hand aufräumen.`);
  }
}
