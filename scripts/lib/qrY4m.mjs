// Erzeugt das Standbild für Chromes Fake-Kamera (`--use-file-for-fake-video-capture`): ein einziges
// I420-Bild im YUV4MPEG2-Format mit einem QR-Code darin. Chromium wiederholt die Datei in Schleife,
// ein Bild genügt. Reines Node, einzige Abhängigkeit ist `qrcode`.
//
// Dieses Modul SCHREIBT BEIM IMPORT NICHTS – geschrieben wird allein in tests/e2e/globalSetup.ts.
// Grund: `playwright.config.ts` importiert die Konstanten hier, und `playwright test --list` oder ein
// Unit-Test dürfen keine 460-kB-Datei hinterlassen.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import QRCode from 'qrcode';

/** Relativ zum Repo-Wurzelverzeichnis; `test-results/` ist git-ignoriert (460 kB, nie committen). */
export const FAKECAM_Y4M_PATH = 'test-results/fakecam/qr-640x480.y4m';

/**
 * Dateimaße = angeforderte Maße. Passt das Seitenverhältnis der Datei nicht zur angeforderten
 * Auflösung, beschneidet und dreht Chromium das Bild – der Code wäre dann unbemerkt unlesbar.
 */
export const FAKECAM_SIZE = { width: 640, height: 480 };

/**
 * Zweites Bild für den FREMDEN Code (`qr:skipped`): ein Ziel aus dem reservierten Bereich `.invalid`
 * (RFC 2606). Es gehört niemandem, löst nirgends auf und ist erkennbar kein `MB1.`-Payload.
 */
export const FAKECAM_FOREIGN_TEXT = 'https://example.invalid/kein-maeusebau-code';

/** Eigene Datei, eigenes Playwright-Projekt: das Kamera-Flag gilt je Browser-Start. */
export const FAKECAM_FOREIGN_Y4M_PATH = 'test-results/fakecam/foreign-1280x720.y4m';

/**
 * Andere Maße als oben, mit Absicht: diesen Code sieht die LOBBY-Kamera, und die fordert
 * `width/height: { ideal: 1280/720 }` an (src/lab/camera.ts) statt `video: true`. Ein 4:3-Bild
 * beschnitte Chromium auf 16:9 – mitten durch den Code. Dateimaße = angeforderte Maße.
 */
export const FAKECAM_FOREIGN_SIZE = { width: 1280, height: 720 };

/** I420 nach BT.601 „studio swing": 16 = Schwarz, 235 = Weiß, 128 = farblos. */
const DARK = 16;
const LIGHT = 235;
const NEUTRAL_CHROMA = 128;
/** Ruhezone in Modulen – die Vorgabe von `qrcode` und das Minimum der QR-Norm. */
const QUIET_MODULES = 4;

const PAYLOAD_PREFIX = 'MB1.p.';

/**
 * Kandidaten-Zeilen wie in `SessionDesc.candidates`, aber ausschließlich aus den
 * Dokumentationsbereichen RFC 5737 (IPv4-TEST-NET-1/2/3) und RFC 3849 (2001:db8::/32).
 * Sie gehören keinem Gerät – das Repo ist öffentlich.
 * @param {number} index
 */
function candidateLine(index) {
  const addresses = ['192.0.2.10', '198.51.100.20', '203.0.113.30', '2001:db8::10'];
  const address = addresses[index % addresses.length];
  return `${2000000000 + index} 1 udp ${2122260223 - index} ${address} ${50000 + index} typ host generation 0`;
}

/** 32 Bytes, deterministisch – ein Fingerabdruck-Platzhalter, kein echter Schlüssel. */
const FAKE_FINGERPRINT = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 0xff)).toString('base64url');

/**
 * Wie viele Bytes ergeben genau `chars` base64url-Zeichen (ohne Polsterung)?
 * Längen mit Rest 1 (mod 4) sind unerreichbar – base64url wächst in Schritten von 4, 2 oder 3 Zeichen.
 * @param {number} chars
 */
function bytesForBase64urlLength(chars) {
  const rest = chars % 4;
  if (rest === 1) {
    throw new RangeError(`base64url kann keine Länge von ${chars} Zeichen treffen (Rest 1 mod 4)`);
  }
  return Math.floor(chars / 4) * 3 + (rest === 0 ? 0 : rest - 1);
}

