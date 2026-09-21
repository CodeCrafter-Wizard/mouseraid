/** Version des Spielprotokolls. Beide Seiten tauschen sie im `hello` aus; ungleich = kein gemeinsames Spiel. */
export const PROTOCOL_VERSION = 1;

export type NetMessage =
  | { type: 'hello'; protoV: number; buildId: string }
  | { type: 'ping'; seq: number; sentAtMs: number }
  | { type: 'pong'; seq: number; sentAtMs: number };

/** Nachricht passt nicht ins Binärformat bzw. empfangene Bytes sind keine gültige Nachricht. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

// Binärformat (Big Endian): Byte 0 = Typ.
//   hello     : u16 protoV, u8 n, n Bytes UTF-8 buildId (n ≤ 64)  → 4 + n Bytes
//   ping/pong : u32 seq, f64 sentAtMs                             → 13 Bytes
const TYPE_HELLO = 1;
const TYPE_PING = 2;
const TYPE_PONG = 3;
const HELLO_HEADER_BYTES = 4;
const MAX_BUILD_ID_BYTES = 64;
const PING_BYTES = 13;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

function requireUint(value: number, max: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ProtocolError(`${field} muss eine ganze Zahl von 0 bis ${max} sein (war ${value}).`);
  }
}

function encodeHello(protoV: number, buildId: string): Uint8Array {
  requireUint(protoV, U16_MAX, 'protoV');
  const id = new TextEncoder().encode(buildId);
  if (id.length > MAX_BUILD_ID_BYTES) {
    throw new ProtocolError(`buildId ist ${id.length} Bytes lang, erlaubt sind höchstens ${MAX_BUILD_ID_BYTES}.`);
  }
  const bytes = new Uint8Array(HELLO_HEADER_BYTES + id.length);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, TYPE_HELLO);
  view.setUint16(1, protoV);
  view.setUint8(3, id.length);
  bytes.set(id, HELLO_HEADER_BYTES);
  return bytes;
}

function encodePing(typeByte: number, seq: number, sentAtMs: number): Uint8Array {
  requireUint(seq, U32_MAX, 'seq');
  if (!Number.isFinite(sentAtMs)) throw new ProtocolError(`sentAtMs muss endlich sein (war ${sentAtMs}).`);
  const bytes = new Uint8Array(PING_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, typeByte);
  view.setUint32(1, seq);
  view.setFloat64(5, sentAtMs);
  return bytes;
}

export function encodeMessage(message: NetMessage): Uint8Array {
  switch (message.type) {
    case 'hello':
      return encodeHello(message.protoV, message.buildId);
    case 'ping':
      return encodePing(TYPE_PING, message.seq, message.sentAtMs);
    case 'pong':
      return encodePing(TYPE_PONG, message.seq, message.sentAtMs);
    default:
      throw new ProtocolError(`Unbekannter Nachrichtentyp: ${String((message as { type?: unknown }).type)}`);
  }
}

function decodeHello(data: Uint8Array, view: DataView): NetMessage {
  if (data.length < HELLO_HEADER_BYTES) throw new ProtocolError(`hello ist abgeschnitten (${data.length} Bytes).`);
  const idLength = view.getUint8(3);
  if (idLength > MAX_BUILD_ID_BYTES) throw new ProtocolError(`hello: buildId-Länge ${idLength} über ${MAX_BUILD_ID_BYTES}.`);
  if (data.length !== HELLO_HEADER_BYTES + idLength) {
    throw new ProtocolError(`hello: ${data.length} Bytes statt ${HELLO_HEADER_BYTES + idLength}.`);
  }
  let buildId: string;
  try {
    buildId = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(HELLO_HEADER_BYTES));
  } catch {
    throw new ProtocolError('hello: buildId ist kein gültiges UTF-8.');
  }
  return { type: 'hello', protoV: view.getUint16(1), buildId };
}

function decodePing(type: 'ping' | 'pong', data: Uint8Array, view: DataView): NetMessage {
  if (data.length !== PING_BYTES) throw new ProtocolError(`${type}: ${data.length} Bytes statt ${PING_BYTES}.`);
  const sentAtMs = view.getFloat64(5);
  if (!Number.isFinite(sentAtMs)) throw new ProtocolError(`${type}: sentAtMs ist nicht endlich.`);
  return { type, seq: view.getUint32(1), sentAtMs };
}

/** @throws ProtocolError bei leerem, abgeschnittenem, zu langem oder unbekanntem Inhalt. */
export function decodeMessage(data: Uint8Array): NetMessage {
  if (data.length === 0) throw new ProtocolError('Leere Nachricht.');
  // byteOffset/byteLength beachten: `data` kann eine Teilansicht eines größeren Puffers sein.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const typeByte = view.getUint8(0);
  switch (typeByte) {
    case TYPE_HELLO:
      return decodeHello(data, view);
    case TYPE_PING:
      return decodePing('ping', data, view);
    case TYPE_PONG:
      return decodePing('pong', data, view);
    default:
      throw new ProtocolError(`Unbekanntes Typ-Byte ${typeByte}.`);
  }
}
