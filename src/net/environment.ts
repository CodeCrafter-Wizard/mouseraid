import { BUILD_ID } from '../platform/buildInfo';
import { parseCandidate, type AddressFamily, type AddressScope } from './candidates';
import { supportsDeflateRaw } from './compress';
import type { BrowserEngine, PermissionState3 } from './failureCodes';
import { canShareText } from './signaling/textShare';

export interface PermissionSnapshot {
  camera: PermissionState3;
  localNetwork: PermissionState3;
  loopbackNetwork: PermissionState3;
}

export interface EnvironmentInfo {
  userAgent: string;
  engine: BrowserEngine;
  displayMode: string;
  secureContext: boolean;
  online: boolean;
  swControlled: boolean;
  buildId: string;
  features: {
    rtc: boolean;
    compressionStream: boolean;
    wakeLock: boolean;
    barcodeDetector: boolean;
    barcodeFormats: string[];
    storagePersist: boolean;
    shareText: boolean;
    clipboardWrite: boolean;
  };
}

export interface SelectedPair {
  localType: string;
  localProtocol: string;
  localFamily: AddressFamily;
  localScope: AddressScope;
  remoteType: string;
  remoteFamily: AddressFamily;
  remoteScope: AddressScope;
  currentRttMs: number | null;
}

/**
 * Browser-Engine aus dem User-Agent (rein). Reihenfolge ist wichtig: auf iOS steckt hinter JEDEM
 * Browser WebKit (CriOS, FxiOS, EdgiOS), und „like Gecko" steht auch in Chromium- und Safari-Kennungen.
 */
