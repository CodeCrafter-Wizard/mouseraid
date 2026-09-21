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

type TokenFor = (address: string, family: string, scope: string) => string;

// Positivliste der Token-Bestandteile. `Record<…, true>` erzwingt Vollständigkeit: kommt in
// src/net/candidates.ts ein Wert dazu, scheitert hier der Typecheck.
const FAMILIES: Readonly<Record<AddressFamily, true>> = { ipv4: true, ipv6: true, mdns: true, other: true };
const SCOPES: Readonly<Record<AddressScope, true>> = {
  loopback: true,
  'link-local': true,
  private: true,
  cgnat: true,
  'ios-hotspot': true,
  ula: true,
  global: true,
  mdns: true,
  other: true,
};
const FALLBACK_LABEL = 'other';

/**
 * Vergibt je unterschiedlicher Adresse ein Token; n zählt in der Reihenfolge des ersten Auftretens.
 * Familie und Scope kommen nur von der Positivliste ins Token: bei Fremddaten aus dem Speicher sind
 * beides beliebige Zeichenketten, und ein Token darf nie freien Text (oder „$&“) weitertragen.
 */
function createTokenizer(): TokenFor {
  const tokens = new Map<string, string>();
  return (address, family, scope) => {
    const key = address.toLowerCase();
    const known = tokens.get(key);
    if (known !== undefined) return known;
    const safeFamily = Object.hasOwn(FAMILIES, family) ? family : FALLBACK_LABEL;
    const safeScope = Object.hasOwn(SCOPES, scope) ? scope : FALLBACK_LABEL;
    const token = `${safeFamily}/${safeScope}#${tokens.size + 1}`;
    tokens.set(key, token);
    return token;
  };
}

/** Gleiche Foundation → gleiches Ordinal `f1`, `f2`, … in der Reihenfolge des ersten Auftretens. */
function createOrdinals(): (foundation: string) => string {
  const ordinals = new Map<string, string>();
  return (foundation) => {
    const known = ordinals.get(foundation);
    if (known !== undefined) return known;
    const ordinal = `f${ordinals.size + 1}`;
    ordinals.set(foundation, ordinal);
    return ordinal;
  };
}

// Schicht 1 (Muster) redigiert bewusst GROSSZÜGIG – keine \b-Grenzen, keine Bereichsprüfung:
// eine angeklebte Adresse ("Fehlercode192.0.2.55war") darf nie überleben, notfalls auf Kosten von
// ein paar mitgerissenen Nachbarzeichen. Schicht 2 (`scrubKnownAddresses`) ist das Sicherheitsnetz
// danach: jede bekannte gathered[]-Adresse, die trotzdem noch im Text steht, wird wörtlich ersetzt.
// Bewusst ohne Lookbehind und ohne benannte Gruppen (ältere Safari-Versionen scheitern daran schon
// beim Parsen des Bundles) und nur mit BEGRENZTEN Zeichen-Wiederholungen: ein unbegrenzter Lauf vor
// einem festen Schluss (".local", ":") kostet auf leerraumfreiem Text quadratische Zeit.

