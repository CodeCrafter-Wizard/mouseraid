import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { FAKECAM_FOREIGN_Y4M_PATH, FAKECAM_Y4M_PATH } from './scripts/lib/qrY4m.mjs';

// Die Flags gelten je BROWSER-START, und `test.use({ launchOptions })` ersetzt sie komplett statt
// sie zu ergänzen. Deshalb trägt jedes Projekt die volle Liste – sonst fehlten dem Fake-Kamera-Lauf
// still `--use-fake-ui-for-media-stream` und `--enable-unsafe-swiftshader`.
const FAKE_MEDIA_ARGS = [
  '--use-fake-ui-for-media-stream', // Kamera-Erlaubnis ohne Dialog (spiegelt „Kamera zuerst")
  '--use-fake-device-for-media-stream', // synthetische Kamera
  '--enable-unsafe-swiftshader', // Software-WebGL in Headless erlauben
  '--ignore-gpu-blocklist',
];

/** Beide Fake-Kamera-Smokes – sie brauchen je ein eigenes Bild und deshalb je einen eigenen Browser-Start. */
const FAKECAM_SPEC = '**/lab-fakecam.spec.ts';
const FAKECAM_FOREIGN_SPEC = '**/lab-fakecam-foreign.spec.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  // Konvention: Playwright = *.spec.ts, Vitest = *.test.ts. Ohne diese Zeile sammelt Playwright auch *.test.ts ein.
  testMatch: '**/*.spec.ts',
  // Ein vergessenes `test.only` darf im CI nicht still die übrigen Tests überspringen.
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // Schreibt die beiden .y4m-Dateien einmal je Testlauf, bevor der erste Browser startet.
  globalSetup: './tests/e2e/globalSetup.ts',
  use: {
    baseURL: 'http://127.0.0.1:4173/mouseraid/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Ohne die synthetischen QR-Dateien sähen die Smokes hier ein leeres Bild – sie gehören in die Projekte unten.
      testIgnore: [FAKECAM_SPEC, FAKECAM_FOREIGN_SPEC],
      use: {
        ...devices['Desktop Chrome'],
        // Persistierte Kamera-Erlaubnis – nicht der Fake-UI-Flag – hebt Chromes mDNS-Verschleierung auf.
        permissions: ['camera'],
        launchOptions: { args: [...FAKE_MEDIA_ARGS] },
      },
    },
    {
      name: 'chromium-fakecam',
      testMatch: FAKECAM_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          // Absoluter Pfad: Chromium löst das Flag nicht gegen das Arbeitsverzeichnis auf.
          args: [...FAKE_MEDIA_ARGS, `--use-file-for-fake-video-capture=${resolve(FAKECAM_Y4M_PATH)}`],
        },
      },
    },
    {
      // Zweiter Smoke mit einem FREMDEN Code: er beweist die schreibende Seite von `qr:skipped`.
      // Eigenes Projekt, weil das Kamera-Flag je Browser-Start gilt – eine Datei, ein Code.
      name: 'chromium-fakecam-foreign',
      testMatch: FAKECAM_FOREIGN_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: [...FAKE_MEDIA_ARGS, `--use-file-for-fake-video-capture=${resolve(FAKECAM_FOREIGN_Y4M_PATH)}`],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run preview:pages',
    url: 'http://127.0.0.1:4173/mouseraid/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
