import type { AddressFamily, AddressScope, ParsedCandidate } from '../net/candidates';
import type { EnvironmentInfo, PermissionSnapshot, SelectedPair } from '../net/environment';
import type { FailureCode } from '../net/failureCodes';
import type { PingStats } from '../net/pingTest';
import type { PayloadSizes } from '../net/sdpCodec';
import type { TimelineEvent } from '../net/timeline';

// Report-Modell des Testlabors. Alle Texte in dieser Datei sind Report-DATEN für den
// Entwickler-Rückkanal (wie der Diagnose-Text in src/platform/errorLog.ts), keine Spiel-UI –
// deshalb stehen sie nicht in src/ui/strings.ts.

export interface CellLabel {
  role: 'host' | 'client' | 'selbsttest';
  hotspotOwner: 'dieses-geraet' | 'gegenstelle' | 'router' | 'unbekannt';
  camera: 'an' | 'aus';
  path: 'text' | 'qr' | 'broadcast' | 'loopback';
  /** Frei gewählter Spitzname, 1–24 Zeichen. */
  device: string;
}

export interface LabReport {
  id: string;
  createdAt: string;
  buildId: string;
  protoV: number;
  cell: CellLabel;
  environment: EnvironmentInfo;
  permissions: PermissionSnapshot;
  gumCalledThisSession: boolean;
  gather: { durationMs: number; timedOut: boolean; gathered: ParsedCandidate[]; transmitted: number } | null;
  payloadSizes: PayloadSizes | null;
  timeline: TimelineEvent[];
  selectedPair: SelectedPair | null;
  sctpMaxMessageSize: number | null;
  hello: { remoteProtoV: number; remoteBuildId: string; versionMatch: boolean } | null;
  ping: { state: PingStats | null; events: PingStats | null };
  /** Platzhalterfeld fürs Format, wird in M2 befüllt (Sperrbildschirm-Test). */
  lockTest: null;
  failures: FailureCode[];
  valid: boolean;
  invalidReason: string | null;
  notes: string;
}

const MAX_DEVICE_LENGTH = 24;
const REASON_DEVICE = 'Gerätename fehlt oder ist länger als 24 Zeichen';
const REASON_OFF_BUT_GRANTED = 'Kamera aus, aber Berechtigung ist erteilt (echte IPs trotz fehlender Kamera)';
const REASON_ON_NOT_GRANTED = 'Kamera an, aber Berechtigung ist nicht erteilt';

/**
 * Misst der Lauf, was sein Zellenlabel behauptet? Beide Kamera-Regeln stammen aus docs/decisions.md
 * (Tooling-Spike): nur der Status `granted` entscheidet, ob Chrome echte IPs statt mDNS-Namen liefert.
 */
export function isRunValid(cell: CellLabel, permissions: PermissionSnapshot): { valid: boolean; reason: string | null } {
  const device = cell.device.trim();
  if (device.length < 1 || device.length > MAX_DEVICE_LENGTH) return { valid: false, reason: REASON_DEVICE };
  // BroadcastChannel hat kein ICE – die Kamera-Berechtigung beeinflusst dort nichts.
  if (cell.path === 'broadcast') return { valid: true, reason: null };
  const granted = permissions.camera === 'granted';
  if (cell.camera === 'aus' && granted) return { valid: false, reason: REASON_OFF_BUT_GRANTED };
  if (cell.camera === 'an' && !granted) return { valid: false, reason: REASON_ON_NOT_GRANTED };
  return { valid: true, reason: null };
}

// ───────── Anonymisierung ─────────

type TokenFor = (address: string, family: AddressFamily, scope: AddressScope) => string;

/** Vergibt je unterschiedlicher Adresse ein Token; n zählt in der Reihenfolge des ersten Auftretens. */
function createTokenizer(): TokenFor {
  const tokens = new Map<string, string>();
  return (address, family, scope) => {
    const key = address.toLowerCase();
    const known = tokens.get(key);
    if (known !== undefined) return known;
    const token = `${family}/${scope}#${tokens.size + 1}`;
    tokens.set(key, token);
    return token;
  };
}

