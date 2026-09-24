import QRCode from 'qrcode';
import { S } from '../ui/strings';

/**
 * Eigener Deckel des QR-Pfads (die Codec-Grenze MAX_PAYLOAD_TEXT_CHARS = 4096 gilt weiter für den
 * Text-Pfad): 1100 base64url-Zeichen sind bei ECC M Version 27 / 125 Module, mit Ruhezone 133 –
 * auf einem 390-CSS-px-Telefon knapp unter 3 CSS px je Modul. Darüber wird der Scan unzuverlässig.
 */
export const MAX_QR_PAYLOAD_CHARS = 1100;

export interface QrRenderOptions {
  /** verfügbare CSS-Breite; Vorgabe: canvas.clientWidth, sonst 320 */
  cssWidth?: number;
  /** Vorgabe: globalThis.devicePixelRatio ?? 1 */
  devicePixelRatio?: number;
  /** Untergrenze in GERÄTEpixeln, Vorgabe 2 (R13); Ziel ist ≥ 3 */
  minModulePx?: number;
}

export interface QrRenderResult {
  chars: number;
  modules: number;
  totalModules: number;
  canvasPx: number;
  modulePx: number;
}

export class QrTooLargeError extends Error {
  readonly chars: number;

  constructor(chars: number) {
    super(`QR payload too large: ${chars} > ${MAX_QR_PAYLOAD_CHARS}`);
    this.name = 'QrTooLargeError';
    this.chars = chars;
  }
}

/** Ruhezone in Modulen – die Vorgabe von `qrcode` und das Minimum der QR-Norm. Nie kleiner. */
const QUIET_MODULES = 4;
const DEFAULT_CSS_WIDTH = 320;
/**
 * Untergrenze in GERÄTEpixeln. 2 statt 3 (R13): bei 1100 Zeichen sind es 133 Module, auf einem
 * 390-CSS-px-Telefon also 2,93 CSS px je Modul. Mit 3 wäre das Canvas breiter als die Spalte und
 * müsste heruntergerechnet werden – dabei verwischen genau die halben Module, die die ganzzahlige
 * Rechnung vermeiden soll. Zum Scannen ist die Vollbild-Lupe gedacht (≥ 90 % von min(vw, vh)).
 */
const DEFAULT_MIN_MODULE_PX = 2;
/** Immer Schwarz auf Weiß, unabhängig vom dunklen Seiten-Thema – ein invertierter Code wird schlechter erkannt. */
const DARK = '#000000';
const LIGHT = '#ffffff';
/** Notnagel, falls innerWidth/innerHeight beim Öffnen noch 0 sind (Layout läuft noch). */
const OVERLAY_MIN_CSS = 320;

/** Kantenlänge des Codes in Modulen (ohne Ruhezone) – für Tests, den Größen-Sweep und die Zeitleiste. */
export function qrModuleCount(text: string): number {
  return QRCode.create(text, { errorCorrectionLevel: 'M' }).modules.size;
}

/**
 * Zeichnet den Code SYNCHRON selbst (statt `QRCode.toCanvas`), weil nur so die Canvas-Breite ein
 * ganzzahliges Vielfaches der Modulzahl wird: beim Hochskalieren verwischen sonst halbe Module und
 * die Kamera der Gegenstelle verfehlt große Codes.
 */
