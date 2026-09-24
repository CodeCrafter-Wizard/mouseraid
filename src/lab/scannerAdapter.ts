// QR-Dekodierung des Labors. Zwei Wege: der native `BarcodeDetector` (nur dort, wo er wirklich
// funktioniert) und `qr-scanner` als Rückfall. Von der Bibliothek benutzen wir AUSSCHLIESSLICH die
// beiden statischen Methoden – nie eine `QrScanner`-Instanz: deren `stop()`/`destroy()`/`pause()`
// beenden unseren Dauer-Stream (`track.stop()` + `stream.removeTrack`), und ihr Konstruktor hängt
// einen `visibilitychange`-Zuhörer ein, der genau den Sperrbildschirm-Test killen würde, den M2 misst.
import QrScanner from 'qr-scanner';
import type { ScanBackend } from './labTypes';

/** `backend` ist eine Aussage über UNSEREN Weg: 'native' nur, wenn unser BarcodeDetector dekodiert hat. */
export interface ScanResult {
  text: string;
  backend: ScanBackend;
  latencyMs: number;
  attempts: number;
}

/**
 * `'decode-failed'` erzeugt dieser Adapter bewusst NICHT: hier ist ein misslungener Lesevorgang
 * immer `null` („kein Code im Bild"), sonst bräche eine Scanschleife beim ersten unscharfen Bild ab.
 * Der Grund gehört dem Aufrufer (qrPanels, T4): er setzt ihn für alles, was beim Zeigen oder
 * Auswerten eines Codes schiefgeht und KEIN `ScanError` ist. Deshalb bleibt er im Typ.
 */
export type ScanErrorReason = 'scan-timeout' | 'decode-failed' | 'camera-error' | 'aborted';

/** `message` ist Diagnose-Text; die Oberfläche zeigt Texte aus strings.ts anhand von `reason`. */
export class ScanError extends Error {
  readonly reason: ScanErrorReason;

  constructor(reason: ScanErrorReason, message: string) {
    super(message);
    this.name = 'ScanError';
    this.reason = reason;
  }
}

export interface BarcodeDetectorLike {
  detect(source: unknown): Promise<{ rawValue: string }[]>;
}

