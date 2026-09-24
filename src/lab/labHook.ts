import { createClientJoin, createHostLobby } from '../net/connector';
import { createMessageRouter } from '../net/messageRouter';
import { attachPongResponder, runPingSeries } from '../net/pingTest';
import { PROTOCOL_VERSION } from '../net/protocol';
import { createTimeline } from '../net/timeline';
import { MAX_QR_PAYLOAD_CHARS, qrModuleCount, renderQr } from './qrRender';
import { detectScanBackend, scanImage, scanVideo } from './scannerAdapter';
import { attachCamera, cameraStream, openLobbyCamera } from './camera';

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
  };
  (window as unknown as { __mbLab?: LabHook }).__mbLab = hook;
}
