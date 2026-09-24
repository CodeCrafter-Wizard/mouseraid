// ICE-Kandidaten lesen, einordnen und zählen. Reine Logik: kein DOM, keine Browser-API.
// Grammatik (RFC 8839): foundation component transport priority address port "typ" type [Zusätze …]

export type AddressFamily = 'ipv4' | 'ipv6' | 'mdns' | 'other';
export type AddressScope = 'loopback' | 'link-local' | 'private' | 'cgnat' | 'ios-hotspot' | 'ula' | 'global' | 'mdns' | 'other';

export interface ParsedCandidate {
  /** Text nach "a=candidate:" – wörtlich, samt Zusatzfeldern (dieselbe Form wie `SessionDesc.candidates`). */
  raw: string;
  foundation: string;
  component: number;
  /** klein geschrieben ("udp" | "tcp"); Firefox sendet Großbuchstaben. */
  protocol: string;
  priority: number;
  /** wörtlich wie im Kandidaten. */
  address: string;
  port: number;
  type: string;
  family: AddressFamily;
  scope: AddressScope;
}

export interface CandidateSummary {
  total: number;
  host: number;
  hostRealIp: number;
  mdns: number;
  ipv4: number;
  ipv6: number;
  tcp: number;
  iosHotspot: boolean;
}

const SDP_PREFIX = 'a=candidate:';
const PREFIX = /^(?:a=)?candidate:/;
const DIGITS = /^\d+$/;
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_LOOPBACK_LONG = /^(?:0{1,4}:){7}0{0,3}1$/;
/** Ab iOS 18 gibt der iPhone-Hotspot jedem Client genau diese Adresse. */
const IOS_HOTSPOT_ADDRESS = '192.0.0.2';

/** Alle Kandidaten eines SDP: jeweils der Text nach "a=candidate:", Reihenfolge erhalten. */
export function candidatesFromSdp(sdp: string): string[] {
  return sdp
    .split(/\r?\n/)
    .filter((line) => line.startsWith(SDP_PREFIX))
    .map((line) => line.slice(SDP_PREFIX.length).trim());
}

function toInt(text: string | undefined): number | null {
  return text !== undefined && DIGITS.test(text) ? Number(text) : null;
}

function ipv4Octets(address: string): number[] | null {
  if (!DOTTED_QUAD.test(address)) return null;
  const octets = address.split('.').map((part) => Number(part));
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function ipv4Scope(address: string, octets: readonly number[]): AddressScope {
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  if (address === IOS_HOTSPOT_ADDRESS) return 'ios-hotspot';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  return 'global';
}

function ipv6Scope(address: string): AddressScope {
  if (address === '::1' || IPV6_LOOPBACK_LONG.test(address)) return 'loopback';
  const head = address.split(':')[0] ?? '';
  const first = head === '' ? 0 : Number.parseInt(head, 16);
  if ((first & 0xffc0) === 0xfe80) return 'link-local'; // fe80::/10
  if ((first & 0xfe00) === 0xfc00) return 'ula'; // fc00::/7
  return 'global';
}

function classifyAddress(address: string): { family: AddressFamily; scope: AddressScope } {
  const lower = address.toLowerCase();
  const octets = ipv4Octets(lower);
  if (octets !== null) return { family: 'ipv4', scope: ipv4Scope(lower, octets) };
  if (lower.includes(':')) return { family: 'ipv6', scope: ipv6Scope(lower) };
  if (lower.endsWith('.local')) return { family: 'mdns', scope: 'mdns' };
  return { family: 'other', scope: 'other' };
}

/** Liest einen Kandidaten; akzeptiert auch führendes "a=candidate:" / "candidate:". Unlesbares → null. */
export function parseCandidate(raw: string): ParsedCandidate | null {
  const text = raw.trim().replace(PREFIX, '').trim();
  const [foundation, componentText, protocol, priorityText, address, portText, keyword, type] = text.split(/\s+/);
  const component = toInt(componentText);
  const priority = toInt(priorityText);
  const port = toInt(portText);
  if (foundation === undefined || foundation === '' || protocol === undefined || address === undefined) return null;
  if (component === null || priority === null || port === null || port > 65535) return null;
  if (keyword !== 'typ' || type === undefined) return null;
  return {
    raw: text,
    foundation,
    component,
    protocol: protocol.toLowerCase(),
    priority,
    address,
    port,
    type,
    ...classifyAddress(address),
  };
}

export interface QrPassCriterion {
  pass: boolean;
  realIp: number;
  mdns: number;
}

/**
 * Spec-Kriterium für den QR-Pfad: mindestens ein Host-Kandidat mit echter IP und kein einziger
 * verschleierter mDNS-Name. Rein – der Chip in der Oberfläche zeigt nur an, was hier herauskommt.
 * Ein mDNS-Name zählt über ALLE Kandidaten, nicht nur über die Host-Kandidaten: auch ein
 * verschleierter Reflexiv-Kandidat verrät, dass der Browser noch verschleiert.
 */
export function qrPassCriterion(list: readonly ParsedCandidate[]): QrPassCriterion {
  const summary = summariseCandidates(list);
  return { pass: summary.hostRealIp > 0 && summary.mdns === 0, realIp: summary.hostRealIp, mdns: summary.mdns };
}

export function summariseCandidates(list: readonly ParsedCandidate[]): CandidateSummary {
  const hosts = list.filter((candidate) => candidate.type === 'host');
  return {
    total: list.length,
    host: hosts.length,
    hostRealIp: hosts.filter((candidate) => candidate.family === 'ipv4' || candidate.family === 'ipv6').length,
    mdns: list.filter((candidate) => candidate.family === 'mdns').length,
    ipv4: list.filter((candidate) => candidate.family === 'ipv4').length,
    ipv6: list.filter((candidate) => candidate.family === 'ipv6').length,
    tcp: list.filter((candidate) => candidate.protocol === 'tcp').length,
    iosHotspot: list.some((candidate) => candidate.scope === 'ios-hotspot'),
  };
}
