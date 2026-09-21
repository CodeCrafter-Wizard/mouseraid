// Signalisierung als Text: SDP → sitzungsspezifische Teile (SessionDesc) → kompaktes JSON →
// deflate-raw → base64url → "MB1.<modus>.<rumpf>". Der Codec filtert KEINE Kandidaten.
import { deflateRaw, fromBase64Url, inflateRaw, supportsDeflateRaw, toBase64Url } from './compress';
import { renderSdp } from './sdpTemplate';

export const CODEC_VERSION = 1;
export type SdpRole = 'offer' | 'answer';
type Setup = 'actpass' | 'active' | 'passive';

export interface SessionDesc {
  codecV: number;
  protoV: number;
  role: SdpRole;
  slot: number;
  nonce: number;
  ufrag: string;
  pwd: string;
  /** sha-256 als "AB:CD:…" in Großbuchstaben. */
  fingerprint: string;
  setup: Setup;
  sctpPort: number;
  maxMessageSize: number | null;
  /** Text nach "a=candidate:", wörtlich, ALLE, Reihenfolge erhalten. */
  candidates: string[];
}

export type CodecErrorCode = 'empty' | 'prefix' | 'base64' | 'inflate' | 'json' | 'shape' | 'codec-version' | 'sdp';

/** `message` ist Diagnose-Text für Reports; die Oberfläche zeigt Texte aus strings.ts anhand von `code`. */
export class CodecError extends Error {
  readonly code: CodecErrorCode;

  constructor(code: CodecErrorCode, message: string) {
    super(message);
    this.name = 'CodecError';
    this.code = code;
  }
}

export interface PayloadSizes {
  sdpBytes: number;
  minimisedBytes: number;
  packedBytes: number;
  textChars: number;
  compressed: boolean;
}

const DEFAULT_SCTP_PORT = 5000;
const CANDIDATE_PREFIX = 'a=candidate:';
const SETUPS: readonly Setup[] = ['actpass', 'active', 'passive'];
const SETUP_TO_SHORT: Record<Setup, string> = { actpass: 'x', active: 'a', passive: 'p' };
const SHORT_TO_SETUP = new Map<unknown, Setup>([['x', 'actpass'], ['a', 'active'], ['p', 'passive']]);
const SHORT_TO_ROLE = new Map<unknown, SdpRole>([['o', 'offer'], ['a', 'answer']]);

function fingerprintToBytes(fingerprint: string): Uint8Array {
  if (!/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/.test(fingerprint)) {
    throw new CodecError('sdp', 'Fingerprint ist kein sha-256-Wert aus 32 Bytes');
  }
  return Uint8Array.from(fingerprint.split(':'), (pair) => Number.parseInt(pair, 16));
}

