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
    // `Object.hasOwn` ist ES2022-Bibliothek: Safari < 15.4 kennt es nicht und würde hier werfen –
    // also genau auf den alten iPhones, die das Labor vermessen soll. Gleiche Bedeutung, ohne neue API.
    const safeFamily = Object.prototype.hasOwnProperty.call(FAMILIES, family) ? family : FALLBACK_LABEL;
    const safeScope = Object.prototype.hasOwnProperty.call(SCOPES, scope) ? scope : FALLBACK_LABEL;
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

/**
 * Unsichtbare Zeichen: weicher Trennstrich, Nullbreiten-Zeichen und -Marken, Bidi-Steuerzeichen,
 * Füllzeichen, Variantenselektoren, BOM und der TAG-Block. Für den Menschen unsichtbar, zerlegen
 * aber jedes Muster – eine Adresse mit einem davon in der Mitte bliebe sonst voll lesbar.
 * Als Codepunkt-Bereiche aufgeschrieben statt als Regex-Literal: in einem Literal stünden
 * Kombinationszeichen (U+034F, U+1160 …) nebeneinander, was ESLint zu Recht als EIN zusammengesetztes
 * Schriftzeichen liest (`no-misleading-character-class`) – gemeint ist aber jedes Zeichen für sich.
 * So steht auch kein einziges dieser Zeichen wörtlich im Quelltext.
 */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
];
const codeToEscape = (code: number): string => `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
const rangeToClass = ([from, to]: readonly [number, number]): string =>
  from === to ? codeToEscape(from) : `${codeToEscape(from)}-${codeToEscape(to)}`;
/** TAG-Block (U+E0000 …) als Ersatzzeichen-Paar – so braucht das Muster kein `u`-Flag. */
const TAG_PAIR = `${codeToEscape(0xdb40)}[${codeToEscape(0xdc00)}-${codeToEscape(0xdfff)}]`;
const INVISIBLE_PATTERN = new RegExp(`[${INVISIBLE_RANGES.map(rangeToClass).join('')}]|${TAG_PAIR}`, 'g');
/**
 * Der GANZE gepunktete Ziffernlauf ist ein Token – sonst bleiben bei "1.2.3.192.0.2.10" Oktette der
 * Adresse stehen. Die Gruppen-ANZAHL ist gedeckelt: ein Lauf von mehreren Megabyte lässt sonst den
 * Backtracking-Stack der RegExp überlaufen (RangeError). Ein längerer Lauf wird als mehrere
 * anliegende Tokens verbraucht – auch dann bleibt kein Adressrest übrig.
 */
const IPV4_PATTERN = /\d{1,3}(?:\.\d{1,3}){3,4096}/g;
/** Alles außer Leerraum/Satzzeichen bis einschließlich ".local" – auch Umlaute im Namen selbst. 253 = maximale DNS-Namenslänge. */
const MDNS_PATTERN = /[^\s,;()<>[\]{}"']{1,253}\.local/gi;
/** Hex-Wörter mit mindestens zwei Doppelpunkten (plus optionaler Zonen-ID); Gruppen-Anzahl gedeckelt wie bei IPv4. */
const IPV6_WORD_PATTERN = /[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,4096}(?:%[0-9a-z]{1,32})?/gi;
/** Die einzige Ausnahme vom IPv6-Muster: eine echte Uhrzeit. Mit angeklebter Zone ist es keine mehr. */
const CLOCK_TIME = /^\d{1,2}:\d{1,2}:\d{1,2}$/;
/** Eigener Payload-Text: Kopf "MB1.<modus>." samt dem base64url-Rumpf dahinter. */
const PAYLOAD_PATTERN = /MB1\.[a-z]\.[A-Za-z0-9_-]{0,4096}/gi;
/** Ein base64url-Lauf ab 32 Zeichen hat in einem Laborbericht nichts zu suchen: Build-IDs haben 8 Zeichen, Gerätenamen höchstens 24. */
const BASE64URL_RUN_PATTERN = /[A-Za-z0-9_-]{32,4096}/g;
const PAYLOAD_REMOVED = 'payload/entfernt';
// Die vier Geheimnis-Regeln. Ihre Wert-Grenzen sind großzügig (4096) statt knapp bemessen: eine
// Grenze, die MITTEN in einem Wert endet, ließe genau den Rest stehen, den sie löschen soll – bei
// eingefügten einzeiligen SDP (Umbrüche als Text „\r\n“ statt als echte Zeilenenden) sind das
// schnell mehrere hundert Zeichen. Begrenzt bleiben sie trotzdem: jede Wiederholung hat eine feste Obergrenze, der Durchlauf
// bleibt linear. Ein Wert über 4096 Zeichen wird weiterhin angeschnitten – weil diese Regeln seit
// Fix-Runde 4 HINTER dem Adress-Durchlauf laufen, kann ein Schnitt aber nur noch ein fertiges Token
// treffen, nie eine Adresse. Prozentkodiertes SDP („ice-ufrag%3A…“, „ufrag%20…“) trifft keine der
// Regeln – ausdrücklich außerhalb des Auftrags, ein Laborbericht enthält keine URL-kodierten SDPs.
/** Eingefügte SDP-Zeilen: der Wert hinter dem Attributnamen bis zum Zeilenende (ufrag/pwd ≤ 256 Zeichen, Fingerprint ≤ 200). */
const SDP_SECRET_PATTERN = /((?:ice-ufrag|ice-pwd|fingerprint):)[^\r\n]{1,4096}/gi;
/** "ufrag <wert>" aus einer eingefügten Kandidatenzeile – dieselbe Zusage wie in gathered[].raw, aber für JEDEN String. */
const UFRAG_PATTERN = /(\bufrag\s{1,8})\S{1,4096}/gi;
/** Dieselbe Angabe in JSON-Form, wie RTCIceCandidate sie liefert: usernameFragment":"…", =… oder : … */
const USERNAME_FRAGMENT_PATTERN = /(usernameFragment"?\s{0,4}[:=]\s{0,4}"?)[^\s",}]{1,4096}/gi;
/** Foundation am Anfang einer Kandidatenzeile (ältere libwebrtc leiten sie ungesalzen aus Typ, Basisadresse und Protokoll ab). */
const CANDIDATE_FOUNDATION_PATTERN = /((?:a=)?candidate:[ \t]{0,8})(\S{1,4096})/gi;
/** Ein von uns vergebenes Ordinal ist schon sauber und bleibt stehen – sonst überschriebe die allgemeine Regel es mit "entfernt". */
const ORDINAL_PATTERN = /^f\d{1,9}$/;
const REMOVED = 'entfernt';
/** Sieht aus wie ein Ergebnis dieses Moduls – nur damit ein zweiter Durchlauf einen raddr-Wert nicht erneut ersetzt. */
const TOKEN_INSIDE = /(?:ipv4|ipv6|mdns|other)\/[a-z-]{1,16}#\d|(?:payload\/)?entfernt/;
const RAW_PREFIX = /^(?:a=)?candidate:/i;
/** Leerraum hinter dem Präfix: `parseCandidate` erzeugt das nie, Fremddaten schon – sonst stünde jedes Feld um eins verschoben. */
const RAW_PREFIX_SPACE = /^((?:a=)?candidate:)\s+/i;
/** Ein Token endet auf eine Ziffer; klebt dahinter ".0.2.10", entsteht erst NACH dem Ersetzen ein neuer Treffer. */
const MAX_SCRUB_ROUNDS = 5;
/** Kürzeres ist keine Adresse – als bekannte Adresse würde es überall im Text zuschlagen (eine leere sowieso). */
const MIN_KNOWN_LENGTH = 3;
/** Eine "Adresse", die wörtlich wie ein Bestandteil unserer Tokens aussieht, zerfräße als Suchmuster die Tokens selbst. */
const TOKEN_WORD = /^(?:f\d{1,9}|entfernt|payload|ipv4|ipv6|mdns|other|loopback|link-local|private|cgnat|ios-hotspot|ula|global)$/i;

interface KnownAddress {
  /** `null`, wenn `new RegExp` die Adresse nicht übersetzen konnte – dann wird `address` wörtlich ersetzt. */
  pattern: RegExp | null;
  address: string;
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
 * bereinigten Form wie der Text, in dem gesucht wird. Zu kurze und token-förmige "Adressen" fallen
 * heraus: sie stünden sonst als Suchmuster für jedes Vorkommen ihrer Zeichen im Text (eine leere
 * Adresse für JEDE Stelle) und zerfräßen die eigenen Tokens. Im Kandidaten selbst werden sie
 * trotzdem der Position nach ersetzt.
 */
function prepareKnown(entries: ReadonlyArray<{ address: string; token: string }>): KnownAddress[] {
  return entries
    .map(({ address, token }) => ({ address: visibleText(address), token }))
    .filter(({ address }) => address.length >= MIN_KNOWN_LENGTH && !TOKEN_WORD.test(address))
    .sort((a, b) => b.address.length - a.address.length)
    .map(({ address, token }) => {
      try {
        const pattern = new RegExp(escapeForRegExp(address), 'gi');
        // V8 übersetzt eine RegExp erst bei der ERSTEN Benutzung: ohne diesen Probelauf verlässt
        // `new RegExp` den try-Block ohne Fehler und „Regular expression too large“ flöge erst
        // in `scrubKnownAddresses` – der Rückfall unten wäre toter Code.
        pattern.test('');
        return { pattern, address, token };
      } catch {
        // Doppelter Schutz: die Formprüfung lässt schon keine Adresse über 255 Zeichen durch, aber
        // eine zu große RegExp darf `redactReport` unter keinen Umständen zum Werfen bringen.
        return { pattern: null, address, token };
      }
    });
}

/** Sicherheitsnetz nach dem Muster-Durchlauf: jede bekannte gathered[]-Adresse wird wörtlich ersetzt, wie auch immer sie angeklebt ist. */
function scrubKnownAddresses(text: string, known: readonly KnownAddress[]): string {
  let result = text;
  // Ersetzer-FUNKTION statt Zeichenkette: heute können Tokens kein "$" enthalten (Positivliste plus
  // Ziffern), die Funktion ist also doppelter Schutz – und bleibt es, wenn die Positivliste je fällt.
  for (const { pattern, address, token } of known) {
    result = pattern === null ? result.split(address).join(token) : result.replace(pattern, () => token);
  }
  return result;
}

/**
 * Der eigene Payload-Text enthält Adressen, ufrag und pwd – nur eben base64url-verpackt. Zwei
 * einfache Regeln statt des Fortsetzungs-Läufers aus Runde 2 (der das erste Oktett der folgenden
 * Adresse mitfraß): (a) Kopf "MB1.<modus>." samt Rumpf, (b) JEDER base64url-Lauf ab 32 Zeichen.
 * (b) deckt einen Rumpf ohne Kopf, einen vom Rumpf getrennten Kopf und umbrochene Zeilen ab.
 * Stücke unter 32 Zeichen (sehr schmale Umbrüche) bleiben stehen – für sich sind sie nicht
 * dekodierbar, und das ist hier ausdrücklich außerhalb des Auftrags. Läuft als LETZTER Schritt von
 * `scrubText`: base64url kennt weder "." noch ":", also kann kein Adressmuster einen Rumpf
 * zerschneiden, und eine Adresse hinter einem Payload ist längst ein Token (Tokens sind kürzer als
 * 32 Zeichen und enthalten "/" oder "#", werden also nie getroffen). Ein Token, an dem ein ≥ 32
 * Zeichen langer Lauf KLEBT, verliert dabei sein Ordinal bzw. seine Familie („mdns/mdns#payload/
 * entfernt“, „payload/entfernt/global#1“): bewusst hingenommen – das ist zu viel Schwärzung, kein
 * Leck, und die Alternative wäre eine Ausnahme, durch die ein Payload-Rumpf schlüpfen könnte.
 */
function scrubPayloads(text: string): string {
  return text.replace(PAYLOAD_PATTERN, () => PAYLOAD_REMOVED).replace(BASE64URL_RUN_PATTERN, () => PAYLOAD_REMOVED);
}

/**
 * Kandidaten-Geheimnisse, die in JEDEM String stehen können – nicht nur in gathered[].raw.
 * Läuft NACH dem Adress-Durchlauf (siehe `scrubText`), damit keine Wert-Grenze eine Adresse
 * anschneidet; ein schon vergebenes Ordinal `f<n>` bleibt dabei stehen.
 */
function scrubCandidateSecrets(text: string): string {
  return text
    .replace(SDP_SECRET_PATTERN, (_match, label: string) => `${label}${REMOVED}`)
    .replace(UFRAG_PATTERN, (_match, label: string) => `${label}${REMOVED}`)
    .replace(USERNAME_FRAGMENT_PATTERN, (_match, label: string) => `${label}${REMOVED}`)
    .replace(CANDIDATE_FOUNDATION_PATTERN, (_match, prefix: string, foundation: string) =>
      ORDINAL_PATTERN.test(foundation) ? `${prefix}${foundation}` : `${prefix}${REMOVED}`,
    );
}

function scrubOnce(text: string, tokenFor: TokenFor, known: readonly KnownAddress[]): string {
  const patterned = text
    .replace(IPV4_PATTERN, (match) => tokenFor(match, 'ipv4', 'other'))
    .replace(MDNS_PATTERN, (match) => tokenFor(match, 'mdns', 'mdns'))
    .replace(IPV6_WORD_PATTERN, (match) => (CLOCK_TIME.test(match) ? match : tokenFor(match.split('%')[0] ?? match, 'ipv6', 'other')));
  return scrubKnownAddresses(patterned, known);
}

/**
 * Säubert einen beliebigen Text, in genau dieser Reihenfolge:
 * 1. normalisieren (NFKC, unsichtbare Zeichen weg),
 * 2. Schicht 1 (Muster) und Schicht 2 (bekannte Adressen), wiederholt bis zum Fixpunkt – so ändert
 *    ein zweiter `redactReport`-Durchlauf nichts mehr,
 * 3. DANACH die Geheimnis-Regeln (SDP, ufrag/usernameFragment, Kandidaten-Foundation),
 * 4. ZULETZT der Payload-Durchlauf.
 * Beide Regelsätze mit begrenzten Wert-Längen laufen bewusst HINTER den Adressen: liefe einer davor,
 * endete sein Fenster irgendwann mitten in einer Adresse, und der Rest („…entfernt0.113.77“) träfe
 * danach kein Adressmuster mehr und wäre auch für Schicht 2 keine bekannte Adresse. Hinter dem
 * Adress-Durchlauf kann ein Schnitt nur noch ein fertiges Token anschneiden. Preis dafür: ein
 * Geheimnis- oder Payload-Treffer, der einen feindlich angeklebten Lauf mitnimmt, kann das Ordinal
 * oder die Familie eines Tokens beschädigen, und ein paar feindliche Eingaben stehen erst nach dem
 * ZWEITEN `redactReport`-Durchlauf still (Schritt 3 und 4 werden nicht erneut abgetastet). Beides
 * kostet nur Lesbarkeit: es entsteht dabei nie wieder lesbarer Adresstext.
 */
function scrubText(text: string, tokenFor: TokenFor, known: readonly KnownAddress[]): string {
  let current = visibleText(text);
  for (let round = 0; round < MAX_SCRUB_ROUNDS; round += 1) {
    const next = scrubOnce(current, tokenFor, known);
    if (next === current) break;
    current = next;
  }
  return scrubPayloads(scrubCandidateSecrets(current));
}

/**
 * Kandidatenzeile: `foundation component transport priority ADRESSE port typ … [raddr ADRESSE] [ufrag WERT]`.
 * Erst normalisieren (sonst rettet ein Nullbreiten-Zeichen am Schlüsselwort den ufrag-Wert), dann ein
 * Leerzeichen hinter "candidate:" schließen, dann zerlegen wie `parseCandidate` (an beliebigem
 * Leerraum) – sonst stünde hinter einem Tab oder doppelten Leerzeichen der falsche Wert an der
 * erwarteten Stelle. Den Schlussdurchlauf über die ganze Zeile macht `scrubStrings` – wie für jeden
 * anderen String des Reports.
 */
function redactRaw(candidate: ParsedCandidate, ordinal: string, tokenFor: TokenFor, known: readonly KnownAddress[]): string {
  const parts = visibleText(candidate.raw)
    .trim()
    .replace(RAW_PREFIX_SPACE, (_match, prefix: string) => prefix)
    .split(/\s+/);
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

/**
 * Diese Schlüsselpfade bleiben bytegleich. Verglichen werden die SEGMENTE des Pfads, nicht ein mit
 * Punkten zusammengesetzter Text: ein Schlüssel, der wörtlich "environment.userAgent" heißt (so
 * etwas kommt nur aus fremden Speicherdaten), ist damit NICHT ausgenommen.
 */
const EXEMPT_PATHS: ReadonlyArray<readonly string[]> = [['id'], ['createdAt'], ['buildId'], ['environment', 'userAgent'], ['environment', 'buildId']];
/** Platzhalter-Segment für einen Listeneintrag: in keinem ausgenommenen Pfad enthalten. */
const ARRAY_SEGMENT = '[]';

const isExempt = (path: readonly string[]): boolean =>
  EXEMPT_PATHS.some((exempt) => exempt.length === path.length && exempt.every((segment, index) => segment === path[index]));

/**
 * Positivliste statt Verbotsliste: läuft JEDEN String der Kopie ab (Listen und verschachtelte
 * Objekte; Schlüssel, Zahlen und Wahrheitswerte bleiben), also auch Felder, die erst ein späterer
 * Task oder ein neuerer Build anlegt. Schreibt an Ort und Stelle: die Kopie stammt aus JSON.parse,
 * dort ist selbst ein Schlüssel "__proto__" eine gewöhnliche eigene Eigenschaft.
 */
function scrubStrings(node: unknown, path: readonly string[], scrub: (text: string) => string): unknown {
  if (typeof node === 'string') return isExempt(path) ? node : scrub(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) node[i] = scrubStrings(node[i], [...path, ARRAY_SEGMENT], scrub);
    return node;
  }
  if (typeof node === 'object' && node !== null) {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) record[key] = scrubStrings(record[key], [...path, key], scrub);
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
  scrubStrings(copy, [], (text) => scrubText(text, tokenFor, known));
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

// `!Array.isArray` ist doppelter Schutz: jede Form hat Pflichtfelder, an denen ein Array ohnehin
// scheitert. Die Klausel bleibt, damit "ein Array ist kein Report" nicht von der Feldliste abhängt.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString: Check = (value) => typeof value === 'string';
/** Blätter, die in einer RegExp oder in einem Token landen: gedeckelt (DNS-Maximum sind 253 Zeichen), sonst kann `new RegExp` platzen. */
const MAX_GUARDED_LENGTH = 255;
const isShortString: Check = (value) => typeof value === 'string' && value.length <= MAX_GUARDED_LENGTH;
/** `Infinity` und `NaN` überstehen JSON.parse ("1e999"), nicht aber JSON.stringify – sie würden als Datenmüll im Bericht landen. */
const isNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value);
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
      gathered: listOf(shape({ address: isShortString, raw: isString, foundation: isShortString, family: isShortString, scope: isShortString })),
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
  /** Aus dem gespeicherten Text die gültigen Reports – defekte Daten ergeben eine leere Liste. */
  const parse = (stored: string | null): LabReport[] => {
    try {
      const parsed: unknown = JSON.parse(stored ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(looksLikeReport) : [];
    } catch {
      return [];
    }
  };

  const read = (): LabReport[] => {
    try {
      return parse(storage.getItem(REPORT_STORE_KEY));
    } catch {
      return [];
    }
  };

  return {
    list: read,
    add(report) {
      // getItem in einem EIGENEN try: scheitert das Lesen, wird gar nicht geschrieben. Sonst ersetzte
      // ein vorübergehender Lesefehler den ganzen Verlauf durch diesen einen Report; der Aufrufer
      // merkt am Rücklesen, dass nichts gespeichert wurde.
      let stored: string | null;
      try {
        stored = storage.getItem(REPORT_STORE_KEY);
      } catch {
        return;
      }
      // Serialisiert wird VOR der Schleife und je Eintrag: so halbiert ausschließlich ein scheiterndes
      // setItem den Verlauf, und ein Eintrag, der sich nicht serialisieren lässt, fällt allein heraus.
      // Vergiftete gespeicherte Einträge hat parse() schon aussortiert – sie verschwinden mit diesem Schreiben.
      const entries = [report, ...parse(stored).filter((other) => other.id !== report.id)]
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
