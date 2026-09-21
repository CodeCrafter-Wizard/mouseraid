// Fehlercodes F1–F9 des Verbindungs-Testlabors. Reine Entscheidungstabelle: kein DOM, keine Browser-API.
// Die deutschen Texte dazu stehen in src/ui/strings.ts unter S.failures.
import type { CandidateSummary } from './candidates';

/** Alle Codes in der festen Ausgabe-Reihenfolge. */
export const FAILURE_CODES = ['F1', 'F1S', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];
export type PermissionState3 = 'granted' | 'denied' | 'prompt' | 'unsupported';
export type BrowserEngine = 'chromium' | 'webkit' | 'gecko' | 'unknown';

export interface FailureInput {
  secureContext: boolean;
  rtcAvailable: boolean;
  engine: BrowserEngine;
  cameraPermission: PermissionState3;
  localNetworkPermission: PermissionState3;
  /** null = Gathering hat noch nicht stattgefunden. */
  candidates: CandidateSummary | null;
  /** RTCIceConnectionState oder 'none'. */
  iceState: string;
  channelsOpen: boolean;
  msSinceIceConnected: number | null;
  wasOpenBefore: boolean;
  codecError: boolean;
  cameraError: boolean;
}

/** F7: so lange dürfen die Kanäle nach „ICE verbunden" zum Öffnen brauchen. */
const CHANNEL_OPEN_DEADLINE_MS = 10_000;

/**
 * Ordnet einen Lauf den Codes zu – stabile Reihenfolge F1…F9, leer = kein Befund.
 *   F6 Umgebung ungeeignet – steht allein, weil ohne sie nichts anderes aussagekräftig ist.
 *   F1 keine Host-Kandidaten · F1S dasselbe auf WebKit ohne Kamera-Erlaubnis · F2 nur mDNS-Kandidaten
 *   F4 iPhone-Hotspot-Adresse (Kandidaten-Codes nur nach dem Gathering, candidates !== null)
 *   F3 ICE fehlgeschlagen · F5 Code ungültig/Versionskonflikt/falsche Rolle · F9 Kamera-Problem
 *   F8 Verbindung verloren (war offen) – sonst F7, wenn ICE steht und die Kanäle nach 10 s nicht offen sind.
 */
export function classifyFailures(input: FailureInput): FailureCode[] {
  if (!input.secureContext || !input.rtcAvailable || input.localNetworkPermission === 'denied') return ['F6'];

  const found = new Set<FailureCode>();
  if (input.codecError) found.add('F5');
  if (input.cameraError) found.add('F9');

  const candidates = input.candidates;
  if (candidates !== null) {
    if (candidates.host === 0) {
      found.add(input.engine === 'webkit' && input.cameraPermission !== 'granted' ? 'F1S' : 'F1');
    } else if (candidates.hostRealIp === 0) {
      found.add('F2');
    }
    if (candidates.iosHotspot) found.add('F4');
  }

  const ice = input.iceState;
  if (ice === 'failed') found.add('F3');

  const iceUp = ice === 'connected' || ice === 'completed';
  const iceDown = ice === 'disconnected' || ice === 'failed' || ice === 'closed';
  const deadlinePassed = input.msSinceIceConnected !== null && input.msSinceIceConnected >= CHANNEL_OPEN_DEADLINE_MS;
  if (input.wasOpenBefore && (iceDown || !input.channelsOpen)) found.add('F8');
  else if (iceUp && !input.channelsOpen && deadlinePassed) found.add('F7');

  return FAILURE_CODES.filter((code) => found.has(code));
}
