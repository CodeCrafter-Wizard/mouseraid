// Geteilte Aufzählungs- und Datentypen der Laborschicht. Dieses Modul hat ABSICHTLICH KEINE Importe
// und importiert nie eines: alles, was `labHook.ts` nach außen gibt, hängt daran, und `labHook` darf
// den Typgraphen von `report.ts`/`labSession.ts`/`net/environment.ts`/`platform/buildInfo.ts` nicht
// berühren – sonst scheitert der Node-Typecheck der E2E-Specs an `__BUILD_ID__`.
// Bewacht von tests/node/labHook-graph.test.ts.

/** Welcher Weg einen QR-Code dekodiert hat. `'native'` heißt: UNSER BarcodeDetector-Pfad war es. */
export type ScanBackend = 'native' | 'worker';

/** Zustand einer Kamera-Videospur. `'ended'` ist endgültig; die Sperrbildschirm-Pause ist `'muted'`/`'unmuted'`. */
export type TrackState = 'live' | 'muted' | 'unmuted' | 'ended';

/** QR-Fakten eines Laufs – identisch zum Report-Feld `LabReport['qr']`, aber ohne Import aus report.ts. */
export interface QrFacts {
  backend: ScanBackend;
  offerChars: number;
  answerChars: number;
  decodeLatencyMs: number;
  attempts: number;
}
