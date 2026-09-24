import type { Timeline } from '../net/timeline';
import { S, fmt } from '../ui/strings';
import { attachCamera, restartCamera } from './camera';
import { actionButton, h } from './labDom';
import type { PairingTracker } from './pairing';
// Die geteilten Typen kommen aus dem importfreien Leaf-Modul, NIE aus `report.ts`: `createQrExchange`
// hängt am Test-Haken, und `report.ts` zöge über `net/environment` die Vite-Konstante `__BUILD_ID__`
// in den Typgraphen der E2E-Specs (R10/R15, bewacht von tests/node/labHook-graph.test.ts).
import type { QrFacts, ScanBackend } from './labTypes';
import { QrTooLargeError, createQrOverlay, renderQr } from './qrRender';
import { ScanError, detectScanBackend, scanVideo, type ScanErrorReason } from './scannerAdapter';

/**
 * Der QR-Block EINES Platzes: eigenen Code zeigen, den der Gegenstelle scannen, Paarungs-Marken
 * setzen. Der Block liefert genau denselben Payload-Text wie der Text-Pfad – die Signalisierung
 * selbst ändert sich nicht. Knöpfe für „Erneut scannen" und „Auf Text-Pfad wechseln" gehören dem
 * Aufrufer (`connectPanels`), weil nur er weiß, welcher Schritt danach kommt.
 */
export interface QrExchange {
  readonly element: HTMLElement;
  /** Zeigt den eigenen Code als QR (+ Textfeld und Kopieren/Teilen als Rückfall). */
  show(role: 'offer' | 'answer', payload: string): void;
  /** Startet die Scan-Schleife über das Lobby-Video; löst mit dem dekodierten Payload-Text auf. */
  scan(role: 'offer' | 'answer'): Promise<string>;
  /** Bricht eine laufende Scan-Schleife ab (Platz freigeben, Rückfall auf Text, Seitenwechsel). */
  cancel(): void;
  dispose(): void;
}

export interface QrExchangeDeps {
  timeline: Timeline;
  marks: PairingTracker;
  /** Prüft den gescannten Text, bevor er zählt: decodeDesc-Erfolg; false → qr:error/not-a-payload, weiterscannen. */
  looksLikePayload(text: string): Promise<boolean>;
  onQrFacts(facts: QrFacts): void;
}

/** D7: nach einer Minute ohne Treffer ist der Scan vorbei – auch wenn dauernd FREMDE Codes im Bild sind. */
const SCAN_DEADLINE_MS = 60_000;

const SCAN_MESSAGE: Readonly<Record<ScanErrorReason, string>> = {
  'scan-timeout': S.lab.qr.timeout,
  'decode-failed': S.lab.qr.decodeFailed,
  'camera-error': S.lab.qr.cameraError,
  // Abbruch durch den Nutzer (Platz freigegeben, auf Text gewechselt) ist kein Befund und zeigt keinen Text.
  aborted: '',
};

