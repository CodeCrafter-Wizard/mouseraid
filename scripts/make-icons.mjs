// Rendert die handgemachten SVG-Icons per Playwright-Chromium zu PNGs (kein Bild-Tooling nötig).
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const DIR = 'public/icons';
const JOBS = [
  { svg: 'icon.svg', size: 192, out: 'icon-192.png', transparent: true },
  { svg: 'icon.svg', size: 512, out: 'icon-512.png', transparent: true },
  { svg: 'icon-maskable.svg', size: 512, out: 'icon-maskable-512.png', transparent: false },
  { svg: 'icon-maskable.svg', size: 180, out: 'apple-touch-icon-180.png', transparent: false },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const job of JOBS) {
  const svg = await readFile(`${DIR}/${job.svg}`, 'utf8');
  await page.setViewportSize({ width: job.size, height: job.size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${job.size}px;height:${job.size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: job.transparent, clip: { x: 0, y: 0, width: job.size, height: job.size } });
  await writeFile(`${DIR}/${job.out}`, png);
  console.log(`✓ ${job.out} (${png.length} Bytes)`);
}
await browser.close();
