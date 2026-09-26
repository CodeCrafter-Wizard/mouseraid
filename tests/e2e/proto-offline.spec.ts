import { expect, test } from '@playwright/test';

/**
 * Das Tor für den eigenständigen Prototyp unter `/spiel/` (public/spiel/): er lädt three.js,
 * qrcode-generator und beide Schriften aus dem eigenen Ordner. Genau das beweist dieser Spec –
 * käme eine CDN-Zeile zurück, wäre die Seite online grün und offline kaputt, und `check-dist`
 * prüft URLs nur gegen babylonjs.com (scripts/lib/distChecks.mjs).
 *
 * Die Seite registriert selbst KEINEN Service Worker; den bringt die Hauptseite mit (Scope
 * `/mouseraid/`). Deshalb zuerst `./` laden und auf „Offline bereit" warten – danach liegt
 * `spiel/**` im Precache.
 */
test('Prototyp /spiel/ startet online und offline ohne Fremd-Hosts', async ({ context, page, baseURL }) => {
  // Gemessen auf dem Linux-Runner (Lauf 36269310993): Precache (3,1 MB, 40 Dateien) plus der erste
  // Weltaufbau des Prototyps unter SwiftShader brauchten 53 s – der Standard-Timeout von 60 s ließ dem
  // Offline-Reload nur 7 s, obwohl die Seite (Screencast) längst stand. Lokal dauert alles 3 s.
  test.setTimeout(240_000);
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  // Am Kontext, nicht an der Seite: so zählen auch die Anfragen des Service Workers mit.
  context.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });

  await page.goto('./');
  await expect(page.getByTestId('offline-badge')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });

  const assertPrototypeRuns = async (): Promise<void> => {
    // `window.__mb` setzt die letzte Zeile der IIFE, also NACH `buildWorld()`: ein stiller Absturz
    // beim Weltaufbau würde `#fatal` nicht zeigen und wäre sonst unsichtbar. Der Weltaufbau läuft
    // synchron im Inline-Skript – auf einem langsamen Runner dauert er deutlich länger als lokal,
    // deshalb wird HIER gewartet (bis 120 s) und nicht auf das `load`-Ereignis der Navigation.
    await page.waitForFunction(() => '__mb' in window, undefined, { timeout: 120_000 });
    await expect(page.locator('#fatal')).toBeHidden();
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('canvas#gl')).toHaveCount(1);
    // three.js kommt aus ./vendor/ – ohne die Bibliothek zeigt die Seite ihren `#fatal`-Schirm.
    expect(await page.evaluate(() => typeof (window as unknown as { THREE?: unknown }).THREE)).toBe('object');
  };

  await page.goto('./spiel/', { waitUntil: 'domcontentloaded' });
  await assertPrototypeRuns();
  expect(foreign, 'Prototyp darf online keine Fremd-Hosts ansprechen').toEqual([]);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await assertPrototypeRuns();

  // Die Schriften liegen als woff2 daneben und sind vorgecacht – ohne sie fiele die Seite still
  // auf „Trebuchet MS"/system-ui zurück, und das Offline-Versprechen wäre nur halb erfüllt.
  const fontsReady = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      display: document.fonts.check('800 20px Grandstander'),
      body: document.fonts.check('400 16px "Atkinson Hyperlegible"'),
    };
  });
  expect(fontsReady).toEqual({ display: true, body: true });

  expect(foreign, 'Prototyp darf auch offline keine Fremd-Hosts ansprechen').toEqual([]);
});
