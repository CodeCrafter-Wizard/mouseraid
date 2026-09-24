import { describe, expect, it } from 'vitest';
import { MAX_QR_PAYLOAD_CHARS, QrTooLargeError, qrModuleCount, renderQr } from '../../../src/lab/qrRender';

// Vitest läuft im Node-Umfeld (kein DOM). `renderQr` braucht vom Canvas nur `clientWidth`,
// `width`/`height` und `getContext('2d').fillStyle/fillRect` – das ist die ganze Attrappe.
interface Rect { x: number; y: number; w: number; h: number; fill: string }

function fakeCanvas(clientWidth = 0): { canvas: HTMLCanvasElement; rects: Rect[]; sizes: () => { width: number; height: number } } {
  const rects: Rect[] = [];
  const context = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h, fill: context.fillStyle });
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    clientWidth,
    getContext: (kind: string): unknown => (kind === '2d' ? context : null),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, rects, sizes: () => ({ width: canvas.width, height: canvas.height }) };
}

// Kleinbuchstaben, Großbuchstaben, Ziffern und `-_` dicht gemischt – genau wie die base64url-Ausgabe
// des echten Codecs. Entscheidend ist nicht die Zufälligkeit, sondern dass `qrcode` daraus EIN
// Byte-Segment macht: eine reine Groß-/Ziffernfolge landete im Alphanumerik-Modus und ergäbe bei
// gleicher Länge eine viel kleinere Version (1100 Zeichen: v22/105 statt v27/125 Module).
const PATTERN = 'aB3-cD9_eF1xYz';

/**
 * Synthetischer Payload in der FORM des echten Codecs (`MB1.p.<base64url>`), zur Laufzeit gebaut.
 * Datenschutz: kein echter Kandidat, keine Adresse, nichts Wörtliches im Repo.
 */
function payload(chars: number): string {
  let out = 'MB1.p.';
  for (let i = 0; out.length < chars; i += 1) out += PATTERN.charAt(i % PATTERN.length);
  return out.slice(0, chars);
}

/** Zählt die dunklen Module in der Bitmatrix – Gegenprobe zur Zahl der schwarzen Rechtecke. */
function darkModules(text: string): number {
  const rects = fakeCanvas(320);
  renderQr(rects.canvas, text);
  return rects.rects.filter((rect) => rect.fill === '#000000').length;
}

describe('qrModuleCount', () => {
  // Gemessen mit qrcode@1.5.4 bei ECC M und einem Byte-Segment; Grundlage des Größen-Sweeps in T2.
  const TABLE: readonly { chars: number; modules: number }[] = [
    { chars: 200, modules: 57 },
    { chars: 400, modules: 77 },
    { chars: 700, modules: 101 },
    { chars: 900, modules: 113 },
    { chars: 1100, modules: 125 },
  ];

  for (const { chars, modules } of TABLE) {
    it(`${chars} Zeichen ergeben ${modules} Module`, () => {
      expect(qrModuleCount(payload(chars))).toBe(modules);
    });
  }

  it('bleibt am Deckel bei höchstens 125 Modulen (Version 27 bei ECC M)', () => {
    expect(qrModuleCount(payload(MAX_QR_PAYLOAD_CHARS))).toBeLessThanOrEqual(125);
  });

  it('lehnt leeren Text ab – ein leerer Code wäre stumm', () => {
    expect(() => qrModuleCount('')).toThrow(/No input text/);
  });
});

describe('MAX_QR_PAYLOAD_CHARS', () => {
  it('ist 1100 – die Codec-Grenze 4096 passt bei ECC M in keinen QR-Code', () => {
    expect(MAX_QR_PAYLOAD_CHARS).toBe(1100);
  });
});

