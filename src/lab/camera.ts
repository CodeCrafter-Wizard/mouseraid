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

export function cameraStatus(): CameraStatus {
  return { running: stream !== null && stream.getVideoTracks().some((track) => track.readyState === 'live'), gumCalled, error: lastError };
}

/** Nacktes `getUserMedia({ video: true })`; der Stream bleibt offen. Wirft nie. */
export async function startCamera(): Promise<CameraStatus> {
  if (cameraStatus().running) return cameraStatus();
  gumCalled = true;
  try {
    // In unsicheren Kontexten fehlt `mediaDevices` ganz – das landet als TypeError im catch.
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    lastError = null;
  } catch (error) {
    stream = null;
    lastError = error instanceof Error ? error.name : String(error);
  }
  return cameraStatus();
}

/**
 * Selbsttest (Lauf B): eigener, kurzlebiger Stream – unabhängig vom Dauer-Stream aus `startCamera`, damit
 * `stop()` nur die eigenen Tracks beendet. Zählt als getUserMedia-Aufruf der Sitzung. Wirft bei Ablehnung.
 */
export async function openTemporaryCamera(): Promise<{ stop(): void }> {
  gumCalled = true;
  // In unsicheren Kontexten fehlt `mediaDevices` ganz – der TypeError ist dann der gemeldete Kamera-Fehler.
  const media = await navigator.mediaDevices.getUserMedia({ video: true });
  return { stop: () => { for (const track of media.getTracks()) track.stop(); } };
}
