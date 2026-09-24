import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';
import { FAKECAM_FOREIGN_Y4M_PATH, FAKECAM_Y4M_PATH } from '../../scripts/lib/qrY4m.mjs';

/** Projekt aus der Konfiguration – mit klarer Meldung statt `undefined`, wenn es fehlt. */
function project(name: string): NonNullable<typeof config.projects>[number] {
  const found = (config.projects ?? []).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Projekt ${name} fehlt in playwright.config.ts`);
  return found;
}

const args = (name: string): string[] => project(name).use?.launchOptions?.args ?? [];

// Die vier Flags gelten je Browser-Start. `test.use({ launchOptions })` ERSETZT sie komplett –
// deshalb trägt jedes Projekt die volle Liste, und dieser Test hält sie beisammen.
const BASE_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/** Beide Fake-Kamera-Smokes: einer mit dem Payload-Code, einer mit einem FREMDEN Code. */
const FAKECAM_SPECS = ['**/lab-fakecam.spec.ts', '**/lab-fakecam-foreign.spec.ts'];

describe('Playwright-Konfiguration', () => {
  it('sammelt nur *.spec.ts aus tests/e2e ein – *.test.ts gehört Vitest', () => {
    expect(config.testDir).toBe('tests/e2e');
    expect(config.testMatch).toBe('**/*.spec.ts');
  });

  it('erzeugt die .y4m-Dateien einmal je Testlauf über globalSetup', () => {
    expect(config.globalSetup).toBe('./tests/e2e/globalSetup.ts');
  });

  it('kennt genau die drei Projekte chromium, chromium-fakecam und chromium-fakecam-foreign', () => {
    expect((config.projects ?? []).map((entry) => entry.name)).toEqual(['chromium', 'chromium-fakecam', 'chromium-fakecam-foreign']);
  });

  it('hält beide Fake-Kamera-Smokes aus dem Projekt chromium heraus', () => {
    // Ohne testIgnore liefen sie auch mit der synthetischen Kamera – ohne QR-Code, also blind.
    // Die Liste steht ausdrücklich statt als Platzhalter-Muster: ein neuer Fake-Kamera-Spec, den
    // niemand einträgt, läuft dann im Projekt chromium und scheitert laut, statt still auszufallen.
    expect(project('chromium').testIgnore).toEqual(FAKECAM_SPECS);
    expect(project('chromium-fakecam').testMatch).toBe(FAKECAM_SPECS[0]);
    expect(project('chromium-fakecam-foreign').testMatch).toBe(FAKECAM_SPECS[1]);
  });

  it('gibt allen Projekten die vollständige Flag-Liste und die Kamera-Erlaubnis', () => {
    for (const name of ['chromium', 'chromium-fakecam', 'chromium-fakecam-foreign']) {
      expect(args(name).slice(0, BASE_ARGS.length), `Basis-Flags von ${name}`).toEqual(BASE_ARGS);
      // Persistierte Kamera-Erlaubnis – nicht das Fake-UI-Flag – hebt Chromes mDNS-Verschleierung auf.
      expect(project(name).use?.permissions, `Kamera-Erlaubnis von ${name}`).toEqual(['camera']);
    }
  });

  it('speist jedem Fake-Kamera-Projekt SEINE Datei mit absolutem Pfad ein', () => {
    expect(args('chromium-fakecam')).toEqual([...BASE_ARGS, `--use-file-for-fake-video-capture=${resolve(FAKECAM_Y4M_PATH)}`]);
    expect(args('chromium-fakecam-foreign')).toEqual([...BASE_ARGS, `--use-file-for-fake-video-capture=${resolve(FAKECAM_FOREIGN_Y4M_PATH)}`]);
    expect(args('chromium')).toEqual(BASE_ARGS);
  });
});