describe('renderQr', () => {
  it('zeichnet genau 1100 Zeichen noch, 1101 nicht mehr', () => {
    const ok = fakeCanvas(320);
    expect(renderQr(ok.canvas, payload(1100)).chars).toBe(1100);

    const tooBig = fakeCanvas(320);
    let caught: unknown = null;
    try {
      renderQr(tooBig.canvas, payload(1101));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QrTooLargeError);
    expect((caught as QrTooLargeError).chars).toBe(1101);
    expect((caught as QrTooLargeError).name).toBe('QrTooLargeError');
    // Nichts gezeichnet: der Deckel greift VOR dem Canvas-Zugriff.
    expect(tooBig.rects).toHaveLength(0);
    expect(tooBig.sizes()).toEqual({ width: 0, height: 0 });
  });

  it('rechnet Modulgröße und Canvas-Breite ganzzahlig aus Breite und Pixelverhältnis', () => {
    const { canvas } = fakeCanvas();
    const result = renderQr(canvas, payload(700), { cssWidth: 390, devicePixelRatio: 3 });
    expect(result.modules).toBe(101);
    expect(result.totalModules).toBe(109); // 101 + 2 * 4 Ruhezone
    expect(result.modulePx).toBe(Math.floor((390 * 3) / 109)); // 10
    expect(result.canvasPx).toBe(109 * result.modulePx); // 1090
    expect(result.canvasPx % result.totalModules).toBe(0);
  });

  it('nimmt ohne Angabe die clientWidth des Canvas, sonst 320, und dpr 1 im Node-Umfeld', () => {
    // 200 Zeichen = 57 Module + 8 Ruhezone = 65.
    const wide = fakeCanvas(600);
    expect(renderQr(wide.canvas, payload(200), { devicePixelRatio: 1 }).modulePx).toBe(Math.floor(600 / 65)); // 9
    const bare = fakeCanvas();
    expect(renderQr(bare.canvas, payload(200)).modulePx).toBe(Math.floor(320 / 65)); // 4
  });

  it('hält die Untergrenze von 2 px je Modul ein, wenn der Platz nicht reicht (R13)', () => {
    const { canvas } = fakeCanvas();
    const result = renderQr(canvas, payload(1100), { cssWidth: 200, devicePixelRatio: 1 });
    // 200 / 133 = 1 – ohne Untergrenze wäre der Code auf keinem Telefon mehr scannbar.
    expect(result.modulePx).toBe(2);
    expect(result.canvasPx).toBe(133 * 2);
    expect(renderQr(canvas, payload(1100), { cssWidth: 200, devicePixelRatio: 1, minModulePx: 5 }).modulePx).toBe(5);
  });

  it('setzt die Canvas-Maße und malt zuerst Weiß über die volle Fläche, dann Schwarz', () => {
    const { canvas, rects, sizes } = fakeCanvas(320);
    const result = renderQr(canvas, payload(400), { devicePixelRatio: 1 });
    expect(sizes()).toEqual({ width: result.canvasPx, height: result.canvasPx });
    expect(rects[0]).toEqual({ x: 0, y: 0, w: result.canvasPx, h: result.canvasPx, fill: '#ffffff' });
    expect(rects.slice(1).every((rect) => rect.fill === '#000000')).toBe(true);
  });

  it('legt jedes dunkle Modul auf das Raster und lässt die Ruhezone von 4 Modulen frei', () => {
    const { canvas, rects } = fakeCanvas(320);
    const result = renderQr(canvas, payload(200), { devicePixelRatio: 1 });
    const dark = rects.slice(1);
    const quiet = 4 * result.modulePx;
    expect(dark.length).toBeGreaterThan(0);
    for (const rect of dark) {
      expect(rect.w).toBe(result.modulePx);
      expect(rect.h).toBe(result.modulePx);
      expect((rect.x - quiet) % result.modulePx).toBe(0);
      expect((rect.y - quiet) % result.modulePx).toBe(0);
      expect(rect.x).toBeGreaterThanOrEqual(quiet);
      expect(rect.y).toBeGreaterThanOrEqual(quiet);
      expect(rect.x).toBeLessThanOrEqual(result.canvasPx - quiet - result.modulePx);
      expect(rect.y).toBeLessThanOrEqual(result.canvasPx - quiet - result.modulePx);
    }
    // Das Sucherquadrat oben links ist 7x7 Module – ohne es wäre der Code kein QR-Code.
    const corner = dark.filter((rect) => rect.x < quiet + 7 * result.modulePx && rect.y < quiet + 7 * result.modulePx);
    expect(corner).toHaveLength(7 * 7 - 5 * 5 + 3 * 3);
  });

  it('zeichnet so viele schwarze Rechtecke, wie die Bitmatrix dunkle Module hat', () => {
    // Gegenprobe über zwei Größen: ein Off-by-one in der Zeilen-/Spalten-Rechnung fiele hier auf.
    expect(darkModules(payload(200))).toBeGreaterThan(0);
    expect(darkModules(payload(900))).toBeGreaterThan(darkModules(payload(200)));
  });

  it('wirft, wenn das Canvas keinen 2D-Kontext liefert', () => {
    const canvas = { width: 0, height: 0, clientWidth: 320, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => renderQr(canvas, payload(200))).toThrow(/Canvas 2D context not available/);
  });

  it('lehnt leeren Text ab', () => {
    const { canvas } = fakeCanvas(320);
    expect(() => renderQr(canvas, '')).toThrow(/No input text/);
  });
});
