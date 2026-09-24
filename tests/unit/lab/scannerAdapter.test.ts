import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarcodeDetectorCtor } from '../../../src/lab/scannerAdapter';

// `qr-scanner` ist eine Browser-Bibliothek (Worker, Canvas) – im Node-Umfeld von Vitest steht sie
// als Attrappe da. Geprüft wird unser Adapter: Backend-Wahl, ImageData-Umweg, Engine-Wiederverwendung
// und die eigene Videoschleife. Was die Bibliothek intern tut, ist ihre Sache.
const qrScanner = vi.hoisted(() => ({ scanImage: vi.fn(), createQrEngine: vi.fn() }));
vi.mock('qr-scanner', () => ({ default: qrScanner }));

type Adapter = typeof import('../../../src/lab/scannerAdapter');

/** Frisches Modul je Test: `detectScanBackend` und die Engine merken sich ihr Ergebnis absichtlich. */
let adapter: Adapter;

const NO_CODE = 'No QR code found';
const ENGINE = { fake: 'engine' };

beforeEach(async () => {
  vi.resetModules();
  qrScanner.scanImage.mockReset();
  qrScanner.createQrEngine.mockReset();
  qrScanner.createQrEngine.mockResolvedValue(ENGINE);
  adapter = await import('../../../src/lab/scannerAdapter');
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Attrappe des nativen Konstruktors. `formats: null` bedeutet „ohne statisches getSupportedFormats" –
 * genau der Fall, in dem auch die Bibliothek selbst auf den Worker ausweicht.
 */
function fakeCtor(options: { formats: string[] | null; detect?: () => Promise<{ rawValue: string }[]> }): BarcodeDetectorCtor {
  class FakeDetector {
    detect(): Promise<{ rawValue: string }[]> {
      return (options.detect ?? (() => Promise.resolve([])))();
    }
  }
  if (options.formats !== null) {
    const formats = options.formats;
    (FakeDetector as unknown as { getSupportedFormats: () => Promise<string[]> }).getSupportedFormats = () => Promise.resolve(formats);
  }
  return FakeDetector as unknown as BarcodeDetectorCtor;
}

describe('chooseScanBackend', () => {
  it('ohne Konstruktor → worker (Windows, Linux-CI und jedes Firefox)', async () => {
    const probeSource = vi.fn();
    await expect(adapter.chooseScanBackend({ ctor: undefined, probeSource })).resolves.toBe('worker');
    // Die Probe-Quelle wird erst gebaut, wenn sie gebraucht wird – sonst bräuchte schon die
    // Backend-Frage ein DOM (dieser Test läuft in Node).
    expect(probeSource).not.toHaveBeenCalled();
  });

  it('ohne statisches getSupportedFormats → worker', async () => {
    await expect(adapter.chooseScanBackend({ ctor: fakeCtor({ formats: null }), probeSource: () => ({}) })).resolves.toBe('worker');
  });

  it('getSupportedFormats liefert eine leere Liste → worker', async () => {
    await expect(adapter.chooseScanBackend({ ctor: fakeCtor({ formats: [] }), probeSource: () => ({}) })).resolves.toBe('worker');
  });

  it('getSupportedFormats ohne qr_code → worker', async () => {
    const ctor = fakeCtor({ formats: ['ean_13', 'code_128'] });
    await expect(adapter.chooseScanBackend({ ctor, probeSource: () => ({}) })).resolves.toBe('worker');
  });

  it('detect() wirft bei der Probe → worker (den Fall fängt die Bibliothek NICHT ab)', async () => {
    const ctor = fakeCtor({ formats: ['qr_code'], detect: () => Promise.reject(new Error('NotSupportedError')) });
    await expect(adapter.chooseScanBackend({ ctor, probeSource: () => ({}) })).resolves.toBe('worker');
  });

  it('getSupportedFormats wirft → worker', async () => {
    const ctor = fakeCtor({ formats: [] });
    (ctor as unknown as { getSupportedFormats: () => Promise<string[]> }).getSupportedFormats = () => Promise.reject(new Error('kaputt'));
    await expect(adapter.chooseScanBackend({ ctor, probeSource: () => ({}) })).resolves.toBe('worker');
  });

  it('Konstruktor in Ordnung, qr_code dabei, Probe löst auf → native', async () => {
    const probeSource = vi.fn(() => ({ probe: true }));
    const ctor = fakeCtor({ formats: ['qr_code', 'ean_13'] });
    await expect(adapter.chooseScanBackend({ ctor, probeSource })).resolves.toBe('native');
    expect(probeSource).toHaveBeenCalledTimes(1);
  });
});

describe('scanImage', () => {
  const canvasLike = { width: 8, height: 8 } as unknown as HTMLCanvasElement;

  it('gibt Text, Backend und genau einen Versuch zurück', async () => {
    qrScanner.scanImage.mockResolvedValue({ data: 'MB1.p.ABC', cornerPoints: [] });
    const result = await adapter.scanImage(canvasLike);
    expect(result).toMatchObject({ text: 'MB1.p.ABC', backend: 'worker', attempts: 1 });
    expect(result?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('kein Code gefunden ist KEIN Fehler, sondern null', async () => {
    qrScanner.scanImage.mockRejectedValue(new Error(NO_CODE));
    await expect(adapter.scanImage(canvasLike)).resolves.toBeNull();
  });

  it('benutzt EINE wiederverwendete Engine, keinen scanRegion und die neue Ergebnisform', async () => {
    qrScanner.scanImage.mockResolvedValue({ data: 'MB1.p.ABC', cornerPoints: [] });
    await adapter.scanImage(canvasLike);
    await adapter.scanImage(canvasLike);
    // Ohne `qrEngine` startet und schließt `scanImage` bei JEDEM Aufruf einen Worker (Faktenblatt).
    expect(qrScanner.createQrEngine).toHaveBeenCalledTimes(1);
    expect(qrScanner.scanImage).toHaveBeenCalledTimes(2);
    const options = qrScanner.scanImage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(options).toEqual({ qrEngine: ENGINE, returnDetailedScanResult: true });
    expect(options).not.toHaveProperty('scanRegion');
  });

  /** Probe-Quelle von `detectScanBackend`: ein 2×2-Canvas – im Node-Test reicht ein leeres Objekt. */
  function stubBrowser(ctor: BarcodeDetectorCtor): void {
    vi.stubGlobal('BarcodeDetector', ctor);
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0 }) });
  }

  it('nativer Pfad: dekodiert unser BarcodeDetector, ist das Backend „native" – ohne Worker', async () => {
    stubBrowser(fakeCtor({ formats: ['qr_code'], detect: () => Promise.resolve([{ rawValue: 'MB1.p.NATIV' }]) }));
    try {
      await expect(adapter.scanImage(canvasLike)).resolves.toMatchObject({ text: 'MB1.p.NATIV', backend: 'native', attempts: 1 });
      expect(qrScanner.scanImage).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('nativer Pfad ohne Fund heißt „kein Code im Bild" – kein zweiter Durchlauf über den Worker', async () => {
    stubBrowser(fakeCtor({ formats: ['qr_code'], detect: () => Promise.resolve([]) }));
    try {
      await expect(adapter.scanImage(canvasLike)).resolves.toBeNull();
      // Sonst kostete JEDES leere Videobild auf Android zusätzlich einen Worker-Durchlauf.
      expect(qrScanner.scanImage).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('wirft detect() erst im Betrieb (Plattformfehler), übernimmt der Worker', async () => {
    let calls = 0;
    stubBrowser(
      fakeCtor({
        formats: ['qr_code'],
        // Die Probe gelingt, der erste echte Aufruf wirft – genau der macOS-Ventura-Fall.
        detect: () => (++calls === 1 ? Promise.resolve([]) : Promise.reject(new Error('NotSupportedError'))),
      }),
    );
    try {
      qrScanner.scanImage.mockResolvedValue({ data: 'MB1.p.WORKER', cornerPoints: [] });
      await expect(adapter.scanImage(canvasLike)).resolves.toMatchObject({ text: 'MB1.p.WORKER', backend: 'worker' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ein im Betrieb werfendes detect() stuft die Seite EINMAL herab – kein neuer Detektor je Bild', async () => {
    let constructions = 0;
    let calls = 0;
    class FlakyDetector {
      constructor() {
        constructions += 1;
      }

      detect(): Promise<{ rawValue: string }[]> {
        // Die Probe gelingt, jeder echte Aufruf wirft – der macOS-Ventura-Fall.
        return ++calls === 1 ? Promise.resolve([]) : Promise.reject(new Error('NotSupportedError'));
      }
    }
    (FlakyDetector as unknown as { getSupportedFormats: () => Promise<string[]> }).getSupportedFormats = () => Promise.resolve(['qr_code']);
    stubBrowser(FlakyDetector as unknown as BarcodeDetectorCtor);
    try {
      qrScanner.scanImage.mockResolvedValue({ data: 'MB1.p.WORKER', cornerPoints: [] });
      await expect(adapter.scanImage(canvasLike)).resolves.toMatchObject({ backend: 'worker' });
      const afterFirst = constructions;
      await expect(adapter.scanImage(canvasLike)).resolves.toMatchObject({ backend: 'worker' });
      // Ohne die Merkung baute JEDES Videobild einen neuen BarcodeDetector und liefe in denselben
      // Fehler – bei 10 Bildern/s zehnmal je Sekunde.
      expect(constructions).toBe(afterFirst);
      expect(calls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lässt sich die Engine nicht erzeugen, ist das ein ScanError „camera-error" – kein roher Fehler', async () => {
    qrScanner.createQrEngine.mockRejectedValue(new Error('kein Worker'));
    // Die Oberfläche verzweigt über `reason`, nie über Fehlertexte der Bibliothek.
    await expect(adapter.scanImage(canvasLike)).rejects.toMatchObject({ name: 'ScanError', reason: 'camera-error' });
  });

  it('zeichnet ImageData zuerst auf ein Canvas (die Bibliothek lehnt ImageData ab)', async () => {
    const putImageData = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ putImageData }) };
    const created: string[] = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        created.push(tag);
        return canvas;
      },
    });
    try {
      const imageData = { data: new Uint8ClampedArray(4 * 6 * 5), width: 6, height: 5 } as unknown as ImageData;
      qrScanner.scanImage.mockResolvedValue({ data: 'MB1.p.ABC', cornerPoints: [] });
      await expect(adapter.scanImage(imageData)).resolves.toMatchObject({ text: 'MB1.p.ABC', backend: 'worker' });
      expect(created).toEqual(['canvas']);
      expect(putImageData).toHaveBeenCalledWith(imageData, 0, 0);
      expect(canvas).toMatchObject({ width: 6, height: 5 });
      // An die Bibliothek geht das Canvas, nie das ImageData.
      expect(qrScanner.scanImage.mock.calls[0]?.[0]).toBe(canvas);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('scanVideo', () => {
  /** Videoquelle mit Bildfolge: jedes „Bild" kommt über den gefälschten Zeitgeber, nie über echte Zeit. */
  const FRAME_MS = 16;
  function fakeVideo(): HTMLVideoElement {
    return {
      requestVideoFrameCallback: (callback: () => void) => setTimeout(callback, FRAME_MS) as unknown as number,
      // Echte Videoelemente können ein angefordertes Bild wieder abbestellen – die Attrappe auch,
      // sonst bliebe genau der Rückruf ungeprüft, den `stop()` abräumen muss.
      cancelVideoFrameCallback: (handle: number) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
    } as unknown as HTMLVideoElement;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  });

  it('zählt jeden Versuch; das erste dekodierte Bild gewinnt', async () => {
    qrScanner.scanImage
      .mockRejectedValueOnce(new Error(NO_CODE))
      .mockRejectedValueOnce(new Error(NO_CODE))
      .mockResolvedValue({ data: 'MB1.p.TREFFER', cornerPoints: [] });
    const attempts: number[] = [];
    const promise = adapter.scanVideo(fakeVideo(), {
      signal: new AbortController().signal,
      maxPerSecond: 10,
      timeoutMs: 5_000,
      onAttempt: (attempt) => attempts.push(attempt),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toMatchObject({ text: 'MB1.p.TREFFER', backend: 'worker', attempts: 3 });
    expect(attempts).toEqual([1, 2, 3]);
    // 3 Bilder à 16 ms plus zwei Drosselpausen à 100 ms.
    await expect(promise).resolves.toMatchObject({ latencyMs: 248 });
    // Nach dem Treffer ist die Schleife wirklich aus: keine Frist-Uhr, keine Drosselpause, kein Bild.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Abbruch räumt das schon angeforderte Bild ab (sonst feuert es ins Leere)', async () => {
    qrScanner.scanImage.mockRejectedValue(new Error(NO_CODE));
    const controller = new AbortController();
    const promise = adapter.scanVideo(fakeVideo(), { signal: controller.signal, timeoutMs: 5_000 });
    // 120 ms: die Drosselpause ist abgelaufen, das nächste Bild ist ANGEFORDERT, aber noch nicht da.
    await vi.advanceTimersByTimeAsync(120);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ reason: 'aborted' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Zeitüberschreitung räumt die laufende Drosselpause ab', async () => {
    qrScanner.scanImage.mockRejectedValue(new Error(NO_CODE));
    const promise = adapter.scanVideo(fakeVideo(), { signal: new AbortController().signal, timeoutMs: 500 });
    const rejected = expect(promise).rejects.toMatchObject({ reason: 'scan-timeout' });
    // Die Frist fällt mitten in eine Drosselpause (Versuche bei 16/132/248/364/480 ms, Pause bis 580).
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drosselt auf maxPerSecond: in einer Sekunde höchstens so viele Versuche', async () => {
    qrScanner.scanImage.mockRejectedValue(new Error(NO_CODE));
    const attempts: number[] = [];
    const promise = adapter.scanVideo(fakeVideo(), {
      signal: new AbortController().signal,
      maxPerSecond: 5,
      timeoutMs: 1_000,
      onAttempt: (attempt) => attempts.push(attempt),
    });
    // Die Erwartung VOR dem Vorstellen der Uhr anhängen: sonst liegt die Ablehnung einen Tick lang
    // unbehandelt da und Node meldet eine „Unhandled Rejection", obwohl der Test sie erwartet.
    const rejected = expect(promise).rejects.toMatchObject({ name: 'ScanError', reason: 'scan-timeout' });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(attempts.length).toBeLessThanOrEqual(5);
    expect(attempts.length).toBeGreaterThan(0);
  });

  it('ohne Treffer bis zur Frist → ScanError „scan-timeout"', async () => {
    qrScanner.scanImage.mockRejectedValue(new Error(NO_CODE));
    const promise = adapter.scanVideo(fakeVideo(), { signal: new AbortController().signal, timeoutMs: 500 });
    const rejected = expect(promise).rejects.toBeInstanceOf(adapter.ScanError);
    await vi.advanceTimersByTimeAsync(600);
    await rejected;
    await expect(promise).rejects.toMatchObject({ reason: 'scan-timeout' });
  });

  it('Abbruch während des Laufs → ScanError „aborted"', async () => {
    qrScanner.scanImage.mockRejectedValue(new Error(NO_CODE));
    const controller = new AbortController();
    const promise = adapter.scanVideo(fakeVideo(), { signal: controller.signal, timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(300);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ reason: 'aborted' });
  });

  it('schon abgebrochenes Signal → sofort „aborted", ohne einen einzigen Versuch', async () => {
    const controller = new AbortController();
    controller.abort();
    const onAttempt = vi.fn();
    await expect(adapter.scanVideo(fakeVideo(), { signal: controller.signal, onAttempt })).rejects.toMatchObject({ reason: 'aborted' });
    expect(onAttempt).not.toHaveBeenCalled();
    expect(qrScanner.scanImage).not.toHaveBeenCalled();
  });

  it('Engine lässt sich nicht erzeugen → ScanError „camera-error"', async () => {
    qrScanner.createQrEngine.mockRejectedValue(new Error('kein Worker'));
    const promise = adapter.scanVideo(fakeVideo(), { signal: new AbortController().signal, timeoutMs: 5_000 });
    const rejected = expect(promise).rejects.toMatchObject({ reason: 'camera-error' });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
  });
});
