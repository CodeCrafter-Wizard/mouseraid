import type { PingStats } from '../net/pingTest';
import type { TransportState } from '../net/transport';
// Der Aufzählungstyp wohnt im importfreien Leaf-Modul labTypes.ts – NICHT in camera.ts (DOM) und
// nicht in report.ts (zöge net/environment nach). Reine Typ-Importe, zur Laufzeit kein Kreis.
import type { TrackState } from './labTypes';

/**
 * Sperrbildschirm-Test: Bildschirm sperren, nach N Sekunden entsperren, messen was überlebt hat.
 * Reine Logik – keine Timer, keine DOM-API, die Uhr wird injiziert. Die DOM-Naht liegt in
 * connectPanels.ts (Knöpfe, `visibilitychange`, Ping-Serie, „Neu verbinden").
 */
export const LOCK_SECONDS = [10, 30, 60] as const;
export type LockSeconds = (typeof LOCK_SECONDS)[number];

/** Ping-Serie nach dem Entsperren – je Kanal eine Statistik (D9: 20 Pings je Kanal). */
export interface LockPings {
  state: PingStats | null;
  events: PingStats | null;
}

export interface LockTestRun {
  plannedSeconds: LockSeconds;
  /** Tatsächlich verdeckte Zeit in ms – gemessen, nicht geplant. */
  hiddenMs: number;
  transportBefore: TransportState;
  transportAfter: TransportState;
  trackBefore: TrackState;
  trackAfter: TrackState;
  /**
   * `null`, wenn beim Entsperren keine offene Verbindung mehr da war und deshalb nichts gemessen
   * wurde – der Aufrufer entscheidet das mit `measuredLockPings`, der Bericht schreibt dann
   * „Ping nicht gemessen" statt zweier nichtssagender Gedankenstriche.
   */
  pingAfter: LockPings | null;
  reconnected: boolean;
}

export interface LockTestPlan {
  plannedSeconds: LockSeconds;
  hiddenAtMs: number;
  transportBefore: TransportState;
  trackBefore: TrackState;
}

/** Beim Wechsel auf `hidden` aufrufen: hält Startzeit und die Zustände VOR dem Sperren fest. */
export function beginLockRun(input: { plannedSeconds: LockSeconds; transport: TransportState; track: TrackState; now: () => number }): LockTestPlan {
  return {
    plannedSeconds: input.plannedSeconds,
    hiddenAtMs: input.now(),
    transportBefore: input.transport,
    trackBefore: input.track,
  };
}

/**
 * Beim Wechsel auf `visible` aufrufen. `hiddenMs` zählt von `visibilitychange`→hidden bis →visible;
 * der Aufrufer friert dafür seine Uhr auf den Zeitpunkt des Entsperrens ein, damit die Ping-Serie
 * danach die Messung nicht verlängert.
 */
export function finishLockRun(
  plan: LockTestPlan,
  input: { transport: TransportState; track: TrackState; pingAfter: LockPings | null; reconnected: boolean; now: () => number },
): LockTestRun {
  return {
    plannedSeconds: plan.plannedSeconds,
    hiddenMs: Math.max(0, Math.round(input.now() - plan.hiddenAtMs)),
    transportBefore: plan.transportBefore,
    transportAfter: input.transport,
    trackBefore: plan.trackBefore,
    trackAfter: input.track,
    pingAfter: input.pingAfter,
    reconnected: input.reconnected,
  };
}

/**
 * Spur-Zustand beim SCHÄRFEN eines Laufs. Läuft die Kamera, ist ihre Spur frisch und lebt: ein
 * `'ended'` aus der Zeit vor einem Kamera-Neustart darf den nächsten Lauf nicht mehr belasten –
 * sonst meldete der jedes Mal „Verbindung oder Kamera ist weg", obwohl beides steht. Ohne laufende
 * Kamera bleibt der bisherige Zustand stehen; es gibt dann keine Spur, die etwas anderes behauptet.
 */
export function armedTrackState(cameraRunning: boolean, previous: TrackState): TrackState {
  return cameraRunning ? 'live' : previous;
}

/**
 * Ping-Serie, wie sie in den Lauf gehört. War die Verbindung beim Entsperren nicht mehr offen, gab
 * es nichts zu messen – dann steht `null` im Lauf. Zwei leere Kanäle bedeuten dasselbe (die Serie
 * kam gar nicht erst zustande oder ist geworfen); ohne diese Zusammenfassung bliebe der Zweig
 * „Ping nicht gemessen" des Berichts unerreichbar und stattdessen stünden dort zwei Gedankenstriche.
 */
export function measuredLockPings(openAtUnlock: boolean, pings: LockPings): LockPings | null {
  if (!openAtUnlock) return null;
  return pings.state === null && pings.events === null ? null : pings;
}

/**
 * Nur dann ist „Neu verbinden" nötig: eine geschlossene RTCPeerConnection und eine Spur mit
 * `readyState === 'ended'` sind endgültig. Die Unterbrechung am Sperrbildschirm selbst ist
 * `mute`/`unmute` – dieselbe Spur läuft danach weiter.
 */
export function needsReconnect(run: Pick<LockTestRun, 'transportAfter' | 'trackAfter'>): boolean {
  return run.transportAfter !== 'open' || run.trackAfter === 'ended';
}