function bytesToFingerprint(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** Zieht die sitzungsspezifischen Teile aus einem SDP. Attribute dürfen auf Medien- ODER Session-Ebene stehen. */
export function minimise(sdp: string, meta: { protoV: number; role: SdpRole; slot: number; nonce: number }): SessionDesc {
  const lines = sdp.split(/\r?\n/).filter((line) => line !== '');
  const mediaStart = lines.findIndex((line) => line.startsWith('m=application'));
  if (mediaStart < 0) throw new CodecError('sdp', 'SDP ohne m=application-Abschnitt');
  const mediaEnd = lines.findIndex((line, index) => index > mediaStart && line.startsWith('m='));
  const media = lines.slice(mediaStart, mediaEnd < 0 ? lines.length : mediaEnd);
  const session = lines.slice(0, lines.findIndex((line) => line.startsWith('m=')));

  // Medien-Ebene gewinnt; Firefox legt z. B. den Fingerprint auf die Session-Ebene.
  const attributes = (name: string): string[] => {
    const prefix = `a=${name}:`;
    return [...media, ...session].filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
  };
  const numberAttribute = (name: string): number | null => {
    const value = attributes(name)[0];
    if (value === undefined) return null;
    if (!/^\d{1,16}$/.test(value)) throw new CodecError('sdp', `a=${name} ist keine Zahl`);
    return Number(value);
  };

  const ufrag = attributes('ice-ufrag')[0];
  const pwd = attributes('ice-pwd')[0];
  if (ufrag === undefined || ufrag === '' || pwd === undefined || pwd === '') {
    throw new CodecError('sdp', 'SDP ohne ice-ufrag/ice-pwd');
  }
  const sha256 = attributes('fingerprint').find((value) => /^sha-256\s/i.test(value));
  if (sha256 === undefined) throw new CodecError('sdp', 'SDP ohne sha-256-Fingerprint');
  const fingerprint = sha256.slice('sha-256'.length).trim().toUpperCase();
  fingerprintToBytes(fingerprint);
  const setup = SETUPS.find((value) => value === attributes('setup')[0]);
  if (setup === undefined) throw new CodecError('sdp', 'SDP ohne brauchbares a=setup');

  return {
    codecV: CODEC_VERSION,
    protoV: meta.protoV,
    role: meta.role,
    slot: meta.slot,
    nonce: meta.nonce,
    ufrag,
    pwd,
    fingerprint,
    setup,
    sctpPort: numberAttribute('sctp-port') ?? DEFAULT_SCTP_PORT,
    maxMessageSize: numberAttribute('max-message-size'),
    candidates: lines.filter((line) => line.startsWith(CANDIDATE_PREFIX)).map((line) => line.slice(CANDIDATE_PREFIX.length)),
  };
}

/** Vollständiges SDP aus der Beschreibung; die Session-ID ist die Nonce. */
export function rebuildSdp(desc: SessionDesc): string {
  return renderSdp({
    sessionId: desc.nonce,
    ufrag: desc.ufrag,
    pwd: desc.pwd,
    fingerprint: desc.fingerprint,
    setup: desc.setup,
    sctpPort: desc.sctpPort,
    maxMessageSize: desc.maxMessageSize,
    candidates: desc.candidates,
  });
}

export async function encodeDesc(
  desc: SessionDesc,
  options?: { compress?: boolean },
): Promise<{ text: string; sizes: Omit<PayloadSizes, 'sdpBytes'> }> {
  const compactJson = JSON.stringify({
    v: desc.codecV,
    p: desc.protoV,
    r: desc.role === 'offer' ? 'o' : 'a',
    s: desc.slot,
    n: desc.nonce,
    u: desc.ufrag,
    w: desc.pwd,
    f: toBase64Url(fingerprintToBytes(desc.fingerprint)),
    t: SETUP_TO_SHORT[desc.setup],
    k: desc.sctpPort,
    m: desc.maxMessageSize,
    c: desc.candidates,
  });
  const minimised = new TextEncoder().encode(compactJson);
  const compressed = options?.compress !== false && supportsDeflateRaw();
  const packed = compressed ? await deflateRaw(minimised) : minimised;
  const text = `MB1.${compressed ? 'd' : 'p'}.${toBase64Url(packed)}`;
  return {
    text,
    sizes: { minimisedBytes: minimised.length, packedBytes: packed.length, textChars: text.length, compressed },
  };
}

const isUint = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

/** Nicht leer und ohne Zeilenumbruch – sonst könnte ein eingefügter Code fremde SDP-Zeilen einschleusen. */
const isLine = (value: unknown): value is string => typeof value === 'string' && value !== '' && !/[\r\n]/.test(value);

function fromCompact(value: unknown): SessionDesc {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CodecError('shape', 'Payload ist kein JSON-Objekt');
  }
  const compact = value as Record<string, unknown>;
  if (typeof compact.v !== 'number') throw new CodecError('shape', 'Feld v (Codec-Version) fehlt');
  // Vor allen anderen Feldern: eine neuere Codec-Version darf eine andere Form haben.
  if (compact.v !== CODEC_VERSION) {
    throw new CodecError('codec-version', `Codec-Version ${compact.v} statt ${CODEC_VERSION}`);
  }
  const bad = (field: string): CodecError => new CodecError('shape', `Feld ${field} fehlt oder ist ungültig`);

  const role = SHORT_TO_ROLE.get(compact.r);
  const setup = SHORT_TO_SETUP.get(compact.t);
  if (!isUint(compact.p, 0xffff)) throw bad('p');
  if (role === undefined) throw bad('r');
  if (!isUint(compact.s, 3)) throw bad('s');
  if (!isUint(compact.n, 0xffffffff)) throw bad('n');
  if (!isLine(compact.u)) throw bad('u');
  if (!isLine(compact.w)) throw bad('w');
  if (setup === undefined) throw bad('t');
  if (!isUint(compact.k, 0xffff)) throw bad('k');
  if (compact.m !== null && !isUint(compact.m, Number.MAX_SAFE_INTEGER)) throw bad('m');
  if (!Array.isArray(compact.c) || !compact.c.every(isLine)) throw bad('c');

  let fingerprintBytes: Uint8Array;
  try {
    fingerprintBytes = fromBase64Url(typeof compact.f === 'string' ? compact.f : '');
  } catch {
    throw bad('f');
  }
  if (fingerprintBytes.length !== 32) throw bad('f');

  return {
    codecV: compact.v,
    protoV: compact.p,
    role,
    slot: compact.s,
    nonce: compact.n,
    ufrag: compact.u,
    pwd: compact.w,
    fingerprint: bytesToFingerprint(fingerprintBytes),
    setup,
    sctpPort: compact.k,
    maxMessageSize: compact.m,
    candidates: [...compact.c],
  };
}

/** Liest einen eingefügten Payload-Text. Leerraum und Zeilenumbrüche werden ignoriert. */
export async function decodeDesc(text: string): Promise<SessionDesc> {
  const stripped = text.replace(/\s+/g, '');
  if (stripped === '') throw new CodecError('empty', 'Kein Code eingegeben');
  const match = /^MB1\.([dp])\.(.*)$/.exec(stripped);
  if (match === null) throw new CodecError('prefix', 'Text beginnt nicht mit MB1.d. oder MB1.p.');
  const mode = match[1];
  const body = match[2] ?? '';

  let packed: Uint8Array;
  try {
    packed = fromBase64Url(body);
  } catch {
    throw new CodecError('base64', 'Rumpf ist kein base64url');
  }
  if (packed.length === 0) throw new CodecError('base64', 'Rumpf ist leer');

  let minimised = packed;
  if (mode === 'd') {
    if (!supportsDeflateRaw()) throw new CodecError('inflate', 'Dieser Browser kann komprimierte Codes nicht entpacken');
    try {
      minimised = await inflateRaw(packed);
    } catch {
      throw new CodecError('inflate', 'Rumpf lässt sich nicht entpacken');
    }
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(minimised));
  } catch {
    throw new CodecError('json', 'Inhalt ist kein JSON');
  }
  return fromCompact(value);
}
