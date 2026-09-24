import { afterEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { MAX_QR_PAYLOAD_CHARS, QrTooLargeError, createQrOverlay, qrModuleCount, renderQr } from '../../../src/lab/qrRender';
import type { QrOverlay } from '../../../src/lab/qrRender';

// Vitest läuft im Node-Umfeld (kein DOM). `renderQr` braucht vom Canvas nur `clientWidth`,
// `width`/`height`, `style` und `getContext('2d').fillStyle/fillRect` – das ist die ganze Attrappe.
interface Rect { x: number; y: number; w: number; h: number; fill: string }

function fakeCanvas(clientWidth = 0): {
  canvas: HTMLCanvasElement;
  rects: Rect[];
  style: Record<string, string>;
  sizes: () => { width: number; height: number };
} {
  const rects: Rect[] = [];
  const style: Record<string, string> = {};
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
    style,
    getContext: (kind: string): unknown => (kind === '2d' ? context : null),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, rects, style, sizes: () => ({ width: canvas.width, height: canvas.height }) };
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

// `devicePixelRatio`, `innerWidth`, `innerHeight` und `document` gibt es im Node-Umfeld nicht;
// die Tests, die sie brauchen, stellen sie selbst hin und geben sie hier wieder frei.
afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(tooBig.style).toEqual({});
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

  it('begrenzt die ANZEIGEbreite in CSS-Pixeln, nicht nur den Speicher in Gerätepixeln', () => {
    // Ohne die CSS-Maße wäre das Canvas so breit wie sein Speicher – bei dpr 3 also dreimal so
    // breit wie die Spalte. Der Speicher bleibt in Gerätepixeln (1:1, kein Umrechnen beim Malen).
    const one = fakeCanvas();
    const flat = renderQr(one.canvas, payload(200), { cssWidth: 320, devicePixelRatio: 1 });
    expect(one.style.width).toBe(`${flat.canvasPx}px`);
    expect(one.style.height).toBe(`${flat.canvasPx}px`);
    expect(flat.canvasPx).toBeLessThanOrEqual(320);

    // Ohne Angabe zählt globalThis.devicePixelRatio – im Browser der übliche Fall.
    vi.stubGlobal('devicePixelRatio', 3);
    const dense = fakeCanvas(390);
    const result = renderQr(dense.canvas, payload(700));
    expect(result.modulePx).toBe(Math.floor((390 * 3) / result.totalModules));
    expect(dense.canvas.width).toBe(result.canvasPx); // Speicher: Gerätepixel
    expect(dense.canvas.height).toBe(result.canvasPx);
    expect(dense.style.width).toBe(`${result.canvasPx / 3}px`); // Anzeige: CSS-Pixel
    expect(dense.style.height).toBe(`${result.canvasPx / 3}px`);
    expect(result.canvasPx / 3).toBeLessThanOrEqual(390);
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
    const text = payload(200);
    const result = renderQr(canvas, text, { devicePixelRatio: 1 });
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

    // Gegen ein gespiegeltes oder um 90° gedrehtes Raster: die gezeichneten Zellen sind GENAU die
    // dunklen Module der Bitmatrix (zeilenweise gelesen), verschoben um die Ruhezone. Die Prüfungen
    // oben allein ließen eine Spiegelung durch – ein so gedruckter Code wäre nicht dekodierbar.
    const matrix = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    const expectedCells: string[] = [];
    for (let row = 0; row < matrix.size; row += 1) {
      for (let col = 0; col < matrix.size; col += 1) {
        if (matrix.data[row * matrix.size + col] === 1) expectedCells.push(`${col}/${row}`);
      }
    }
    const drawnCells = dark.map((rect) => `${(rect.x - quiet) / result.modulePx}/${(rect.y - quiet) / result.modulePx}`);
    expect(new Set(drawnCells).size).toBe(drawnCells.length); // keine Zelle doppelt gemalt
    expect([...drawnCells].sort()).toEqual([...expectedCells].sort());
  });

  it('zeichnet so viele schwarze Rechtecke, wie die Bitmatrix dunkle Module hat', () => {
    // Gegenprobe über zwei Größen: ein Off-by-one in der Zeilen-/Spalten-Rechnung fiele hier auf.
    expect(darkModules(payload(200))).toBeGreaterThan(0);
    expect(darkModules(payload(900))).toBeGreaterThan(darkModules(payload(200)));
  });

  it('wirft, wenn das Canvas keinen 2D-Kontext liefert', () => {
    const canvas = { width: 0, height: 0, clientWidth: 320, style: {}, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => renderQr(canvas, payload(200))).toThrow(/Canvas 2D context not available/);
  });

  it('lehnt leeren Text ab', () => {
    const { canvas } = fakeCanvas(320);
    expect(() => renderQr(canvas, '')).toThrow(/No input text/);
  });
});

// ───────── Minimal-DOM für createQrOverlay ─────────
// Vitest bleibt im Node-Umfeld (Vertrag): statt jsdom bekommt das Modul dieselbe Art Attrappe wie
// das Canvas oben – gerade so viel, wie createQrOverlay anfasst.
interface FakeElement {
  className: string;
  hidden: boolean;
  textContent: string;
  type: string;
  width: number;
  height: number;
  clientWidth: number;
  removed: boolean;
  readonly dataset: Record<string, string>;
  readonly style: Record<string, string>;
  readonly children: FakeElement[];
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  append(...nodes: FakeElement[]): void;
  remove(): void;
  getContext(kind: string): unknown;
  fire(type: string, event?: unknown): void;
  listenerCount(type: string): number;
}

