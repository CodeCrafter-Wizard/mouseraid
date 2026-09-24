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
  /** `null`, wenn beim Entsperren keine offene Verbindung mehr da war. */
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
 * Nur dann ist „Neu verbinden" nötig: eine geschlossene RTCPeerConnection und eine Spur mit
 * `readyState === 'ended'` sind endgültig. Die Unterbrechung am Sperrbildschirm selbst ist
 * `mute`/`unmute` – dieselbe Spur läuft danach weiter.
 */
export function needsReconnect(run: Pick<LockTestRun, 'transportAfter' | 'trackAfter'>): boolean {
  return run.transportAfter !== 'open' || run.trackAfter === 'ended';
}
