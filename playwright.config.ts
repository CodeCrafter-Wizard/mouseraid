import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Ein vergessenes `test.only` darf im CI nicht still die übrigen Tests überspringen.
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/mouseraid/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Persistierte Kamera-Erlaubnis – nicht der Fake-UI-Flag – hebt Chromes mDNS-Verschleierung auf.
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream', // Kamera-Erlaubnis ohne Dialog (spiegelt „Kamera zuerst")
            '--use-fake-device-for-media-stream', // synthetische Kamera
            '--enable-unsafe-swiftshader', // Software-WebGL in Headless erlauben
            '--ignore-gpu-blocklist',
          ],
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