function fakeElement(): FakeElement {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const context = { fillStyle: '', fillRect(): void { /* das Bild interessiert hier nicht */ } };
  const node: FakeElement = {
    className: '', hidden: false, textContent: '', type: '',
    width: 0, height: 0, clientWidth: 0, removed: false,
    dataset: {}, style: {}, children: [],
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener)); },
    append(...nodes) { node.children.push(...nodes); },
    remove() { node.removed = true; },
    getContext: (kind) => (kind === '2d' ? context : null),
    fire(type, event = {}) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
  };
  return node;
}

interface FakeDocument {
  readonly body: FakeElement;
  createElement(tag: string): FakeElement;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  fire(type: string, event?: unknown): void;
  listenerCount(type: string): number;
}

function fakeDocument(): FakeDocument {
  const host = fakeElement();   // Zuhörer-Ablage für document selbst
  return {
    body: fakeElement(),
    createElement: () => fakeElement(),
    addEventListener: (type, listener) => { host.addEventListener(type, listener); },
    removeEventListener: (type, listener) => { host.removeEventListener(type, listener); },
    fire: (type, event) => { host.fire(type, event); },
    listenerCount: (type) => host.listenerCount(type),
  };
}

function childAt(parent: FakeElement, index: number): FakeElement {
  const child = parent.children[index];
  if (child === undefined) throw new Error(`Kind ${index} fehlt`);
  return child;
}

describe('createQrOverlay', () => {
  function mountOverlay(): {
    doc: FakeDocument;
    overlay: QrOverlay;
    element: FakeElement;
    code: FakeElement;
    close: FakeElement;
  } {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);
    const overlay = createQrOverlay('Bildschirm hell stellen');
    const element = overlay.element as unknown as FakeElement;
    return { doc, overlay, element, code: childAt(element, 0), close: childAt(element, 2) };
  }

  it('hängt sich verborgen an den body und beschriftet Code, Hinweis und Knopf', () => {
    const { doc, element, code, close } = mountOverlay();
    expect(element.hidden).toBe(true);
    expect(doc.body.children).toEqual([element]);
    expect(element.dataset.testid).toBe('qr-overlay');
    expect(code.dataset.testid).toBe('qr-overlay-code');
    expect(childAt(element, 1).textContent).toBe('Bildschirm hell stellen');
    expect(close.dataset.testid).toBe('qr-overlay-close');
    expect(close.textContent).toBe('Schließen');
  });

  it('gibt dem Schließen-Knopf KEIN `secondary` – auf dem weißen Grund der Lupe wäre er unsichtbar', () => {
    // `.btn.secondary` ist rgba(255,255,255,0.12) mit weißer Schrift: auf Weiß Kontrast 1:1.
    const { close } = mountOverlay();
    expect(close.className.split(' ')).not.toContain('secondary');
    expect(close.className.split(' ')).toContain('btn');
    expect(close.className.split(' ')).toContain('qr-overlay-close');
  });

  it('schließt beim Klick auf den Knopf – Enter und Leertaste lösen click aus, nie pointerup', () => {
    const { overlay, element, close } = mountOverlay();
    overlay.open(payload(200));
    expect(element.hidden).toBe(false);
    close.fire('click');
    expect(element.hidden).toBe(true);
  });

  it('schließt weiterhin bei Tipp auf die Fläche und mit Escape', () => {
    const { doc, overlay, element } = mountOverlay();
    overlay.open(payload(200));
    element.fire('pointerup');
    expect(element.hidden).toBe(true);

    overlay.open(payload(200));
    doc.fire('keydown', { key: 'a' });
    expect(element.hidden).toBe(false);
    doc.fire('keydown', { key: 'Escape' });
    expect(element.hidden).toBe(true);
  });

  it('überlässt die Anzeigegröße der Lupe dem Stylesheet (90 vmin), zeichnet aber in Gerätepixeln', () => {
    // renderQr setzt die CSS-Maße inline für die KACHEL; inline schlägt die Klassenregel. In der
    // Lupe muss `.qr-overlay-code { width: 90vmin }` gewinnen, sonst schrumpft der Code auf die
    // gerundete Modulbreite und die 90-%-Zusage des Vertrags fiele.
    const { overlay, code } = mountOverlay();
    overlay.open(payload(200));
    expect(code.width).toBeGreaterThan(0);
    expect(code.width).toBe(code.height);
    expect(code.style.width).toBe('');
    expect(code.style.height).toBe('');
  });

  it('meldet beim dispose jeden Zuhörer ab und entfernt das Element', () => {
    const { doc, overlay, element, close } = mountOverlay();
    overlay.open(payload(200));
    overlay.dispose();
    expect(element.removed).toBe(true);
    expect(element.listenerCount('pointerup')).toBe(0);
    expect(close.listenerCount('click')).toBe(0);
    expect(doc.listenerCount('keydown')).toBe(0);
  });

  it('schließt über close() auch ohne Ereignis', () => {
    const { overlay, element } = mountOverlay();
    overlay.open(payload(200));
    overlay.close();
    expect(element.hidden).toBe(true);
  });
});