/**
 * Synthetischer Payload-Text der Länge `chars` im Format des Text-Pfads (`MB1.p.<base64url>`).
 * Zur Laufzeit gebaut: ein 1100-Zeichen-Payload steht nie wörtlich im Repo.
 * @param {number} [chars]
 * @returns {string}
 */
export function fakecamQrText(chars = 1100) {
  if (!Number.isInteger(chars) || chars <= PAYLOAD_PREFIX.length) {
    throw new RangeError(`fakecamQrText: ${chars} ist keine brauchbare Zeichenzahl`);
  }
  const wanted = bytesForBase64urlLength(chars - PAYLOAD_PREFIX.length);
  const candidates = [];
  /** @param {string} padding */
  const build = (padding) =>
    JSON.stringify({
      v: 1,
      p: 1,
      r: 'o',
      s: 1,
      n: 20260924,
      u: 'MBFAKE',
      w: 'MBFAKEPASSWORDMBFAKEPASS',
      f: FAKE_FINGERPRINT,
      t: 'x',
      k: 5000,
      m: 262144,
      c: candidates,
      x: padding,
    });
  const smallest = Buffer.byteLength(build(''), 'utf8');
  if (smallest > wanted) {
    throw new RangeError(`fakecamQrText: ${chars} Zeichen sind zu wenig für das Payload-Gerüst`);
  }
  // So viele echte Kandidaten-Zeilen wie hineinpassen; der Rest ist reine Füllung. Das hält den
  // Text nah an einem echten Payload, ohne die Ziel-Länge zu verfehlen.
  for (let index = 0; index < 32; index += 1) {
    candidates.push(candidateLine(index));
    if (Buffer.byteLength(build(''), 'utf8') > wanted) {
      candidates.pop();
      break;
    }
  }
  const json = build('A'.repeat(wanted - Buffer.byteLength(build(''), 'utf8')));
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const text = `${PAYLOAD_PREFIX}${body}`;
  if (text.length !== chars) {
    throw new Error(`fakecamQrText: ${text.length} Zeichen statt ${chars} – Längenrechnung stimmt nicht`);
  }
  return text;
}

/**
 * Schreibt EIN I420-Bild mit dem QR-Code von `text` nach `path` und legt fehlende Ordner an.
 * @param {{ text: string, width: number, height: number, path: string }} input
 * @returns {{ path: string, width: number, height: number, modules: number, moduleSize: number, bytes: number }}
 */
export function writeQrY4m({ text, width, height, path }) {
  if (typeof text !== 'string' || text === '') throw new Error('writeQrY4m: text fehlt');
  if (width % 2 !== 0 || height % 2 !== 0 || width <= 0 || height <= 0) {
    throw new Error(`writeQrY4m: ${width}x${height} ist kein gerades, positives Maß (I420 halbiert beide Achsen)`);
  }

  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const modules = qr.modules.size;
  const total = modules + 2 * QUIET_MODULES;
  // Ganzzahlige Modulgröße: ein halbes Modul verwischt beim Skalieren und kostet die Lesbarkeit.
  const moduleSize = Math.floor(Math.min(width, height) / total);
  if (moduleSize < 1) {
    throw new Error(`writeQrY4m: ${total} Module passen nicht in ${width}x${height}`);
  }

  const codePx = total * moduleSize;
  const originX = Math.floor((width - codePx) / 2);
  const originY = Math.floor((height - codePx) / 2);

  const yPlane = Buffer.alloc(width * height, LIGHT);
  for (let my = 0; my < modules; my += 1) {
    for (let mx = 0; mx < modules; mx += 1) {
      if (qr.modules.data[my * modules + mx] !== 1) continue;
      const left = originX + (QUIET_MODULES + mx) * moduleSize;
      const top = originY + (QUIET_MODULES + my) * moduleSize;
      for (let row = 0; row < moduleSize; row += 1) {
        const start = (top + row) * width + left;
        yPlane.fill(DARK, start, start + moduleSize);
      }
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2), NEUTRAL_CHROMA);

  const file = resolve(path);
  const bytes = Buffer.concat([
    Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420mpeg2\n`, 'ascii'),
    Buffer.from('FRAME\n', 'ascii'),
    yPlane,
    chroma,
    chroma,
  ]);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return { path: file, width, height, modules, moduleSize, bytes: bytes.length };
}
