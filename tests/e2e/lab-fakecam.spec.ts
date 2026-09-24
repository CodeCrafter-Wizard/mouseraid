import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKECAM_Y4M_PATH, fakecamQrText } from '../../scripts/lib/qrY4m.mjs';
import type { LabHook } from '../../src/lab/labHook';

// Ein einziger Smoke im Projekt `chromium-fakecam`: Chromium liefert statt des synthetischen
// Testbilds die .y4m-Datei aus globalSetup, in der ein 1100-Zeichen-QR-Code steckt. Bewiesen wird
// damit die ganze Kette Kamera → <video> → scanVideo/scanImage → Text.
//
// Kein QR-HANDSHAKE: die Datei liefert je Browser-Start genau EINEN Code, ein Handshake bräuchte zwei.
// Datenschutz: `track.label` ist mit diesem Flag der volle Dateipfad samt Benutzername – aus der
// Seite kommen deshalb nur Wahrheitswerte und Zahlen, nie der gescannte Text.
//
// Der Test gehört ins Tor (kein @local): gemessen wurden aufeinanderfolgende grüne Läufe, headless,
// ohne Netz und ohne echte Kamera. Fällt er in der CI auf einem Linux-Runner um (dort ungemessen),
// wird er DORT mit `{ tag: '@local' }` versehen und der Grund in `docs/decisions.md` notiert – der
// Test wird nicht abgeschwächt.

interface LabWindow {
  __mbLab: LabHook;
}

test('Fake-Kamera: der gepflanzte QR-Code wird über scanVideo und scanImage bytegleich dekodiert', async ({ page }) => {
  const file = resolve(FAKECAM_Y4M_PATH);
  expect(existsSync(file), `${FAKECAM_Y4M_PATH} fehlt – globalSetup nicht gelaufen?`).toBe(true);

  await page.goto('lab.html?hook=1');
  // Kurzer Timeout: fehlt der Haken (alter Build, ?hook=1 vergessen), scheitert der Test in 10 s statt in 60.
  await page.waitForFunction(() => '__mbLab' in window, undefined, { timeout: 10_000 });

  const expected = fakecamQrText(1100);
  const outcome = await page.evaluate(async (want) => {
    const lab = (window as unknown as LabWindow).__mbLab;
    // OHNE Constraints: verlangt man eine Auflösung, die nicht zum Seitenverhältnis der Datei passt,
    // beschneidet und dreht Chromium das Bild – der Code wäre dann unbemerkt unlesbar.
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.srcObject = stream;
    document.body.append(video);
    await video.play();
    const abort = new AbortController();
    try {
      const scanned = await lab.scanVideo(video, { signal: abort.signal, timeoutMs: 20_000 });
      const single = await lab.scanImage(video);
      return {
        backend: await lab.detectScanBackend(),
        videoMatch: scanned.text === want,
        imageMatch: single !== null && single.text === want,
        chars: scanned.text.length,
        attempts: scanned.attempts,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    } finally {
      abort.abort();
      for (const track of stream.getTracks()) track.stop();
      video.remove();
    }
  }, expected);

  // Auf Windows und auf einem Linux-Runner gibt es kein `BarcodeDetector` – geprüft wird immer der Worker.
  expect(outcome.backend).toBe('worker');
  expect(outcome.videoMatch).toBe(true);
  expect(outcome.imageMatch).toBe(true);
  expect(outcome.chars).toBe(expected.length);
  expect(outcome.attempts).toBeGreaterThan(0);
  // Dateimaße = angeforderte Maße: kämen hier 480x640 an, hätte Chromium beschnitten und gedreht.
  expect(outcome.width).toBe(640);
  expect(outcome.height).toBe(480);
});