// Bewusst ohne Lookbehind: ältere Safari-Versionen scheitern daran schon beim Parsen des Bundles.
const IPV4_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const MDNS_PATTERN = /\b[0-9a-z][0-9a-z-]*(?:\.[0-9a-z-]+)*\.local\b/gi;
/** Wörter mit mindestens zwei Doppelpunkten (plus Zonen-ID); ob es IPv6 ist, entscheidet `isIpv6`. */
const IPV6_WORD_PATTERN = /[0-9a-z]*(?::[0-9a-z]*){2,}(?:%[0-9a-z]+)?/gi;

function isIpv4(text: string): boolean {
  return text.split('.').every((octet) => Number(octet) <= 255);
}

function isIpv6(word: string): boolean {
  const halves = (word.split('%')[0] ?? '').split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === '' ? [] : half.split(':')));
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return false;
  // Ohne „::“ braucht IPv6 genau acht Gruppen – „16:24:25“ ist eine Uhrzeit, keine Adresse.
  return halves.length === 2 ? groups.length <= 7 : groups.length === 8;
}

/** Ersetzt alles, was wie IPv4, IPv6 oder ein `.local`-Name aussieht. Bekannte Adressen behalten ihr Token. */
function scrubText(text: string, tokenFor: TokenFor): string {
  return text
    .replace(IPV4_PATTERN, (match) => (isIpv4(match) ? tokenFor(match, 'ipv4', 'other') : match))
    .replace(MDNS_PATTERN, (match) => tokenFor(match, 'mdns', 'mdns'))
    .replace(IPV6_WORD_PATTERN, (match) => (isIpv6(match) ? tokenFor(match.split('%')[0] ?? match, 'ipv6', 'other') : match));
}

/** Kandidatenzeile: `foundation component transport priority ADRESSE port typ … [raddr ADRESSE] [ufrag WERT]`. */
function redactRaw(candidate: ParsedCandidate, tokenFor: TokenFor): string {
  const parts = candidate.raw.split(' ');
  if (parts.length > 4) parts[4] = tokenFor(candidate.address, candidate.family, candidate.scope);
  for (let i = 5; i + 1 < parts.length; i += 1) {
    if (parts[i] === 'raddr') parts[i + 1] = scrubText(parts[i + 1] ?? '', tokenFor);
    if (parts[i] === 'ufrag') parts[i + 1] = 'entfernt';
  }
  return scrubText(parts.join(' '), tokenFor);
}

/**
 * Kopie fürs öffentliche Repo: Adressen werden zu `<familie>/<scope>#n`. userAgent, Build-ID, Größen
 * und Statistik bleiben unverändert; die Eingabe wird nicht angefasst.
 */
export function redactReport(report: LabReport): LabReport {
  // Ein Report ist per Definition JSON (so liegt er auch im localStorage) – das ist die tiefe Kopie.
  const copy = JSON.parse(JSON.stringify(report)) as LabReport;
  const tokenFor = createTokenizer();
  if (copy.gather !== null) {
    // Erst alle Kandidaten-Adressen nummerieren, dann raw: so bestimmt nie ein raddr die Zählung.
    for (const candidate of copy.gather.gathered) tokenFor(candidate.address, candidate.family, candidate.scope);
    for (const candidate of copy.gather.gathered) {
      candidate.raw = redactRaw(candidate, tokenFor);
      candidate.address = tokenFor(candidate.address, candidate.family, candidate.scope);
    }
  }
  // Laut Vertrag sind Zeitleisten-Details adressfrei – hier wird es vorsorglich erzwungen.
  for (const event of copy.timeline) event.detail = scrubText(event.detail, tokenFor);
  copy.notes = scrubText(copy.notes, tokenFor);
  return copy;
}

