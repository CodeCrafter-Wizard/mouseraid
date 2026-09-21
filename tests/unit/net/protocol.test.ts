import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  ProtocolError,
  decodeMessage,
  encodeMessage,
  type NetMessage,
} from '../../../src/net/protocol';

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
const F64_1_5 = [0x3f, 0xf8, 0, 0, 0, 0, 0, 0]; // 1.5 als IEEE-754-Double, Big Endian
const F64_NAN = [0x7f, 0xf8, 0, 0, 0, 0, 0, 0];

describe('protocol – Byte-Layout', () => {
  it('PROTOCOL_VERSION ist 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('hello: Typ 1, u16 protoV (Big Endian), u8 Länge, UTF-8-buildId', () => {
    const bytes = encodeMessage({ type: 'hello', protoV: 0x0102, buildId: 'abc12345' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 0x01, 0x02, 8, ...ascii('abc12345')]);
  });

  it('ping: genau 13 Bytes – Typ 2, u32 seq (Big Endian), f64 sentAtMs (Big Endian)', () => {
    const bytes = encodeMessage({ type: 'ping', seq: 0x01020304, sentAtMs: 1.5 });
    expect(bytes).toHaveLength(13);
    expect([...bytes]).toEqual([2, 0x01, 0x02, 0x03, 0x04, ...F64_1_5]);
  });

  it('pong: wie ping, aber Typ 3', () => {
    const bytes = encodeMessage({ type: 'pong', seq: 0x01020304, sentAtMs: 1.5 });
    expect([...bytes]).toEqual([3, 0x01, 0x02, 0x03, 0x04, ...F64_1_5]);
  });
});