export interface BarcodeDetectorCtor {
  new (init: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** `probeSource` wird erst gerufen, wenn wirklich ein Probe-Bild gebraucht wird (sonst bräuchte die Frage ein DOM). */
export interface ScanProbe {
  ctor: BarcodeDetectorCtor | undefined;
  probeSource(): unknown;
}

const QR_FORMAT = 'qr_code';

/**
 * Rein (bis auf den übergebenen Quell-Erzeuger): 'native' nur, wenn der Konstruktor da ist,
 * `getSupportedFormats()` `qr_code` nennt UND ein Probe-`detect()` auflöst. Die dritte Bedingung ist
 * der Grund für diese Funktion: die Bibliothek prüft nur die ersten beiden, ein erst zur Laufzeit
 * werfendes `detect()` (macOS-Ventura-Fehler) fängt sie NICHT ab.
 */
export async function chooseScanBackend(probe: ScanProbe): Promise<ScanBackend> {
  const ctor = probe.ctor;
  if (ctor === undefined || typeof ctor.getSupportedFormats !== 'function') return 'worker';
  try {
    if (!(await ctor.getSupportedFormats()).includes(QR_FORMAT)) return 'worker';
    await new ctor({ formats: [QR_FORMAT] }).detect(probe.probeSource());
    return 'native';
  } catch {
    // Jeder Fehlschlag – fehlender Plattformdienst, werfendes detect(), abgelehnte Zusage – heißt Worker.
    return 'worker';
  }
}

function nativeCtor(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

let backendPromise: Promise<ScanBackend> | null = null;

/**
 * Browser-Hülle um `chooseScanBackend`: entscheidet EINMAL je Seitenaufruf und merkt sich das
 * Ergebnis. Der Aufrufer schreibt es als `qr:backend` in die Zeitleiste.
 */
export function detectScanBackend(): Promise<ScanBackend> {
  backendPromise ??= chooseScanBackend({
    ctor: nativeCtor(),
    probeSource: () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      return canvas;
    },
  });
  return backendPromise;
}

type QrEngine = Awaited<ReturnType<typeof QrScanner.createQrEngine>>;

let enginePromise: Promise<QrEngine> | null = null;

/**
 * EINE Engine je Seitenaufruf. Ohne den `qrEngine`-Parameter startet und schließt `scanImage` bei
 * JEDEM Aufruf einen eigenen Worker – in einer Scanschleife mit 10 Bildern/s wäre das der teuerste
 * Weg, den die Bibliothek anbietet. Ein Fehlschlag löscht die Merkung wieder: sonst bliebe der
 * Scanner nach einem einzigen misslungenen Worker-Start für die ganze Sitzung tot.
 */
function engineFor(): Promise<QrEngine> {
  enginePromise ??= QrScanner.createQrEngine().catch((error: unknown) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

let nativeDetector: BarcodeDetectorLike | null = null;
/**
 * Einmal-Schalter für den Seitenaufruf: wirft `detect()` im Betrieb (Plattformfehler wie der
 * macOS-Ventura-Fall), ist der native Weg erledigt. Ohne diese Merkung baute JEDES Videobild einen
 * neuen `BarcodeDetector` und liefe in denselben Fehler – bei 10 Bildern/s zehnmal je Sekunde.
 */
let nativeBroken = false;

/** `null` = der native Weg hat GEWORFEN; `{ text: null }` = er lief, fand aber keinen Code. */
async function detectNative(source: unknown): Promise<{ text: string | null } | null> {
  if (nativeBroken) return null;
  const ctor = nativeCtor();
  if (ctor === undefined) return null;
  try {
    nativeDetector ??= new ctor({ formats: [QR_FORMAT] });
    const found = await nativeDetector.detect(source);
    return { text: found[0]?.rawValue ?? null };
  } catch {
    nativeBroken = true;
    nativeDetector = null;
    return null;
  }
}

/** Strukturell statt `instanceof ImageData`: so bleibt der Adapter auch ohne DOM-Globale prüfbar. */
function isImageData(source: unknown): source is ImageData {
  return typeof source === 'object' && source !== null && 'data' in source && 'width' in source && 'height' in source;
}

/**
 * `QrScanner.scanImage` lehnt `ImageData` mit „Unsupported image type." ab. Die Zusage der Spec
 * („akzeptiert auch ImageData") lösen wir mit einem Canvas-Umweg ein – gemessen 9–12 ms, gleiches
 * Ergebnis. Wer den Umweg „aufräumt", bricht die Zusage still.
 */
function toScannable(source: HTMLCanvasElement | HTMLVideoElement | ImageData): HTMLCanvasElement | HTMLVideoElement {
  if (!isImageData(source)) return source;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new ScanError('camera-error', 'Canvas ohne 2d-Kontext für ImageData');
  context.putImageData(source, 0, 0);
  return canvas;
}

/**
 * Ein Bild, ein Versuch. `null` heißt „kein Code gefunden" und ist KEIN Fehler – in einer Scanschleife
 * ist das der Normalfall. KEIN `scanRegion`: die Vorgabe der Bibliothek (⅔ der kürzeren Kante, auf
 * 400×400 heruntergerechnet) verfehlt den 1100-Zeichen-Code reproduzierbar.
 */
export async function scanImage(source: HTMLCanvasElement | HTMLVideoElement | ImageData): Promise<ScanResult | null> {
  const startedAt = performance.now();
  const scannable = toScannable(source);
  const since = (): number => Math.round(performance.now() - startedAt);
  if ((await detectScanBackend()) === 'native') {
    const native = await detectNative(scannable);
    // Ein LEERES Ergebnis heißt „kein Code im Bild" – dann wäre ein zweiter Durchlauf über den Worker
    // je Videobild doppelte Arbeit. Nur ein geworfenes detect() (null) gibt an den Worker ab.
    if (native !== null) return native.text === null ? null : { text: native.text, backend: 'native', latencyMs: since(), attempts: 1 };
  }
  let qrEngine: QrEngine;
  try {
    qrEngine = await engineFor();
  } catch (error) {
    // Ein misslungener Worker-Start ist ein Scannerfehler der Oberfläche, kein roher Error: Aufrufer
    // verzweigen über `reason`, nie über die Fehlertexte der Bibliothek.
    throw new ScanError('camera-error', error instanceof Error ? error.message : String(error));
  }
  try {
    const found = await QrScanner.scanImage(scannable, { qrEngine, returnDetailedScanResult: true });
    return { text: found.data, backend: 'worker', latencyMs: since(), attempts: 1 };
  } catch {
    // Die Bibliothek lehnt mit 'No QR code found' ab – für uns ist das eine Antwort, kein Fehler.
    return null;
  }
}

export interface ScanVideoOptions {
  signal: AbortSignal;
  maxPerSecond?: number;
  timeoutMs?: number;
  onAttempt?: (attempt: number) => void;
}

const DEFAULT_MAX_PER_SECOND = 10;
/** D7: 60 s Scan-Frist, danach bietet die Oberfläche „Erneut scannen" oder den Text-Pfad an. */
const DEFAULT_TIMEOUT_MS = 60_000;

interface FrameHost {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

/**
 * Eigene Bildschleife statt der Instanz-Schleife der Bibliothek – so gehören Stream und Abbruch uns.
 * Gibt die Abbestellung zurück: ein angefordertes Bild, das nach dem Ende noch feuert, würde einen
 * weiteren Scan auf einem längst freigegebenen Platz auslösen.
 */
function nextFrame(video: HTMLVideoElement, run: () => void): () => void {
  const host = video as unknown as FrameHost;
  if (typeof host.requestVideoFrameCallback === 'function') {
    const handle = host.requestVideoFrameCallback(run);
    return () => host.cancelVideoFrameCallback?.(handle);
  }
  // Firefox und ältere Safari-Versionen kennen requestVideoFrameCallback nicht.
  const handle = requestAnimationFrame(run);
  return () => cancelAnimationFrame(handle);
}

/**
 * Scannt das laufende Video, bis ein Code auftaucht. Zählt JEDEN Versuch; ein einzelner Fehlversuch
 * ist kein Fehler. Lehnt ab mit `ScanError`: 'aborted' (Signal), 'scan-timeout' (Frist) oder
 * 'camera-error' (der Scanner selbst kam nicht zustande).
 */
export function scanVideo(video: HTMLVideoElement, options: ScanVideoOptions): Promise<ScanResult> {
  const { signal, maxPerSecond = DEFAULT_MAX_PER_SECOND, timeoutMs = DEFAULT_TIMEOUT_MS, onAttempt } = options;
  return new Promise<ScanResult>((resolve, reject) => {
    const startedAt = performance.now();
    const gapMs = Math.max(0, Math.round(1000 / Math.max(1, maxPerSecond)));
    let attempts = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    let gapTimer: ReturnType<typeof setTimeout> | undefined = undefined;
    let cancelFrame: (() => void) | null = null;

    const stop = (): void => {
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      // Drosselpause und angefordertes Bild gehören genauso abgeräumt wie die Frist-Uhr – sonst hält
      // ein beendeter Scan den Zeitgeber der Seite am Leben und scannt einmal ins Leere.
      if (gapTimer !== undefined) clearTimeout(gapTimer);
      cancelFrame?.();
      cancelFrame = null;
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (reason: ScanErrorReason, message: string): void => {
      if (done) return;
      stop();
      reject(new ScanError(reason, message));
    };
    function onAbort(): void {
      fail('aborted', 'Scan abgebrochen');
    }

    if (signal.aborted) {
      reject(new ScanError('aborted', 'Scan abgebrochen'));
      return;
    }
    signal.addEventListener('abort', onAbort);
    timer = setTimeout(() => {
      fail('scan-timeout', `Kein Code innerhalb von ${timeoutMs} ms gefunden`);
    }, timeoutMs);

    const attempt = async (): Promise<void> => {
      if (done) return;
      attempts += 1;
      onAttempt?.(attempts);
      let found: ScanResult | null;
      try {
        found = await scanImage(video);
      } catch (error) {
        fail('camera-error', error instanceof Error ? error.message : String(error));
        return;
      }
      if (done) return;
      if (found !== null) {
        stop();
        resolve({ text: found.text, backend: found.backend, latencyMs: Math.round(performance.now() - startedAt), attempts });
        return;
      }
      // Drosseln: erst nach der Mindestpause das nächste Bild anfordern. Das hält die Schleife auch
      // dann bei maxPerSecond, wenn die Kamera mit 60 Bildern/s liefert.
      gapTimer = setTimeout(() => {
        if (!done) cancelFrame = nextFrame(video, () => void attempt());
      }, gapMs);
    };

    cancelFrame = nextFrame(video, () => void attempt());
  });
}
