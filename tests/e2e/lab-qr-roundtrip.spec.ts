import { expect, test } from '@playwright/test';

// Größen-Sweep des QR-Pfads OHNE Kamera: Payload → renderQr → Canvas bzw. ImageData →
// scannerAdapter.scanImage → bytegleicher Text. Gehört zum E2E-Tor (kein @local): der Test braucht
// weder ein zweites Gerät noch eine Kamera-Erlaubnis noch Netz.
//
// Datenschutz: der Payload wird IN der Seite gebaut – aus Dokumentationsadressen (RFC 5737/3849),
// nie aus einem echten Kandidaten –, und aus der Seite kommen nur Zahlen und Wahrheitswerte zurück.
//
// BEWUSSTE EINSCHRÄNKUNG: der Payload ist SYNTHETISCH (`MB1.p.<base64url>` der gewünschten Länge) und
// läuft nicht durch `minimise`/`encodeDesc`. D11(a) erlaubt das ausdrücklich („oder ein synthetischer
// `MB1.p.`-Payload"). Geprüft wird damit die Kette qrRender → Canvas/ImageData → scannerAdapter,
// nicht der Codec – den decken die Unit-Tests von `sdpCodec` aus M1 ab.

/** Die Sweep-Größen der Spec; 1100 ist die Scan-Reserve (MAX_QR_PAYLOAD_CHARS). */
const SIZES = [200, 400, 700, 900, 1100] as const;
/**
 * GEMESSEN (nicht aus dem Faktenblatt): ein base64url-Payload wird von `qrcode` im BYTE-Modus
 * kodiert – 1100 Zeichen sind damit Version 27 = 125 Module. Die 105 Module des Faktenblatts
 * (Version 22) gelten nur für reine Großbuchstaben/Ziffern, die `qrcode` als Alphanumerik-Segment
 * packt (5,5 statt 8 Bit je Zeichen); ein echter `MB1.<d|p>.`-Code ist gemischt und kann das nicht.
 * Wer diese Zahl senken will, senkt MAX_QR_PAYLOAD_CHARS – nicht den Test.
 */
const MAX_MODULES = 125;

/**
 * Nur die Haken-Felder, die dieser Test benutzt – lokal typisiert, genau das Muster aus R8 und
 * lab-rtc.spec.ts. Ein `import type { LabHook }` wäre nach R10 erlaubt (der Haken-Graph erreicht
 * `src/platform/buildInfo.ts` seit dem Leaf-Modul `labTypes.ts` nicht mehr, siehe
 * tests/node/labHook-graph.test.ts); die lokale Schnittstelle hält den Spec aber unabhängig davon,
 * welche Felder T3–T4 später ergänzen. Bewusste Entscheidung, kein Versehen.
 * ESLint sieht `QrHook` nur im Browser-Sichtbereich von `page.evaluate` – das ist legal, Typen werden
 * beim Übersetzen gelöscht.
 */
interface QrHook {
  renderQr(
    canvas: HTMLCanvasElement,
    text: string,
    options?: { cssWidth?: number; devicePixelRatio?: number; minModulePx?: number },
  ): { chars: number; modules: number; totalModules: number; canvasPx: number; modulePx: number };
  qrModuleCount(text: string): number;
  MAX_QR_PAYLOAD_CHARS: number;
  detectScanBackend(): Promise<string>;
  scanImage(source: HTMLCanvasElement | HTMLVideoElement | ImageData): Promise<{ text: string; backend: string; attempts: number } | null>;
}

interface SweepRow {
  chars: number;
  modules: number;
  totalModules: number;
  canvasPx: number;
  canvasMatch: boolean;
  imageDataMatch: boolean;
  backend: string;
  attempts: number;
  latencyMs: number;
}