// ───────── Text und JSON ─────────

const yesNo = (value: boolean): string => (value ? 'ja' : 'nein');
/** Höchstens eine Nachkommastelle – Millisekunden und Prozent brauchen im Bericht nicht mehr. */
const num = (value: number): string => String(Math.round(value * 10) / 10);

function candidateLines(gather: LabReport['gather']): string[] {
  if (gather === null) return ['  kein Gathering'];
  const counts = new Map<string, number>();
  for (const candidate of gather.gathered) {
    const key = `${candidate.family}/${candidate.scope}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    `  gesammelt ${gather.gathered.length}, übertragen ${gather.transmitted}, Dauer ${num(gather.durationMs)} ms, Timeout ${yesNo(gather.timedOut)}`,
    ...[...counts].map(([key, count]) => `  ${count}× ${key}`),
  ];
}

function payloadLine(sizes: PayloadSizes | null): string {
  if (sizes === null) return '  Payload: keiner';
  const mode = sizes.compressed ? 'komprimiert' : 'unkomprimiert';
  return `  SDP ${sizes.sdpBytes} B → minimiert ${sizes.minimisedBytes} B → gepackt ${sizes.packedBytes} B → Text ${sizes.textChars} Zeichen (${mode})`;
}

function pairLine(pair: SelectedPair | null): string {
  if (pair === null) return '  Paar: keines gewählt';
  const rtt = pair.currentRttMs === null ? 'unbekannt' : `${num(pair.currentRttMs)} ms`;
  return `  Paar: lokal ${pair.localType}/${pair.localProtocol} ${pair.localFamily}/${pair.localScope} ↔ entfernt ${pair.remoteType} ${pair.remoteFamily}/${pair.remoteScope}, RTT ${rtt}`;
}

function helloLine(hello: LabReport['hello']): string {
  if (hello === null) return '  Hello: nicht ausgetauscht';
  return `  Hello: Gegenstelle Build ${hello.remoteBuildId}, Protokoll v${hello.remoteProtoV}, Versionen passen: ${yesNo(hello.versionMatch)}`;
}

function pingLine(channel: string, stats: PingStats | null): string {
  if (stats === null) return `  ${channel}: nicht gemessen`;
  return (
    `  ${channel}: gesendet ${stats.sent}, empfangen ${stats.received}, Verlust ${num(stats.lossPct)} %, ` +
    `RTT min ${num(stats.minMs)} / Median ${num(stats.medianMs)} / p95 ${num(stats.p95Ms)} / max ${num(stats.maxMs)} ms, ` +
    `außer der Reihe ${stats.outOfOrder}`
  );
}

function timelineLines(timeline: readonly TimelineEvent[]): string[] {
  if (timeline.length === 0) return ['  (leer)'];
  return timeline.map((event) => `  +${num(event.tMs)} ms ${event.kind}${event.detail === '' ? '' : ` – ${event.detail}`}`);
}

/** Menschenlesbarer Bericht zum Kopieren/Teilen. Nennt Kandidaten nur nach Art und Anzahl, nie nach Adresse. */
export function reportToText(report: LabReport): string {
  const { cell, environment, permissions } = report;
  const features = environment.features;
  const formats = features.barcodeFormats.length === 0 ? '' : ` (${features.barcodeFormats.join(', ')})`;
  return [
    'Mäusebau-Laborbericht',
    `ID: ${report.id}`,
    `Erstellt: ${report.createdAt}`,
    `Build: ${report.buildId} (Protokoll v${report.protoV})`,
    `Zelle: Rolle ${cell.role} · Hotspot ${cell.hotspotOwner} · Kamera ${cell.camera} · Pfad ${cell.path} · Gerät ${cell.device}`,
    `Gültig: ${report.valid ? 'ja' : `NEIN – ${report.invalidReason ?? 'ohne Angabe'}`}`,
    '',
    'Umgebung',
    `  Browser: ${environment.userAgent}`,
    `  Engine: ${environment.engine} · Anzeige: ${environment.displayMode} · Seiten-Build: ${environment.buildId}`,
    `  Sicherer Kontext: ${yesNo(environment.secureContext)} · Online: ${yesNo(environment.online)} · Service Worker steuert: ${yesNo(environment.swControlled)}`,
    `  Funktionen: WebRTC ${yesNo(features.rtc)} · CompressionStream ${yesNo(features.compressionStream)} · WakeLock ${yesNo(features.wakeLock)}` +
      ` · BarcodeDetector ${yesNo(features.barcodeDetector)}${formats} · Storage-Persist ${yesNo(features.storagePersist)}` +
      ` · Text teilen ${yesNo(features.shareText)} · Zwischenablage ${yesNo(features.clipboardWrite)}`,
    '',
    'Berechtigungen',
    `  Kamera: ${permissions.camera} · Lokales Netzwerk: ${permissions.localNetwork} · Loopback-Netzwerk: ${permissions.loopbackNetwork}`,
    `  getUserMedia in dieser Sitzung: ${yesNo(report.gumCalledThisSession)}`,
    '',
    'Kandidaten',
    ...candidateLines(report.gather),
    '',
    'Verbindung',
    payloadLine(report.payloadSizes),
    pairLine(report.selectedPair),
    `  SCTP maxMessageSize: ${report.sctpMaxMessageSize ?? 'unbekannt'}`,
    helloLine(report.hello),
    '',
    'Ping',
    pingLine('state', report.ping.state),
    pingLine('events', report.ping.events),
    '',
    `Befunde: ${report.failures.length === 0 ? 'keine' : report.failures.join(', ')}`,
    '',
    'Zeitleiste',
    ...timelineLines(report.timeline),
    '',
    `Notizen: ${report.notes === '' ? '–' : report.notes}`,
  ].join('\n');
}

export function reportsToJson(reports: readonly LabReport[]): string {
  return JSON.stringify(reports, null, 2);
}

// ───────── Verlauf ─────────

export const REPORT_STORE_KEY = 'maeusebau.lab.reports.v1';
const DEFAULT_MAX_REPORTS = 50;

export interface ReportStore {
  list(): LabReport[];
  add(report: LabReport): void;
  clear(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Grobe Formprüfung: genug, damit `reportToText` und die Verlaufsliste nicht an Fremddaten scheitern. */
function looksLikeReport(value: unknown): value is LabReport {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.buildId === 'string' &&
    isRecord(value.cell) &&
    isRecord(value.environment) &&
    isRecord(value.environment.features) &&
    isRecord(value.permissions) &&
    isRecord(value.ping) &&
    Array.isArray(value.timeline) &&
    Array.isArray(value.failures)
  );
}

/**
 * Report-Verlauf über einem injizierten Speicher (im Browser `localStorage`), neueste zuerst.
 * Wirft nie: gesperrter Speicher, defekte Daten und ein volles Quota dürfen keinen Lauf abbrechen.
 */
export function createReportStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  max: number = DEFAULT_MAX_REPORTS,
): ReportStore {
  const read = (): LabReport[] => {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(REPORT_STORE_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(looksLikeReport) : [];
    } catch {
      return [];
    }
  };

  return {
    list: read,
    add(report) {
      let next = [report, ...read().filter((other) => other.id !== report.id)].slice(0, max);
      // Volles Quota: die ältere Hälfte weglassen und erneut versuchen – der neue Report ist der wichtigste.
      while (next.length > 0) {
        try {
          storage.setItem(REPORT_STORE_KEY, JSON.stringify(next));
          return;
        } catch {
          next = next.slice(0, Math.floor(next.length / 2));
        }
      }
    },
    clear() {
      try {
        storage.removeItem(REPORT_STORE_KEY);
      } catch {
        // Gesperrter Speicher: es gibt nichts zu löschen.
      }
    },
  };
}
