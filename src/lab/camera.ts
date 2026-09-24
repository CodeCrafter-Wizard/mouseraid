// Der Aufzählungstyp wohnt im importfreien Leaf-Modul labTypes.ts – NICHT in report.ts: `camera.ts`
// hängt am Test-Haken, und `report.ts` zöge über net/environment die Vite-Konstante `__BUILD_ID__`
// in den Typgraphen der E2E-Specs (R10).
import type { TrackState } from './labTypes';

/**
 * Kamera-Zustand der Seite. „getUserMedia in dieser Sitzung ja/nein" gilt je Seitenaufruf – deshalb
 * Modul-Zustand statt UI-Zustand: Labor-Ablauf und Selbsttest sehen denselben Wert.
 */
export interface CameraStatus {
  running: boolean;
  gumCalled: boolean;
  /** Fehlername der letzten Anforderung (z. B. `NotAllowedError`) oder null. */
  error: string | null;
}

let stream: MediaStream | null = null;
let gumCalled = false;
let lastError: string | null = null;
/**
 * Die laufende Anforderung, solange sie läuft. Riegel gegen zwei gleichzeitige `getUserMedia`: am
 * Handy tippt man den Knopf zweimal, und der QR-Pfad startet die Kamera ohnehin von selbst. Die
 * zweite Anforderung überschriebe den Stream der ersten – der liefe dann unbeobachtet weiter
 * (Akku, Kamera-Lämpchen), während Sucher und Scanner am toten Stream hingen.
 */
let pending: Promise<CameraStatus> | null = null;

export function cameraStatus(): CameraStatus {
  return { running: stream !== null && stream.getVideoTracks().some((track) => track.readyState === 'live'), gumCalled, error: lastError };
}

/**
 * Selbsttest (Lauf B): eigener, kurzlebiger Stream – unabhängig vom Dauer-Stream der Lobby, damit
 * `stop()` nur die eigenen Tracks beendet. Zählt als getUserMedia-Aufruf der Sitzung. Wirft bei Ablehnung.
 */
export async function openTemporaryCamera(): Promise<{ stop(): void }> {
  gumCalled = true;
  // In unsicheren Kontexten fehlt `mediaDevices` ganz – der TypeError ist dann der gemeldete Kamera-Fehler.
  const media = await navigator.mediaDevices.getUserMedia({ video: true });
  return { stop: () => { for (const track of media.getTracks()) track.stop(); } };
}

/**
 * Kamera-zuerst (QR-Pfad): EIN Stream für die ganze Sitzung. `ideal` statt `exact` – mit `exact`
 * scheitert ein Gerät ohne Rückkamera mit `OverconstrainedError` (gemessen mit Chromes Fake-Gerät).
 * Kein Ton: das Labor braucht ihn nicht und ein Mikrofon-Symbol erschreckt nur.
 */
const LOBBY_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
};

/** Die eigentliche Anforderung. Wirft nie: ein Fehlschlag steht als Fehlername im Zustand. */
async function requestLobbyStream(): Promise<CameraStatus> {
  gumCalled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia(LOBBY_CONSTRAINTS);
    lastError = null;
  } catch (error) {
    stream = null;
    lastError = error instanceof Error ? error.name : String(error);
  }
  return cameraStatus();
}

/**
 * Öffnet den Dauer-Stream der Lobby. Wirft nie; teilt sich Modul-Zustand und `gumCalled` mit
 * `openTemporaryCamera` (der Selbsttest bleibt unberührt). Läuft schon ein Stream, passiert nichts;
 * läuft gerade eine Anforderung, bekommen alle Aufrufer DIESE – nie eine zweite Kamera.
 */
export function openLobbyCamera(): Promise<CameraStatus> {
  if (cameraStatus().running) return Promise.resolve(cameraStatus());
  // Das `finally` hängt am inneren Versprechen und läuft deshalb VOR jedem Aufrufer: wer danach
  // wartet, sieht den Riegel schon offen und darf selbst neu anfordern.
  const request = pending ?? requestLobbyStream().finally(() => { pending = null; });
  pending = request;
  return request;
}

export function cameraStream(): MediaStream | null {
  return stream;
}

/**
 * Hängt den Dauer-Stream in ein `<video>`. `false`, wenn kein Stream offen ist. Beendet NIE Tracks –
 * der Sucher ist nur ein Fenster auf den Stream, nicht sein Besitzer.
 */