describe('protocol – Roundtrip', () => {
  const messages: NetMessage[] = [
    { type: 'hello', protoV: PROTOCOL_VERSION, buildId: 'abc12345' },
    { type: 'hello', protoV: 65535, buildId: '' },
    { type: 'hello', protoV: 0, buildId: 'abc12345-dirty-101530' },
    { type: 'ping', seq: 7, sentAtMs: 123456.789 },
    { type: 'pong', seq: 7, sentAtMs: 123456.789 },
    { type: 'ping', seq: 1, sentAtMs: 0 },
    { type: 'pong', seq: 1, sentAtMs: -0.25 },
  ];

  it.each(messages)('$type bleibt über encode → decode unverändert (%j)', (message) => {
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it('seq ist ein u32: 0 und 4294967295 bleiben erhalten', () => {
    for (const seq of [0, 4294967295]) {
      expect(decodeMessage(encodeMessage({ type: 'ping', seq, sentAtMs: 1 }))).toEqual({ type: 'ping', seq, sentAtMs: 1 });
      expect(decodeMessage(encodeMessage({ type: 'pong', seq, sentAtMs: 1 }))).toEqual({ type: 'pong', seq, sentAtMs: 1 });
    }
    expect([...encodeMessage({ type: 'ping', seq: 4294967295, sentAtMs: 1 })].slice(1, 5)).toEqual([255, 255, 255, 255]);
  });

  it('buildId ist UTF-8: Umlaute und Emoji zählen in Bytes, nicht in Zeichen', () => {
    const buildId = 'mäuse-ß-ü-🐭';
    const bytes = encodeMessage({ type: 'hello', protoV: 1, buildId });
    const utf8 = new TextEncoder().encode(buildId);
    expect(utf8.length).toBeGreaterThan(buildId.length);
    expect(bytes[3]).toBe(utf8.length);
    expect([...bytes.subarray(4)]).toEqual([...utf8]);
    expect(decodeMessage(bytes)).toEqual({ type: 'hello', protoV: 1, buildId });
  });

  it('decode respektiert byteOffset und byteLength einer Teilansicht', () => {
    const inner = encodeMessage({ type: 'ping', seq: 42, sentAtMs: 99.5 });
    const padded = new Uint8Array(inner.length + 5).fill(0xee);
    padded.set(inner, 3);
    expect(decodeMessage(padded.subarray(3, 3 + inner.length))).toEqual({ type: 'ping', seq: 42, sentAtMs: 99.5 });
  });
});

describe('protocol – encode weist ungültige Nachrichten ab', () => {
  it('ProtocolError ist ein Error mit eigenem Namen', () => {
    const error = new ProtocolError('x');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error.name).toBe('ProtocolError');
  });

  it('buildId mit genau 64 Bytes ist erlaubt, 65 Bytes nicht', () => {
    const ok = 'a'.repeat(64);
    expect(decodeMessage(encodeMessage({ type: 'hello', protoV: 1, buildId: ok }))).toEqual({ type: 'hello', protoV: 1, buildId: ok });
    expect(() => encodeMessage({ type: 'hello', protoV: 1, buildId: 'a'.repeat(65) })).toThrow(ProtocolError);
  });

  it('die Grenze gilt in Bytes: 33 Umlaute sind 66 Bytes', () => {
    expect('ä'.repeat(33)).toHaveLength(33);
    expect(() => encodeMessage({ type: 'hello', protoV: 1, buildId: 'ä'.repeat(33) })).toThrow(ProtocolError);
    expect(encodeMessage({ type: 'hello', protoV: 1, buildId: 'ä'.repeat(32) })).toHaveLength(4 + 64);
  });

  it.each([-1, 65536, 1.5, Number.NaN])('protoV %s ist kein u16', (protoV) => {
    expect(() => encodeMessage({ type: 'hello', protoV, buildId: 'x' })).toThrow(ProtocolError);
  });

  it.each([-1, 0.5, 4294967296, Number.NaN, Number.POSITIVE_INFINITY])('seq %s ist kein u32', (seq) => {
    expect(() => encodeMessage({ type: 'ping', seq, sentAtMs: 1 })).toThrow(ProtocolError);
    expect(() => encodeMessage({ type: 'pong', seq, sentAtMs: 1 })).toThrow(ProtocolError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('sentAtMs %s ist nicht endlich', (sentAtMs) => {
    expect(() => encodeMessage({ type: 'ping', seq: 1, sentAtMs })).toThrow(ProtocolError);
  });

  it('ein unbekannter Nachrichtentyp wird abgewiesen', () => {
    const bogus = { type: 'tschuess' } as unknown as NetMessage;
    expect(() => encodeMessage(bogus)).toThrow(ProtocolError);
  });
});

describe('protocol – decode weist ungültige Puffer ab', () => {
  const valid: Uint8Array[] = [
    encodeMessage({ type: 'hello', protoV: 1, buildId: 'abc12345' }),
    encodeMessage({ type: 'ping', seq: 5, sentAtMs: 10 }),
    encodeMessage({ type: 'pong', seq: 5, sentAtMs: 10 }),
  ];

  it('leerer Puffer', () => {
    expect(() => decodeMessage(new Uint8Array(0))).toThrow(ProtocolError);
  });

  it.each([0, 4, 0x7f, 255])('unbekanntes Typ-Byte %i', (typeByte) => {
    const bytes = new Uint8Array(13);
    bytes[0] = typeByte;
    expect(() => decodeMessage(bytes)).toThrow(ProtocolError);
  });

  it('jedes echte Präfix einer gültigen Nachricht ist abgeschnitten', () => {
    for (const bytes of valid) {
      for (let length = 0; length < bytes.length; length += 1) {
        expect(() => decodeMessage(bytes.subarray(0, length)), `Länge ${length}`).toThrow(ProtocolError);
      }
    }
  });

  it('angehängter Müll nach einer gültigen Nachricht', () => {
    for (const bytes of valid) {
      const longer = new Uint8Array(bytes.length + 1);
      longer.set(bytes);
      expect(() => decodeMessage(longer)).toThrow(ProtocolError);
    }
  });

  it('hello mit Längenfeld über 64', () => {
    const bytes = new Uint8Array(4 + 65).fill(0x61);
    bytes.set([1, 0, 1, 65]);
    expect(() => decodeMessage(bytes)).toThrow(ProtocolError);
  });

  it('hello mit ungültigem UTF-8', () => {
    expect(() => decodeMessage(new Uint8Array([1, 0, 1, 2, 0xc3, 0x28]))).toThrow(ProtocolError);
  });

  it('ping/pong mit nicht endlichem Zeitstempel', () => {
    expect(() => decodeMessage(new Uint8Array([2, 0, 0, 0, 1, ...F64_NAN]))).toThrow(ProtocolError);
    expect(() => decodeMessage(new Uint8Array([3, 0, 0, 0, 1, ...F64_NAN]))).toThrow(ProtocolError);
  });
});
