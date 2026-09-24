import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FAKECAM_FOREIGN_SIZE,
  FAKECAM_FOREIGN_TEXT,
  FAKECAM_FOREIGN_Y4M_PATH,
  FAKECAM_SIZE,
  FAKECAM_Y4M_PATH,
  fakecamQrText,
  writeQrY4m,
} from '../../scripts/lib/qrY4m.mjs';

// Der Generator ist die einzige Stelle, an der das Fake-Kamera-Bild entsteht. Ein falsches Layout
// (halbe Module, fehlende Ruhezone, vertauschte Ebenen) fiele im Playwright-Smoke nur als
// nichtssagende Zeitüberschreitung auf – deshalb wird hier die Datei selbst vermessen.

const QUIET_MODULES = 4;
const HEADER = `YUV4MPEG2 W${FAKECAM_SIZE.width} H${FAKECAM_SIZE.height} F30:1 Ip A1:1 C420mpeg2`;
const FRAME_TAG = 'FRAME\n';

let dir = '';
let file = '';
let text = '';
let written: ReturnType<typeof writeQrY4m>;
let bytes: Buffer;

beforeAll(() => {
  // In ein eigenes Temp-Verzeichnis: der Pfad aus FAKECAM_Y4M_PATH gehört dem Playwright-Lauf,
  // und der Test unten prüft, dass ihn niemand nebenbei anfasst.
  dir = mkdtempSync(join(tmpdir(), 'maeusebau-y4m-'));
  file = join(dir, 'tief', 'qr.y4m');
  text = fakecamQrText(1100);
  written = writeQrY4m({ text, ...FAKECAM_SIZE, path: file });
  bytes = readFileSync(file);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fakecamQrText', () => {
  it('liefert genau die gewünschte Zeichenzahl mit dem Payload-Präfix des Codecs', () => {
    expect(fakecamQrText(1100)).toHaveLength(1100);
    expect(fakecamQrText()).toHaveLength(1100);
    expect(fakecamQrText(400)).toHaveLength(400);
    expect(text.startsWith('MB1.p.')).toBe(true);
    // base64url: kein +, kein /, kein =
    expect(/^MB1\.p\.[A-Za-z0-9_-]+$/.test(text)).toBe(true);
  });

  it('ist bei gleicher Länge stabil – sonst passten Datei und Erwartung des Smokes nicht zusammen', () => {
    expect(fakecamQrText(1100)).toBe(text);
  });

  it('lehnt Längen ab, die base64url nicht treffen kann', () => {
    // Ein base64url-Rumpf hat nie eine Länge ≡ 1 (mod 4); 'MB1.p.' sind 6 Zeichen.
    expect(() => fakecamQrText(1099)).toThrow(RangeError);
  });
});

describe('writeQrY4m', () => {
  it('legt fehlende Ordner an und meldet den absoluten Pfad zurück', () => {
    expect(existsSync(file)).toBe(true);
    expect(written.path).toBe(resolve(file));
    expect(written.width).toBe(FAKECAM_SIZE.width);
    expect(written.height).toBe(FAKECAM_SIZE.height);
  });

  it('schreibt die Kopfzeile YUV4MPEG2 mit Maßen, 30 fps, progressiv und C420mpeg2', () => {
    const head = bytes.subarray(0, bytes.indexOf(0x0a)).toString('ascii');
    expect(head).toBe(HEADER);
  });

  it('schreibt genau EIN Bild: FRAME + Y + U + V mit W*H*1.5 Bytes', () => {
    const headerBytes = HEADER.length + 1;
    expect(bytes.subarray(headerBytes, headerBytes + FRAME_TAG.length).toString('ascii')).toBe(FRAME_TAG);
    const planes = (FAKECAM_SIZE.width * FAKECAM_SIZE.height * 3) / 2;
    expect(bytes.length).toBe(headerBytes + FRAME_TAG.length + planes);
    expect(written.bytes).toBe(bytes.length);
    // Chromium wiederholt die Datei in Schleife – ein zweites Bild wäre nur Ballast.
    expect(bytes.subarray(headerBytes + FRAME_TAG.length).includes(Buffer.from(FRAME_TAG, 'ascii'))).toBe(false);
  });

  it('füllt beide Farbebenen mit dem neutralen Wert 128', () => {
    const ySize = FAKECAM_SIZE.width * FAKECAM_SIZE.height;
    const chroma = bytes.subarray(HEADER.length + 1 + FRAME_TAG.length + ySize);
    expect(chroma).toHaveLength(ySize / 2);
    expect(chroma.every((value) => value === 128)).toBe(true);
  });

  it('pflanzt jedes Modul als ganzzahliges dunkles/helles Quadrat an der erwarteten Stelle', () => {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const total = size + 2 * QUIET_MODULES;
    const moduleSize = Math.floor(Math.min(FAKECAM_SIZE.width, FAKECAM_SIZE.height) / total);
    expect(written.modules).toBe(size);
    expect(written.moduleSize).toBe(moduleSize);
    // Unter 3 px je Modul wird der Scan unzuverlässig – dann ist die Datei zu klein für den Payload.
    expect(moduleSize).toBeGreaterThanOrEqual(3);

    const codePx = total * moduleSize;
    const originX = Math.floor((FAKECAM_SIZE.width - codePx) / 2);
    const originY = Math.floor((FAKECAM_SIZE.height - codePx) / 2);
    const yPlane = bytes.subarray(HEADER.length + 1 + FRAME_TAG.length);
    const at = (x: number, y: number): number => yPlane[y * FAKECAM_SIZE.width + x] ?? -1;
    /** Mitte des Moduls (mx|my) im Bild – die Ruhezone liegt zwischen Bildrand und Code. */
    const centreX = (mx: number): number => originX + (QUIET_MODULES + mx) * moduleSize + Math.floor(moduleSize / 2);
    const centreY = (my: number): number => originY + (QUIET_MODULES + my) * moduleSize + Math.floor(moduleSize / 2);

    // Polarität, absolut verankert: die Ecke des Sucher-Musters oben links ist in JEDEM QR-Code
    // dunkel. Die Schleife unten vergleicht nur mit der Konvention des Generators – ein invertiertes
    // Bild (dunkel und hell vertauscht) bestünde sie unverändert, diese Zeile nicht.
    expect(at(centreX(0), centreY(0)), 'Ecke des Sucher-Musters oben links ist dunkel').toBe(16);

    let dark = 0;
    for (let my = 0; my < size; my += 1) {
      for (let mx = 0; mx < size; mx += 1) {
        const expected = qr.modules.data[my * size + mx] === 1 ? 16 : 235;
        if (expected === 16) dark += 1;
        const px = centreX(mx);
        const py = centreY(my);
        // Ein einzelnes expect je Modul wäre bei 15 000 Modulen nur Lärm – die Zahl unten zählt.
        if (at(px, py) !== expected) throw new Error(`Modul ${mx}/${my}: ${at(px, py)} statt ${expected}`);
      }
    }
    expect(dark).toBeGreaterThan(0);

    // Ruhezone: das Modul links oben NEBEN dem Code ist hell, ebenso der Rand des Bildes.
    expect(at(originX + moduleSize, originY + moduleSize)).toBe(235);
    expect(at(0, 0)).toBe(235);
    expect(at(FAKECAM_SIZE.width - 1, FAKECAM_SIZE.height - 1)).toBe(235);
  });
});