export function attachCamera(video: HTMLVideoElement): boolean {
  if (stream === null) return false;
  // playsInline: iOS würde das Video sonst im Vollbild-Player öffnen; muted+autoplay: ohne beides
  // verweigert der Browser das automatische Abspielen.
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;
  // Ein abgelehntes `play()` (Energiesparmodus, fehlende Geste) lässt nur den Sucher schwarz –
  // der Stream und damit der Scanner laufen weiter.
  void video.play().catch(() => undefined);
  return true;
}

/** Was wir von einer Videospur brauchen – so bleibt die Beobachtung ohne DOM testbar. */
export interface TrackLike {
  readonly id: string;
  readonly readyState: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
export interface StreamLike {
  getVideoTracks(): readonly TrackLike[];
}

/** `readyState` kennt nur 'live' und 'ended'; die Unterbrechung am Sperrbildschirm ist `mute`/`unmute`. */
const TRACK_EVENTS: readonly { type: string; state: TrackState }[] = [
  { type: 'mute', state: 'muted' },
  { type: 'unmute', state: 'unmuted' },
  { type: 'ended', state: 'ended' },
];

/** Reine Naht von `observeTracks`: hängt an jede Videospur EINES Streams. */
export function observeStreamTracks(source: StreamLike, onChange: (state: TrackState, trackId: string) => void): () => void {
  const undo: (() => void)[] = [];
  for (const track of source.getVideoTracks()) {
    for (const { type, state } of TRACK_EVENTS) {
      const listener = (): void => { onChange(state, track.id); };
      track.addEventListener(type, listener);
      undo.push(() => { track.removeEventListener(type, listener); });
    }
    // Der Anfangszustand zählt mit: eine schon laufende Spur meldet einmal 'live'.
    if (track.readyState === 'live') onChange('live', track.id);
  }
  return () => { for (const off of undo.splice(0)) off(); };
}

/**
 * Beobachtet die Videospuren des Dauer-Streams. Rückgabe = Abmelde-Funktion. Der Aufrufer schreibt
 * `camera:track:<state>` in die Zeitleiste – die Spur-ID bleibt in der Seite (Datenschutz).
 */
export function observeTracks(onChange: (state: TrackState, trackId: string) => void): () => void {
  return stream === null ? () => undefined : observeStreamTracks(stream, onChange);
}

/**
 * Zuhörer eines GEGLÜCKTEN Neustarts. „Kamera neu starten" gibt es an zwei Stellen (Kamera-Karte und
 * QR-Block), die Heilung gehört aber immer der Karte: sie zeigt den Zustand UND beobachtet die Spuren
 * des Streams. Ohne diese Meldung bliebe nach einem Neustart aus dem QR-Block die alte, tote
 * Beobachtung hängen – die geheilte Kamera meldete nie wieder `camera:track:live` (falsches F9 für den
 * Rest des Seitenaufrufs) und ein späterer Spur-Verlust fiele überhaupt nicht mehr auf.
 */
const restartListeners: ((status: CameraStatus) => void)[] = [];

/** Meldet einen Zuhörer an; die Rückgabe meldet ihn wieder ab. */
export function onCameraRestarted(listener: (status: CameraStatus) => void): () => void {
  restartListeners.push(listener);
  return () => {
    const index = restartListeners.indexOf(listener);
    if (index >= 0) restartListeners.splice(index, 1);
  };
}

/** „Kamera neu starten" nach einer beendeten Spur: eigene Tracks beenden, dann neu öffnen. */
export async function restartCamera(): Promise<CameraStatus> {
  // Eine laufende Anforderung zuerst abwarten: sonst fände der Neustart `stream === null` vor, und
  // der erst danach eintreffende alte Stream überschriebe den frischen – ungenutzt, aber offen.
  if (pending !== null) await pending;
  if (stream !== null) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  const status = await openLobbyCamera();
  // Nur der Erfolg wird gemeldet: ein Fehlschlag gehört dem Knopf, der ihn ausgelöst hat (er zeigt
  // den Grund), und eine „Heilung" ohne Kamera hätte nichts zu beobachten. Kopie der Liste: ein
  // Zuhörer darf sich beim Melden abmelden.
  if (status.running) for (const listener of [...restartListeners]) listener(status);
  return status;
}