export function renderQr(canvas: HTMLCanvasElement, text: string, options: QrRenderOptions = {}): QrRenderResult {
  if (text.length > MAX_QR_PAYLOAD_CHARS) throw new QrTooLargeError(text.length);
  // Leerer Text ist ein Programmierfehler des Aufrufers; `qrcode` meldet ihn als `No input text`.
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const modules = qr.modules.size;
  const totalModules = modules + 2 * QUIET_MODULES;
  const cssWidth = options.cssWidth ?? (canvas.clientWidth > 0 ? canvas.clientWidth : DEFAULT_CSS_WIDTH);
  const ratio = options.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
  const minModulePx = options.minModulePx ?? DEFAULT_MIN_MODULE_PX;
  // Ganzzahlige Modulgröße in GERÄTEpixeln. Solange die Untergrenze nicht greift, ist canvasPx nie
  // breiter als cssWidth*ratio – kein Herunterskalieren, keine halben Module (R13). Greift sie doch
  // (Spalte < ~266 CSS px), fängt `max-width: 100%` in qr.css den Überstand ab; zum Scannen dient dann
  // die Vollbild-Lupe.
  const modulePx = Math.max(minModulePx, Math.floor((cssWidth * ratio) / totalModules));
  const canvasPx = totalModules * modulePx;

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas 2D context not available');
  canvas.width = canvasPx;
  canvas.height = canvasPx;
  // Ruhezone mitweißen: der Aufrufer darf das Canvas auf jeden Untergrund setzen.
  context.fillStyle = LIGHT;
  context.fillRect(0, 0, canvasPx, canvasPx);
  context.fillStyle = DARK;
  const data = qr.modules.data;
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (data[row * modules + col] === 1) {
        context.fillRect((col + QUIET_MODULES) * modulePx, (row + QUIET_MODULES) * modulePx, modulePx, modulePx);
      }
    }
  }
  return { chars: text.length, modules, totalModules, canvasPx, modulePx };
}

export interface QrOverlay {
  readonly element: HTMLElement;
  /** Vollbild, weißer Grund, Code ≥ 90 % von min(innerWidth, innerHeight). */
  open(text: string): void;
  /** Schließt auch bei Tipp auf die Fläche und bei Escape. */
  close(): void;
  /** Meldet Tastatur-/Zeiger-Zuhörer ab und entfernt das Element. */
  dispose(): void;
}

/**
 * Vollbild-Lupe für einen QR-Code. Der Helligkeits-Hinweis kommt als Text herein, weil der Aufrufer
 * (qrPanels) je nach Rolle einen anderen Satz zeigt; die feste Knopfbeschriftung kommt aus `S`.
 * Hängt sich beim Anlegen an `document.body` und ist anfangs `hidden`.
 */
export function createQrOverlay(brightnessHint: string): QrOverlay {
  const element = document.createElement('div');
  element.className = 'qr-overlay';
  element.dataset.testid = 'qr-overlay';
  element.hidden = true;
  const canvas = document.createElement('canvas');
  canvas.className = 'qr-overlay-code';
  canvas.dataset.testid = 'qr-overlay-code';
  const hint = document.createElement('p');
  hint.className = 'qr-overlay-hint';
  hint.textContent = brightnessHint;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn secondary qr-overlay-close';
  close.dataset.testid = 'qr-overlay-close';
  close.textContent = S.lab.qr.close;
  element.append(canvas, hint, close);

  function hide(): void {
    element.hidden = true;
  }

  // Tipp auf die Fläche schließt – auch auf dem Code selbst: am Handy ist der Knopf unten
  // schwer zu treffen, wenn der Code fast den ganzen Bildschirm füllt.
  element.addEventListener('pointerup', hide);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !element.hidden) hide();
  };
  document.addEventListener('keydown', onKeyDown);
  document.body.append(element);

  return {
    element,
    open(text: string): void {
      // Die Zeichendichte richtet sich nach der kürzeren Bildschirmkante; die ANZEIGEgröße setzt
      // qr.css auf 90 vmin – so ist die 90-%-Zusage unabhängig von der Rundung auf ganze Module.
      const side = Math.max(OVERLAY_MIN_CSS, Math.min(innerWidth, innerHeight));
      renderQr(canvas, text, { cssWidth: side });
      element.hidden = false;
    },
    close: hide,
    dispose(): void {
      element.removeEventListener('pointerup', hide);
      document.removeEventListener('keydown', onKeyDown);
      element.remove();
    },
  };
}