export function createQrExchange(deps: QrExchangeDeps): QrExchange {
  const element = h('div', 'qr-block');
  element.dataset.testid = 'qr-block';
  const caption = h('p', 'lab-label', S.lab.qr.title);
  caption.dataset.testid = 'qr-caption';
  const canvas = h('canvas', 'qr-code');
  canvas.dataset.testid = 'qr-canvas';
  // Der Code steckt in einem Knopf: „tippen zum Vergrößern" muss auch mit der Tastatur gehen.
  const tap = h('button', 'qr-tap');
  tap.type = 'button';
  tap.dataset.testid = 'qr-enlarge';
  tap.setAttribute('aria-label', S.lab.qr.enlarge);
  tap.append(canvas);
  tap.hidden = true;
  const brightness = h('p', 'lab-line', S.lab.qr.brightness);
  brightness.hidden = true;
  const video = h('video', 'qr-video');
  video.dataset.testid = 'qr-video';
  video.hidden = true;
  const status = h('p', 'lab-line');
  status.dataset.testid = 'qr-status';
  const restart = actionButton(S.lab.qr.restartCamera, 'qr-restart-camera', 'secondary');
  restart.hidden = true;
  const hint = h('p', 'lab-line', S.lab.qr.fallbackHint);
  element.append(caption, tap, brightness, video, status, restart, hint);
  const overlay = createQrOverlay(S.lab.qr.brightness);

  /** Bis die Erkennung antwortet, gilt der Worker – Windows und Playwright bleiben ohnehin dabei. */
  let backend: ScanBackend = 'worker';
  /** Wurde der QR-Pfad überhaupt benutzt? Erst dann darf `qr` im Report stehen. */
  let used = false;
  let offerChars = 0;
  let answerChars = 0;
  let decodeLatencyMs = 0;
  /** Zählt JEDEN Versuch über alle Scan-Läufe dieses Platzes – auch die einer Zeitüberschreitung. */
  let attempts = 0;
  let shownText = '';
  let running: AbortController | null = null;

  /**
   * Meldet den Stand nach jedem Ereignis neu; der Aufrufer behält die letzte Meldung. So steht das
   * Backend auch dann im Report, wenn der Nutzer für einen Schritt auf den Text-Pfad ausgewichen ist.
   */
  function emit(): void {
    if (!used) return;
    deps.onQrFacts({ backend, offerChars, answerChars, decodeLatencyMs, attempts });
  }

  // Einmal je Seitenaufruf entschieden (der Adapter merkt sich das Ergebnis); die Zeitleiste hält fest, welches.
  void detectScanBackend().then((chosen) => {
    backend = chosen;
    deps.timeline.push('qr:backend', chosen);
    emit();
  });

  tap.onclick = () => {
    if (shownText !== '') overlay.open(shownText);
  };
  restart.onclick = () => {
    restart.disabled = true;
    void restartCamera().then((camera) => {
      restart.disabled = false;
      restart.hidden = camera.running;
      status.textContent = camera.running ? S.lab.camera.lobbyRunning : fmt(S.lab.camera.lobbyFailed, { reason: camera.error ?? '?' });
    });
  };

  function show(role: 'offer' | 'answer', payload: string): void {
    caption.textContent = role === 'offer' ? S.lab.qr.showOffer : S.lab.qr.showAnswer;
    if (role === 'offer') offerChars = payload.length;
    else answerChars = payload.length;
    used = true;
    try {
      const result = renderQr(canvas, payload);
      shownText = payload;
      tap.hidden = false;
      brightness.hidden = false;
      status.textContent = '';
      deps.timeline.push('qr:shown', `${role} ${result.chars} Zeichen, ${result.modules} Module, ${result.modulePx} px/Modul`);
      deps.marks.mark(role === 'offer' ? 'offerShownAt' : 'answerShownAt');
    } catch (error) {
      shownText = '';
      tap.hidden = true;
      brightness.hidden = true;
      // Der GRUND, nie der Code: Zeitleisten-Details sind Report-Daten und verlassen mit dem Report das Gerät.
      const tooLarge = error instanceof QrTooLargeError;
      deps.timeline.push('qr:error', tooLarge ? 'too-large' : 'decode-failed');
      status.textContent = tooLarge ? S.lab.qr.tooLarge : S.lab.qr.decodeFailed;
    }
    emit();
  }

  /** Schreibt genau EIN `qr:error`, zeigt den passenden Text und reicht den Fehler weiter. */
  function failed(error: unknown): never {
    const reason: ScanErrorReason = error instanceof ScanError ? error.reason : 'decode-failed';
    video.hidden = true;
    if (reason !== 'aborted') {
      deps.timeline.push('qr:error', reason);
      status.textContent = SCAN_MESSAGE[reason];
      restart.hidden = reason !== 'camera-error';
      emit();
    }
    throw error instanceof ScanError ? error : new ScanError(reason, `scan failed: ${String(error)}`);
  }

  async function scan(role: 'offer' | 'answer'): Promise<string> {
    cancel(); // ein zweiter Scan überholt den ersten – sonst liefen zwei Schleifen auf demselben Video
    const controller = new AbortController();
    running = controller;
    used = true;
    caption.textContent = role === 'offer' ? S.lab.qr.scanOffer : S.lab.qr.scanAnswer;
    status.textContent = S.lab.qr.scanning;
    restart.hidden = true;
    try {
      video.hidden = false;
      if (!attachCamera(video)) throw new ScanError('camera-error', 'no lobby camera stream');
      const deadline = Date.now() + SCAN_DEADLINE_MS;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ScanError('scan-timeout', `no payload within ${SCAN_DEADLINE_MS} ms`);
        const result = await scanVideo(video, {
          signal: controller.signal,
          timeoutMs: remaining,
          onAttempt: () => { attempts += 1; },
        });
        // Fremde QR-Codes im Bild (Plakat, Verpackung) sind kein Fehlschlag: weiterscannen, aber
        // nur bis zur gemeinsamen Frist – sonst hinge der Scan an einem Plakat für immer.
        if (!(await deps.looksLikePayload(result.text))) {
          deps.timeline.push('qr:error', 'not-a-payload');
          status.textContent = S.lab.qr.notAPayload;
          continue;
        }
        if (role === 'offer') offerChars = result.text.length;
        else answerChars = result.text.length;
        // Das gemeldete Backend ist das, das WIRKLICH dekodiert hat – nicht nur das erkannte.
        backend = result.backend;
        decodeLatencyMs = result.latencyMs;
        deps.marks.mark(role === 'offer' ? 'offerScannedMs' : 'answerScannedMs');
        deps.timeline.push('qr:decoded', `${result.backend} ${Math.round(result.latencyMs)}ms ${result.attempts}`);
        status.textContent = S.lab.qr.decoded;
        video.hidden = true;
        if (running === controller) running = null;
        emit();
        return result.text;
      }
    } catch (error) {
      if (running === controller) running = null;
      return failed(error);
    }
  }

  function cancel(): void {
    running?.abort();
    running = null;
  }

  return {
    element,
    show,
    scan,
    cancel,
    dispose() {
      cancel();
      overlay.dispose();
      element.remove();
    },
  };
}
