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
  /** Prüft den gescannten Text, bevor er zählt: decodeDesc-Erfolg; false → qr:skipped/not-a-payload, weiterscannen. */
  looksLikePayload(text: string): Promise<boolean>;
  onQrFacts(facts: QrFacts): void;
}

/**
 * „Genau ein Scan zur Zeit" über alle QR-Blöcke eines Seitenaufrufs. Der Host hat drei Plätze, die
 * sich EINE Kamera teilen: liefen zwei Schleifen nebeneinander, entschiede der Zufall, welcher Platz
 * die Antwort des anderen dekodiert – der falsche bekäme ein Nonce-F5 und käme nicht mehr weiter.
 * Rein und DOM-frei gehalten, damit genau diese Regel ohne Browser prüfbar bleibt.
 */
export interface ScanCoordinator<T> {
  /** Meldet ein Mitglied an; die Rückgabe meldet es wieder ab (Platz freigegeben, `dispose`). */
  add(member: T): () => void;
  /** Macht `member` zum einzigen Aktiven: jedes ANDERE angemeldete Mitglied wird abgebrochen. */
  activate(member: T, stop: (other: T) => void): void;
  /** Für jedes angemeldete Mitglied, in der Reihenfolge der Anmeldung. */
  forEach(act: (member: T) => void): void;
}

export function createScanCoordinator<T>(): ScanCoordinator<T> {
  const members = new Set<T>();
  return {
    add(member) {
      members.add(member);
      return () => { members.delete(member); };
    },
    activate(member, stop) {
      // Kopie: `stop` bricht einen Scan ab, und ein Abbruch darf sich abmelden dürfen.
      for (const other of [...members]) if (other !== member) stop(other);
    },
    forEach(act) {
      for (const member of [...members]) act(member);
    },
  };
}

/** Ein lebender QR-Block aus Sicht des Koordinators – mehr braucht er von ihm nicht zu wissen. */
interface LiveExchange {
  /** Bricht eine laufende Scan-Schleife ab. */
  stop(): void;
  /** Hängt den (neuen) Kamera-Stream wieder in den eigenen Sucher. */
  reattach(): void;
}

const liveExchanges = createScanCoordinator<LiveExchange>();

/**
 * Nach einem Kamera-Neustart: jeder lebende Sucher braucht den NEUEN Stream. Ohne das zeigte ein
 * anderer Platz weiter das eingefrorene Bild des alten und scannte ins Leere. Ruft die Kamera-Karte
 * (labUi) genauso auf wie der Neustart-Knopf im QR-Block.
 */
export function reattachLiveExchanges(): void {
  liveExchanges.forEach((exchange) => { exchange.reattach(); });
}

/**
 * Wie viele QR-Blöcke gerade leben. Nur für den Test-Haken: ein freigegebener Platz, dessen
 * `createOffer` noch lief, darf keinen zweiten Block hinterlassen – der überholte sonst jeden Scan
 * des echten Platzes. Nach außen geht damit eine ANZAHL, nie ein Block oder ein Payload.
 */
export function liveExchangeCount(): number {
  let count = 0;
  liveExchanges.forEach(() => { count += 1; });
  return count;
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

  const live: LiveExchange = {
    stop: () => {
      // Nur ein wirklich laufender Scan wird überholt – sonst überschriebe die Meldung ein „Code
      // erkannt ✓" eines längst fertigen Platzes.
      if (running === null) return;
      cancel();
      status.textContent = S.lab.qr.overtaken;
    },
    // Nur ein Block, der gerade scannt, zeigt überhaupt ein Video – die anderen haben nichts anzuhängen.
    reattach: () => { if (!video.hidden) attachCamera(video); },
  };
  const unregister = liveExchanges.add(live);

  /**
   * Seitenwechsel und Sperrbildschirm: eine Scan-Schleife im Hintergrund bekommt keine Bilder mehr
   * (Chromium hält `requestVideoFrameCallback` in einem verborgenen Tab an) und liefe nur stumm in
   * die 60-s-Frist. Abbrechen – der Aufrufer bietet danach „Erneut scannen" an.
   */
  const onVisibility = (): void => { if (document.visibilityState === 'hidden') cancel(); };
  const onPagehide = (): void => { cancel(); };
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('pagehide', onPagehide);

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
      // Der Neustart liefert einen NEUEN Stream: jeder lebende Sucher braucht ihn, auch der eines
      // anderen Platzes – sonst hinge der am toten alten.
      if (camera.running) reattachLiveExchanges();
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
    // Genau EIN Scan je Seitenaufruf: alle Plätze teilen sich eine Kamera (siehe createScanCoordinator).
    liveExchanges.activate(live, (other) => { other.stop(); });
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
        // nur bis zur gemeinsamen Frist – sonst hinge der Scan an einem Plakat für immer. Der
        // Eintrag heißt deshalb `qr:skipped` und NIE `qr:error` (D7): sonst trüge jeder Lauf in
        // einem Raum mit Werbeplakat ein F9, das über das Labor gar nichts aussagt.
        if (!(await deps.looksLikePayload(result.text))) {
          deps.timeline.push('qr:skipped', 'not-a-payload');
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
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('pagehide', onPagehide);
      unregister();
      cancel();
      overlay.dispose();
      element.remove();
    },
  };
}