test('QR-Roundtrip 200–1100 Zeichen: gerenderter Code wird bytegleich zurückgelesen', async ({ page }, testInfo) => {
  await page.goto('lab.html?hook=1');
  await page.waitForFunction(() => '__mbLab' in window);

  const rows: SweepRow[] = await page.evaluate(async (sizes: number[]) => {
    const hook = (window as unknown as { __mbLab: QrHook }).__mbLab;

    /** Länge eines base64url-Rumpfs ohne Polsterung: 4 Zeichen je 3 Bytes, Rest 1 → 2, Rest 2 → 3. */
    const rest = [0, 2, 3];
    const bodyLength = (bytes: number): number => 4 * Math.floor(bytes / 3) + (rest[bytes % 3] ?? 0);

    const toBase64Url = (bytes: Uint8Array): string => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    };

    /**
     * Synthetischer Payload in der FORM des Codecs (`MB1.p.<base64url>`) mit genau `chars` Zeichen:
     * dieselbe Zeichenmenge und dieselbe Segmentierung wie ein echter Code, aber ohne eine einzige
     * echte Adresse. Der Füllwert wechselt die Zeichen – ein eintöniger Lauf würde die
     * Segment-Optimierung von `qrcode` unrealistisch begünstigen und die Modulzahl schönrechnen.
     */
    const payloadOfLength = (chars: number): string => {
      const prefix = 'MB1.p.';
      const wanted = chars - prefix.length;
      let bytes = Math.floor((wanted * 3) / 4);
      while (bodyLength(bytes) < wanted) bytes += 1;
      if (bodyLength(bytes) !== wanted) throw new Error(`Länge ${chars} ist als base64url nicht exakt darstellbar`);
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const desc = { v: 1, p: 1, r: 'o', s: 1, n: 42, c: ['1 1 udp 1 192.0.2.10 50000 typ host'], z: '' };
      const fill = bytes - JSON.stringify(desc).length;
      if (fill < 0) throw new Error(`Grundgerüst ist länger als ${chars} Zeichen`);
      desc.z = Array.from({ length: fill }, (_, index) => alphabet[(index * 7 + 3) % alphabet.length] ?? 'x').join('');
      const text = prefix + toBase64Url(new TextEncoder().encode(JSON.stringify(desc)));
      if (text.length !== chars) throw new Error(`Payload hat ${text.length} statt ${chars} Zeichen`);
      return text;
    };

    const measured: SweepRow[] = [];
    for (const chars of sizes) {
      const text = payloadOfLength(chars);
      const canvas = document.createElement('canvas');
      // Feste Maße statt Layout-Werten: dieser Test misst den Roundtrip, nicht das Seitenlayout.
      const info = hook.renderQr(canvas, text, { cssWidth: 512, devicePixelRatio: 1, minModulePx: 4 });
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Canvas ohne 2d-Kontext');
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

      const startedAt = performance.now();
      const fromCanvas = await hook.scanImage(canvas);
      const latencyMs = Math.round(performance.now() - startedAt);
      // Zweiter Weg: `QrScanner.scanImage` lehnt ImageData ab – unser Adapter zeichnet es vorher auf
      // ein Canvas. Beide Wege müssen denselben Text liefern.
      const fromImageData = await hook.scanImage(imageData);

      measured.push({
        chars: info.chars,
        modules: info.modules,
        totalModules: info.totalModules,
        canvasPx: info.canvasPx,
        // Nur Wahrheitswerte und Zahlen verlassen die Seite – nie der Payload selbst.
        canvasMatch: fromCanvas !== null && fromCanvas.text === text,
        imageDataMatch: fromImageData !== null && fromImageData.text === text,
        backend: fromCanvas?.backend ?? 'kein-treffer',
        attempts: fromCanvas?.attempts ?? -1,
        latencyMs,
      });
    }
    return measured;
  }, [...SIZES]);

  expect(rows.map((row) => row.chars)).toEqual([...SIZES]);
  for (const row of rows) {
    expect(row.canvasMatch, `Canvas-Scan bei ${row.chars} Zeichen`).toBe(true);
    expect(row.imageDataMatch, `ImageData-Scan bei ${row.chars} Zeichen`).toBe(true);
    expect(row.attempts, `Versuche bei ${row.chars} Zeichen`).toBe(1);
    // Windows-Chromium hat kein BarcodeDetector (Faktenblatt) – hier läuft immer der Worker-Pfad.
    expect(row.backend, `Backend bei ${row.chars} Zeichen`).toBe('worker');
    // Ganzzahlige Modulgröße: sonst verwischen halbe Module beim Hochskalieren.
    expect(row.canvasPx % row.totalModules, `Modulraster bei ${row.chars} Zeichen`).toBe(0);
  }

  const largest = rows.at(-1);
  expect(largest?.chars).toBe(1100);
  expect(largest?.modules, 'Scan-Reserve: 1100 Zeichen bleiben bei ECC M im Byte-Modus unter 126 Modulen').toBeLessThanOrEqual(MAX_MODULES);

  // Messwerte in den Bericht – Zahlen, keine Inhalte.
  testInfo.annotations.push({
    type: 'qr-sweep',
    description: rows.map((row) => `${row.chars} Zeichen: ${row.modules} Module, ${row.canvasPx} px, ${row.latencyMs} ms`).join(' · '),
  });
});

test('Der Haken meldet den Worker-Pfad, die Payload-Grenze und lehnt zu große Codes ab', async ({ page }) => {
  await page.goto('lab.html?hook=1');
  await page.waitForFunction(() => '__mbLab' in window);

  const facts = await page.evaluate(async () => {
    const hook = (window as unknown as { __mbLab: QrHook }).__mbLab;
    const canvas = document.createElement('canvas');
    const short = 'MB1.p.kurz';
    const shown = hook.renderQr(canvas, short);
    const scanned = await hook.scanImage(canvas);
    let tooLarge = 'kein Fehler';
    try {
      hook.renderQr(canvas, 'M'.repeat(hook.MAX_QR_PAYLOAD_CHARS + 1));
    } catch (error) {
      tooLarge = error instanceof Error ? error.name : 'kein Error';
    }
    return {
      backend: await hook.detectScanBackend(),
      cap: hook.MAX_QR_PAYLOAD_CHARS,
      modulesMatch: shown.modules === hook.qrModuleCount(short),
      roundtrip: scanned !== null && scanned.text === short,
      tooLarge,
    };
  });

  expect(facts).toEqual({ backend: 'worker', cap: 1100, modulesMatch: true, roundtrip: true, tooLarge: 'QrTooLargeError' });
});