export function detectEngine(userAgent: string): BrowserEngine {
  if (/\b(?:iPhone|iPad|iPod)\b/.test(userAgent) || /\b(?:CriOS|FxiOS|EdgiOS)\//.test(userAgent)) return 'webkit';
  if (/\bGecko\/\d/.test(userAgent) && /\bFirefox\/\d/.test(userAgent)) return 'gecko';
  if (/\b(?:Chrome|Chromium)\/\d/.test(userAgent)) return 'chromium';
  if (/\bAppleWebKit\/\d/.test(userAgent)) return 'webkit';
  return 'unknown';
}

function currentDisplayMode(): string {
  try {
    for (const mode of ['fullscreen', 'standalone', 'minimal-ui', 'browser']) {
      if (matchMedia(`(display-mode: ${mode})`).matches) return mode;
    }
  } catch {
    // matchMedia fehlt oder wirft → unten „unbekannt".
  }
  return 'unbekannt';
}

interface BarcodeDetectorStatic {
  getSupportedFormats?: () => Promise<string[]>;
}

async function barcodeSupport(): Promise<{ available: boolean; formats: string[] }> {
  const detector = (globalThis as { BarcodeDetector?: BarcodeDetectorStatic }).BarcodeDetector;
  if (detector === undefined) return { available: false, formats: [] };
  try {
    const formats = typeof detector.getSupportedFormats === 'function' ? await detector.getSupportedFormats() : [];
    return { available: true, formats: [...formats] };
  } catch {
    // Vorhanden, aber ohne Auskunft (z. B. fehlender Plattformdienst) – M2 fällt dann auf die Bibliothek zurück.
    return { available: true, formats: [] };
  }
}

/** Momentaufnahme der Laufzeitumgebung für den Report. Enthält keine Netzwerkadressen. */
export async function collectEnvironment(): Promise<EnvironmentInfo> {
  const barcode = await barcodeSupport();
  const storage: StorageManager | undefined = navigator.storage;
  const clipboard: Clipboard | undefined = navigator.clipboard;
  return {
    userAgent: navigator.userAgent,
    engine: detectEngine(navigator.userAgent),
    displayMode: currentDisplayMode(),
    secureContext: isSecureContext,
    online: navigator.onLine,
    swControlled: 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null,
    buildId: BUILD_ID,
    features: {
      rtc: typeof RTCPeerConnection === 'function',
      compressionStream: supportsDeflateRaw(),
      wakeLock: 'wakeLock' in navigator,
      barcodeDetector: barcode.available,
      barcodeFormats: barcode.formats,
      storagePersist: storage !== undefined && typeof storage.persist === 'function',
      shareText: canShareText(),
      clipboardWrite: clipboard !== undefined && typeof clipboard.writeText === 'function',
    },
  };
}

async function queryOne(name: string): Promise<PermissionState3> {
  try {
    // 'local-network'/'loopback-network' kennt lib.dom noch nicht; unbekannte Namen lehnt der Browser mit TypeError ab.
    const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
    const state: string = status.state;
    return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Berechtigungs-STATUS (nicht „wurde getUserMedia aufgerufen") – Grundlage der Kamera-Regel. */
export async function queryPermissions(): Promise<PermissionSnapshot> {
  const [camera, localNetwork, loopbackNetwork] = await Promise.all([
    queryOne('camera'),
    queryOne('local-network'),
    queryOne('loopback-network'),
  ]);
  return { camera, localNetwork, loopbackNetwork };
}

type StatsEntry = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Familie/Scope einer Adresse über den Kandidaten-Parser aus Task 4 – die Adresse selbst verlässt diese Funktion nie. */
function classifyAddress(address: string): { family: AddressFamily; scope: AddressScope } {
  const parsed = address === '' || /\s/.test(address) ? null : parseCandidate(`0 1 udp 1 ${address} 9 typ host`);
  return parsed === null ? { family: 'other', scope: 'other' } : { family: parsed.family, scope: parsed.scope };
}

function findSelectedPair(stats: ReadonlyMap<string, StatsEntry>): StatsEntry | undefined {
  for (const entry of stats.values()) {
    if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
      const pair = stats.get(entry.selectedCandidatePairId);
      if (pair !== undefined) return pair;
    }
  }
  // Firefox kennt keine 'transport'-Statistik, markiert das Paar aber mit `selected`.
  for (const entry of stats.values()) {
    if (entry.type === 'candidate-pair' && entry.selected === true) return entry;
  }
  return undefined;
}

/** Gewähltes Kandidatenpaar aus `getStats()`: nur Typ, Protokoll, Familie, Scope und RTT – KEINE Adressen. */
export async function collectSelectedPair(pc: RTCPeerConnection): Promise<SelectedPair | null> {
  const stats = new Map<string, StatsEntry>();
  try {
    // `forEach` statt `for…of`: RTCStatsReport ist nur mit der Lib „DOM.Iterable" iterierbar.
    (await pc.getStats()).forEach((entry: StatsEntry, id: string) => {
      stats.set(id, entry);
    });
  } catch {
    return null;
  }
  const chosen = findSelectedPair(stats);
  if (chosen === undefined) return null;
  const local = stats.get(text(chosen.localCandidateId));
  const remote = stats.get(text(chosen.remoteCandidateId));
  if (local === undefined || remote === undefined) return null;
  const localClass = classifyAddress(text(local.address ?? local.ip));
  const remoteClass = classifyAddress(text(remote.address ?? remote.ip));
  return {
    localType: text(local.candidateType),
    localProtocol: text(local.protocol),
    localFamily: localClass.family,
    localScope: localClass.scope,
    remoteType: text(remote.candidateType),
    remoteFamily: remoteClass.family,
    remoteScope: remoteClass.scope,
    // Sekunden → Millisekunden, auf 0,1 ms gerundet.
    currentRttMs: typeof chosen.currentRoundTripTime === 'number' ? Math.round(chosen.currentRoundTripTime * 10_000) / 10 : null,
  };
}

/** `sctp.maxMessageSize` der Verbindung; null vor dem Aushandeln, ohne SCTP-Objekt oder bei „unbegrenzt". */
export function sctpMaxMessageSize(pc: RTCPeerConnection): number | null {
  const size = pc.sctp?.maxMessageSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : null;
}
