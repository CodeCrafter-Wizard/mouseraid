import { createClientJoin, createHostLobby } from '../net/connector';
import { createMessageRouter } from '../net/messageRouter';
import { attachPongResponder, runPingSeries } from '../net/pingTest';
import { PROTOCOL_VERSION } from '../net/protocol';
import { createTimeline } from '../net/timeline';
import { MAX_QR_PAYLOAD_CHARS, qrModuleCount, renderQr } from './qrRender';
import { detectScanBackend, scanImage, scanVideo } from './scannerAdapter';
import { attachCamera, cameraStream, openLobbyCamera, restartCamera } from './camera';
import { createPairingTracker } from './pairing';
import { createQrExchange, liveExchangeCount } from './qrPanels';

/** Test-Haken des Labors: die Netz-Schicht ohne UI, für `tests/e2e/lab-rtc.spec.ts`. */
export interface LabHook {
  createHostLobby: typeof createHostLobby;
  createClientJoin: typeof createClientJoin;
  createMessageRouter: typeof createMessageRouter;
  createTimeline: typeof createTimeline;
  runPingSeries: typeof runPingSeries;
  attachPongResponder: typeof attachPongResponder;
  PROTOCOL_VERSION: number;
  // QR-Pfad ohne Oberfläche: der Roundtrip-Test (tests/e2e/lab-qr-roundtrip.spec.ts) und der
  // Fake-Kamera-Smoke treiben Erzeugung und Scan direkt, ohne durch die Zellen-Oberfläche zu gehen.
  renderQr: typeof renderQr;
  qrModuleCount: typeof qrModuleCount;
  MAX_QR_PAYLOAD_CHARS: number;
  detectScanBackend: typeof detectScanBackend;
  scanImage: typeof scanImage;
  scanVideo: typeof scanVideo;
  // Kamera-zuerst für den Fake-Kamera-Smoke: Stream öffnen, an ein <video> hängen, Stream ansehen.
  openLobbyCamera: typeof openLobbyCamera;
  cameraStream: typeof cameraStream;
  attachCamera: typeof attachCamera;
  /**
   * Ein Neustart, der NICHT über die Kamera-Karte läuft – denselben Weg nimmt der Knopf im QR-Block.
   * Der E2E prüft damit, dass die Karte sich auch dann heilt und die Spuren neu beobachtet.
   */
  restartCamera: typeof restartCamera;
  /**
   * Task 4: der QR-Block ohne den Rest der Oberfläche. Nur so lässt sich im Tor-Spec ein ZU GROSSER
   * Code zeigen – aus echtem Gathering kommt so einer nie heraus, und ohne ihn bliebe der Weg
   * „too-large → Text-Pfad" ungeprüft.
   */
  createQrExchange: typeof createQrExchange;
  createPairingTracker: typeof createPairingTracker;
  /** Anzahl lebender QR-Blöcke – der E2E prüft damit, dass ein freigegebener Platz keinen zurücklässt. */
  liveExchangeCount: typeof liveExchangeCount;
}

/** Hängt den Haken als `window.__mbLab` ein. `labMain.ts` ruft das NUR bei `?hook=1` auf. */
export function installLabHook(): void {
  const hook: LabHook = {
    createHostLobby,
    createClientJoin,
    createMessageRouter,
    createTimeline,
    runPingSeries,
    attachPongResponder,
    PROTOCOL_VERSION,
    renderQr,
    qrModuleCount,
    MAX_QR_PAYLOAD_CHARS,
    detectScanBackend,
    scanImage,
    scanVideo,
    openLobbyCamera,
    cameraStream,
    attachCamera,
    restartCamera,
    createQrExchange,
    createPairingTracker,
    liveExchangeCount,
  };
  (window as unknown as { __mbLab?: LabHook }).__mbLab = hook;
}