/** Weicher Trennstrich, Nullbreiten-Zeichen und -Marken, BOM: unsichtbar, zerlegen aber jedes Muster. */
const INVISIBLE_PATTERN = /[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g;
/** Der GANZE gepunktete Ziffernlauf ist ein Token – sonst bleiben bei "1.2.3.192.0.2.10" Oktette der Adresse stehen. */
const IPV4_PATTERN = /\d{1,3}(?:\.\d{1,3}){3,}/g;
/** Alles außer Leerraum/Satzzeichen bis einschließlich ".local" – auch Umlaute im Namen selbst. 253 = maximale DNS-Namenslänge. */
const MDNS_PATTERN = /[^\s,;()<>[\]{}"']{1,253}\.local/gi;
/** Hex-Wörter mit mindestens zwei Doppelpunkten (plus optionaler Zonen-ID). Die Gruppen-ANZAHL bleibt offen: ein langer Lauf ist EIN Wort. */
const IPV6_WORD_PATTERN = /[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}(?:%[0-9a-z]{1,32})?/gi;
/** Die einzige Ausnahme vom IPv6-Muster: eine echte Uhrzeit. Mit angeklebter Zone ist es keine mehr. */
const CLOCK_TIME = /^\d{1,2}:\d{1,2}:\d{1,2}$/;
/** Kopf des eigenen Payload-Texts ("MB1.<modus>.") – der Rumpf wird von Hand abgelaufen, siehe `payloadEnd`. */
const PAYLOAD_HEAD_PATTERN = /MB1\.[a-z]\./gi;
const BASE64URL_CHAR = /[A-Za-z0-9_-]/;
const WHITESPACE_CHAR = /\s/;
/** Ab dieser Länge gilt ein durch Leerraum abgesetztes base64url-Stück als Fortsetzungszeile des Payloads. */
const MIN_CONTINUATION_CHARS = 16;
const PAYLOAD_REMOVED = 'payload/entfernt';
/** Eingefügte SDP-Zeilen: der Wert hinter dem Attributnamen bis zum Zeilenende (ufrag/pwd ≤ 256 Zeichen, Fingerprint ≤ 200). */
const SDP_SECRET_PATTERN = /((?:ice-ufrag|ice-pwd|fingerprint):)[^\r\n]{1,512}/gi;
const REMOVED = 'entfernt';
/** Sieht aus wie ein Token dieses Moduls – nur damit ein zweiter Durchlauf einen raddr-Wert nicht erneut ersetzt. */
const TOKEN_INSIDE = /(?:ipv4|ipv6|mdns|other)\/[a-z-]{1,16}#\d/;
const RAW_PREFIX = /^(?:a=)?candidate:/i;
/** Ein Token endet auf eine Ziffer; klebt dahinter ".0.2.10", entsteht erst NACH dem Ersetzen ein neuer Treffer. */
const MAX_SCRUB_ROUNDS = 5;

interface KnownAddress {
  pattern: RegExp;
  token: string;
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
}

/** NFKC macht aus Fullwidth-Ziffern, -Punkt und -Doppelpunkt ASCII; danach fallen die unsichtbaren Zeichen weg. */
function visibleText(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE_PATTERN, () => '');
}

/**
 * Bekannte Adressen fürs Sicherheitsnetz: längste zuerst, damit eine kürzere bekannte Adresse keine
 * längere überlappende zerschneidet; ohne Rücksicht auf Groß-/Kleinschreibung; in derselben
 * bereinigten Form wie der Text, in dem gesucht wird. Eine leere Adresse würde ÜBERALL passen.
 */
function prepareKnown(entries: ReadonlyArray<{ address: string; token: string }>): KnownAddress[] {
  return entries
    .map(({ address, token }) => ({ address: visibleText(address), token }))
    .filter(({ address }) => address !== '')
    .sort((a, b) => b.address.length - a.address.length)
    .map(({ address, token }) => ({ pattern: new RegExp(escapeForRegExp(address), 'gi'), token }));
}

/** Sicherheitsnetz nach dem Muster-Durchlauf: jede bekannte gathered[]-Adresse wird wörtlich ersetzt, wie auch immer sie angeklebt ist. */
function scrubKnownAddresses(text: string, known: readonly KnownAddress[]): string {
  let result = text;
  for (const { pattern, token } of known) result = result.replace(pattern, () => token);
  return result;
}

function skipWhile(text: string, from: number, charClass: RegExp): number {
  let index = from;
  while (index < text.length && charClass.test(text.charAt(index))) index += 1;
  return index;
}

/**
 * Ende eines Payload-Rumpfs ab `from`. `decodeDesc` ignoriert Leerraum, also gehört jedes durch Leerraum
 * abgesetzte base64url-Stück ab 16 Zeichen dazu – und nach mindestens einer solchen Fortsetzung auch
 * EIN kürzeres Stück: die letzte Zeile eines umbrochenen Payloads ist fast immer kürzer.
 * Von Hand abgelaufen statt per Regex: beliebig lang, linear, kein Rest hinter einer Längengrenze.
 */
function payloadEnd(text: string, from: number): number {
  let end = skipWhile(text, from, BASE64URL_CHAR);
  let wrapped = false;
  for (;;) {
    const chunkStart = skipWhile(text, end, WHITESPACE_CHAR);
    if (chunkStart === end) return end;
    const chunkEnd = skipWhile(text, chunkStart, BASE64URL_CHAR);
    if (chunkEnd - chunkStart >= MIN_CONTINUATION_CHARS) {
      end = chunkEnd;
      wrapped = true;
    } else {
      return wrapped && chunkEnd > chunkStart ? chunkEnd : end;
    }
  }
}

/** Der eigene Payload-Text enthält Adressen, ufrag und pwd – nur eben base64url-verpackt. */
function scrubPayloads(text: string): string {
  let result = '';
  let done = 0;
  for (const head of text.matchAll(PAYLOAD_HEAD_PATTERN)) {
    const headEnd = head.index + head[0].length;
    // Ein Kopf, der in einem schon geschluckten Stück beginnt, verlängert nur den laufenden Treffer.
    if (head.index >= done) result += `${text.slice(done, head.index)}${PAYLOAD_REMOVED}`;
    done = Math.max(done, payloadEnd(text, headEnd));
  }
  return result + text.slice(done);
}

function scrubOnce(text: string, tokenFor: TokenFor, known: readonly KnownAddress[]): string {
  const patterned = text
    .replace(IPV4_PATTERN, (match) => tokenFor(match, 'ipv4', 'other'))
    .replace(MDNS_PATTERN, (match) => tokenFor(match, 'mdns', 'mdns'))
    .replace(IPV6_WORD_PATTERN, (match) => (CLOCK_TIME.test(match) ? match : tokenFor(match.split('%')[0] ?? match, 'ipv6', 'other')));
  return scrubKnownAddresses(patterned, known);
}

/**
 * Säubert einen beliebigen Text: unsichtbare Zeichen weg, eigener Payload-Text und SDP-Geheimnisse
 * weg, dann alles, was wie IPv4, ein `.local`-Name oder IPv6 aussieht, dann jede bekannte Adresse
 * wörtlich – wiederholt, bis sich nichts mehr ändert (so ist das Ergebnis ein Fixpunkt, und ein zweiter
 * `redactReport`-Durchlauf ändert nichts mehr).
 */
function scrubText(text: string, tokenFor: TokenFor, known: readonly KnownAddress[]): string {
  let current = scrubPayloads(visibleText(text)).replace(SDP_SECRET_PATTERN, (_match, label: string) => `${label}${REMOVED}`);
  for (let round = 0; round < MAX_SCRUB_ROUNDS; round += 1) {
    const next = scrubOnce(current, tokenFor, known);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Kandidatenzeile: `foundation component transport priority ADRESSE port typ … [raddr ADRESSE] [ufrag WERT]`.
 * Zerlegt wie `parseCandidate` (an beliebigem Leerraum), sonst stünde hinter einem Tab oder doppelten
 * Leerzeichen der falsche Wert an der erwarteten Stelle. Den Schlussdurchlauf über die ganze Zeile
 * macht `scrubStrings` – wie für jeden anderen String des Reports.
 */
function redactRaw(candidate: ParsedCandidate, ordinal: string, tokenFor: TokenFor, known: readonly KnownAddress[]): string {
  const parts = candidate.raw.trim().split(/\s+/);
  const first = parts[0] ?? '';
  if (first === '') return '';
  parts[0] = `${RAW_PREFIX.exec(first)?.[0] ?? ''}${ordinal}`;
  if (parts.length > 4) parts[4] = tokenFor(candidate.address, candidate.family, candidate.scope);
  for (let i = 5; i + 1 < parts.length; i += 1) {
    const keyword = (parts[i] ?? '').toLowerCase();
    if (keyword === 'raddr') {
      // Der Position nach eine Adresse: was kein Muster und keine bekannte Adresse trifft, wird trotzdem ersetzt.
      const value = parts[i + 1] ?? '';
      const scrubbed = scrubText(value, tokenFor, known);
      parts[i + 1] = scrubbed !== value || TOKEN_INSIDE.test(value) ? scrubbed : tokenFor(value, FALLBACK_LABEL, FALLBACK_LABEL);
    }
    if (keyword === 'ufrag') parts[i + 1] = REMOVED;
  }
  return parts.join(' ');
}

/** Diese Schlüsselpfade bleiben bytegleich – alles andere, was ein String ist, wird gesäubert. */
const EXEMPT_PATHS: readonly string[] = ['id', 'createdAt', 'buildId', 'environment.userAgent', 'environment.buildId'];

/**
 * Positivliste statt Verbotsliste: läuft JEDEN String der Kopie ab (Listen und verschachtelte
 * Objekte; Schlüssel, Zahlen und Wahrheitswerte bleiben), also auch Felder, die erst ein späterer
 * Task oder ein neuerer Build anlegt. Schreibt an Ort und Stelle: die Kopie stammt aus JSON.parse,
 * dort ist selbst ein Schlüssel "__proto__" eine gewöhnliche eigene Eigenschaft.
 */
function scrubStrings(node: unknown, path: string, scrub: (text: string) => string): unknown {
  if (typeof node === 'string') return EXEMPT_PATHS.includes(path) ? node : scrub(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) node[i] = scrubStrings(node[i], `${path}[]`, scrub);
    return node;
  }
  if (typeof node === 'object' && node !== null) {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) record[key] = scrubStrings(record[key], path === '' ? key : `${path}.${key}`, scrub);
  }
  return node;
}

/**
 * Kopie fürs öffentliche Repo: Adressen werden zu `<familie>/<scope>#n`, Foundations zu `f1`, `f2`, …
 * (ältere libwebrtc-Versionen leiten die Foundation ungesalzen aus Typ, Basisadresse und Protokoll
 * ab). Danach wird jeder String des Reports gesäubert – bytegleich bleiben nur `EXEMPT_PATHS`.
 * Zahlen, Größen und Statistik bleiben unverändert; die Eingabe wird nicht angefasst.
 */
export function redactReport(report: LabReport): LabReport {
  // Ein Report ist per Definition JSON (so liegt er auch im localStorage) – das ist die tiefe Kopie.
  const copy = JSON.parse(JSON.stringify(report)) as LabReport;
  const tokenFor = createTokenizer();
  let known: KnownAddress[] = [];
  if (copy.gather !== null) {
    // Erst alle Kandidaten-Adressen nummerieren (und als "bekannt" vormerken), dann raw: so
    // bestimmt nie ein raddr die Zählung, und das Sicherheitsnetz kennt schon jede Adresse.
    known = prepareKnown(
      copy.gather.gathered.map((candidate) => ({
        address: candidate.address,
        token: tokenFor(candidate.address, candidate.family, candidate.scope),
      })),
    );
    const ordinalFor = createOrdinals();
    for (const candidate of copy.gather.gathered) {
      const ordinal = ordinalFor(candidate.foundation);
      candidate.raw = redactRaw(candidate, ordinal, tokenFor, known);
      candidate.address = tokenFor(candidate.address, candidate.family, candidate.scope);
      candidate.foundation = ordinal;
    }
  }
  scrubStrings(copy, '', (text) => scrubText(text, tokenFor, known));
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

type Check = (value: unknown) => boolean;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString: Check = (value) => typeof value === 'string';
const isNumber: Check = (value) => typeof value === 'number';
const isBoolean: Check = (value) => typeof value === 'boolean';
const nullOr =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const listOf =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every((entry) => check(entry));
/** Objekt (kein Array), dessen genannte Felder ALLE ihre Prüfung bestehen; ein fehlendes Feld ist `undefined` und fällt durch. */
const shape = (fields: Readonly<Record<string, Check>>): Check => {
  const entries = Object.entries(fields);
  return (value) => isRecord(value) && entries.every(([key, check]) => check(value[key]));
};

const PING_STATS_SHAPE = shape({
  sent: isNumber,
  received: isNumber,
  lossPct: isNumber,
  minMs: isNumber,
  medianMs: isNumber,
  p95Ms: isNumber,
  maxMs: isNumber,
  outOfOrder: isNumber,
});

/**
 * Jedes Feld, das `reportToText`, `redactReport` oder `createTokenizer` einsetzt oder auf dem sie eine
 * Methode aufrufen – mit seinem Blatt-Typ. Eine Zeile pro Klausel; zu jeder gibt es in
 * tests/unit/lab/report.test.ts Zeilen, die genau diese Klausel brechen.
 */
const REPORT_SHAPE = shape({
  id: isString,
  createdAt: isString,
  buildId: isString,
  protoV: isNumber,
  cell: shape({ role: isString, hotspotOwner: isString, camera: isString, path: isString, device: isString }),
  environment: shape({
    userAgent: isString,
    engine: isString,
    displayMode: isString,
    secureContext: isBoolean,
    online: isBoolean,
    swControlled: isBoolean,
    buildId: isString,
    features: shape({
      rtc: isBoolean,
      compressionStream: isBoolean,
      wakeLock: isBoolean,
      barcodeDetector: isBoolean,
      barcodeFormats: listOf(isString),
      storagePersist: isBoolean,
      shareText: isBoolean,
      clipboardWrite: isBoolean,
    }),
  }),
  permissions: shape({ camera: isString, localNetwork: isString, loopbackNetwork: isString }),
  gumCalledThisSession: isBoolean,
  gather: nullOr(
    shape({
      durationMs: isNumber,
      timedOut: isBoolean,
      gathered: listOf(shape({ address: isString, raw: isString, foundation: isString, family: isString, scope: isString })),
      transmitted: isNumber,
    }),
  ),
  payloadSizes: nullOr(shape({ sdpBytes: isNumber, minimisedBytes: isNumber, packedBytes: isNumber, textChars: isNumber, compressed: isBoolean })),
  timeline: listOf(shape({ tMs: isNumber, kind: isString, detail: isString })),
  selectedPair: nullOr(
    shape({
      localType: isString,
      localProtocol: isString,
      localFamily: isString,
      localScope: isString,
      remoteType: isString,
      remoteFamily: isString,
      remoteScope: isString,
      currentRttMs: nullOr(isNumber),
    }),
  ),
  sctpMaxMessageSize: nullOr(isNumber),
  hello: nullOr(shape({ remoteProtoV: isNumber, remoteBuildId: isString, versionMatch: isBoolean })),
  ping: shape({ state: nullOr(PING_STATS_SHAPE), events: nullOr(PING_STATS_SHAPE) }),
  failures: listOf(isString),
  valid: isBoolean,
  invalidReason: nullOr(isString),
  notes: isString,
});

/** Ein echter Report ist vier Ebenen tief; der Rest ist Luft für spätere Felder wie `lockTest`. */
const MAX_REPORT_DEPTH = 8;

/**
 * Ein Feld, das die Formprüfung nicht kennt (z. B. `lockTest`), darf beliebig aussehen – aber nicht
 * beliebig TIEF: an tausenden Ebenen scheitern `JSON.stringify` und jeder rekursive Durchlauf mit
 * einem RangeError. Die Rekursion hier endet selbst nach `remaining` Ebenen.
 */
function withinDepth(value: unknown, remaining: number): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (remaining === 0) return false;
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
  return children.every((child) => withinDepth(child, remaining - 1));
}

/**
 * Formprüfung für Fremddaten aus dem Speicher (ältere, neuere oder manuell veränderte
 * localStorage-Liste): nichts, was sie durchlässt, bringt `reportToText`, `reportsToJson` oder
 * `redactReport` zum Werfen oder steht im Textbericht als `undefined`, `NaN` oder `[object Object]`.
 */
function looksLikeReport(value: unknown): value is LabReport {
  return REPORT_SHAPE(value) && withinDepth(value, MAX_REPORT_DEPTH);
}

/** Ein Eintrag, der sich nicht serialisieren lässt, liefert null statt einer Ausnahme. */
function serialise(report: LabReport): string | null {
  try {
    const text: unknown = JSON.stringify(report);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
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
      // Serialisiert wird VOR der Schleife und je Eintrag: so halbiert ausschließlich ein scheiterndes
      // setItem den Verlauf, und ein Eintrag, der sich nicht serialisieren lässt, fällt allein heraus.
      // Vergiftete gespeicherte Einträge hat read() schon aussortiert – sie verschwinden mit diesem Schreiben.
      const entries = [report, ...read().filter((other) => other.id !== report.id)]
        .map(serialise)
        .filter((text): text is string => text !== null)
        .slice(0, max);
      // Volles Quota: die ältere Hälfte weglassen und erneut versuchen – der neue Report ist der wichtigste.
      let count = entries.length;
      while (count > 0) {
        try {
          storage.setItem(REPORT_STORE_KEY, `[${entries.slice(0, count).join(',')}]`);
          return;
        } catch {
          count = Math.floor(count / 2);
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