// Zweiter Smoke (Nachtrag der Task-4-Prüfrunde): ein FREMDER Code beweist die SCHREIBENDE Seite von
// `qr:skipped`. Er braucht ein eigenes Bild, weil die Kamera-Datei je Browser-Start gilt – und andere
// Maße, weil ihn die LOBBY-Kamera sieht: die fordert 1280x720 an (src/lab/camera.ts), nicht `video: true`.
describe('Fremder Code', () => {
  it('zeigt auf ein Ziel, das es nie geben kann, und ist kein Mäusebau-Payload', () => {
    // RFC 2606 reserviert `.invalid` – diese Adresse gehört niemandem und löst nirgends auf.
    expect(FAKECAM_FOREIGN_TEXT).toMatch(/^https:\/\/[a-z0-9-]+\.invalid\/[a-z-]+$/);
    expect(FAKECAM_FOREIGN_TEXT.startsWith('MB1.')).toBe(false);
  });

  it('bekommt eigene Datei und eigene Maße – sonst beschneidet Chromium das Bild', () => {
    // Dateimaße = angeforderte Maße: die Lobby-Kamera verlangt `width/height: { ideal: 1280/720 }`.
    // Mit einem 4:3-Bild schnitte Chromium oben und unten ab – mitten durch den Code.
    expect(FAKECAM_FOREIGN_SIZE).toEqual({ width: 1280, height: 720 });
    expect(FAKECAM_FOREIGN_Y4M_PATH).toBe('test-results/fakecam/foreign-1280x720.y4m');
    expect(FAKECAM_FOREIGN_Y4M_PATH).not.toBe(FAKECAM_Y4M_PATH);
  });

  it('wird mit demselben Generator geschrieben und hat große, sichere Module', () => {
    const foreign = join(dir, 'fremd.y4m');
    const result = writeQrY4m({ text: FAKECAM_FOREIGN_TEXT, ...FAKECAM_FOREIGN_SIZE, path: foreign });
    const header = `YUV4MPEG2 W${FAKECAM_FOREIGN_SIZE.width} H${FAKECAM_FOREIGN_SIZE.height} F30:1 Ip A1:1 C420mpeg2`;
    expect(readFileSync(foreign).subarray(0, header.length).toString('ascii')).toBe(header);
    expect(result.bytes).toBe(header.length + 1 + FRAME_TAG.length + (FAKECAM_FOREIGN_SIZE.width * FAKECAM_FOREIGN_SIZE.height * 3) / 2);
    expect(statSync(foreign).size).toBe(result.bytes);
    // Ein kurzer Text ergibt wenige Module: viel Platz je Modul, also ein Scan ohne Wackelkontakt.
    expect(result.moduleSize).toBeGreaterThanOrEqual(10);
  });
});

describe('Nebenwirkungsfreiheit', () => {
  it('legt beim bloßen Import von qrY4m.mjs und playwright.config.ts keine Datei an', async () => {
    const target = resolve(FAKECAM_Y4M_PATH);
    const before = existsSync(target) ? statSync(target).mtimeMs : null;
    // Ohne resetModules lieferte der Import nur den Cache – der Test wäre blind.
    vi.resetModules();
    await import('../../scripts/lib/qrY4m.mjs');
    await import('../../playwright.config');
    const after = existsSync(target) ? statSync(target).mtimeMs : null;
    expect(after).toBe(before);
  });
});
