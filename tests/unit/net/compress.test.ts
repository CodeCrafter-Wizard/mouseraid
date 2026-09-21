import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateRaw, fromBase64Url, inflateRaw, supportsDeflateRaw, toBase64Url } from '../../../src/net/compress';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const allBytes = (): Uint8Array => Uint8Array.from({ length: 256 }, (_, index) => index);

describe('compress – base64url', () => {
  it('kodiert die RFC-4648-Beispiele ohne Padding', () => {
    expect(toBase64Url(utf8(''))).toBe('');
    expect(toBase64Url(utf8('f'))).toBe('Zg');
    expect(toBase64Url(utf8('fo'))).toBe('Zm8');
    expect(toBase64Url(utf8('foo'))).toBe('Zm9v');
    expect(toBase64Url(utf8('foob'))).toBe('Zm9vYg');
    expect(toBase64Url(utf8('fooba'))).toBe('Zm9vYmE');
    expect(toBase64Url(utf8('foobar'))).toBe('Zm9vYmFy');
  });

  it('benutzt das URL-Alphabet: "-" und "_" statt "+" und "/"', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(toBase64Url(new Uint8Array([0xfb, 0xef, 0xbe]))).toBe('----');
    expect(toBase64Url(new Uint8Array([0xff, 0xff, 0xff]))).toBe('____');
    expect(fromBase64Url('-_8')).toEqual(new Uint8Array([0xfb, 0xff]));
  });

  it.each([0, 1, 2, 3, 4])('Roundtrip für Länge %i', (length) => {
    const bytes = allBytes().subarray(250, 250 + length);
    const text = toBase64Url(bytes);
    expect(text).toHaveLength(Math.ceil((length * 4) / 3));
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it('Roundtrip für alle Byte-Werte – nur Zeichen aus dem URL-Alphabet', () => {
    const text = toBase64Url(allBytes());
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(allBytes());
  });

  it('verkraftet große Eingaben (kein Stack-Überlauf)', () => {
    const big = Uint8Array.from({ length: 200_000 }, (_, index) => (index * 31) % 256);
    expect(fromBase64Url(toBase64Url(big))).toEqual(big);
  });

  it('liefert ein Uint8Array', () => {
    expect(fromBase64Url('Zm9v')).toBeInstanceOf(Uint8Array);
    expect(fromBase64Url('')).toEqual(new Uint8Array(0));
  });

  // Längen bewusst nicht ≡ 1 (mod 4): so greift wirklich die Zeichenprüfung. atob allein würde
  // Leerraum, "+", "/" und Padding stillschweigend annehmen.
  it.each([
    ['Plus', 'Zm9+'],
    ['Schrägstrich', 'Zm9/'],
    ['Padding', 'Zg=='],
    ['Leerzeichen', 'Z g'],
    ['Zeilenumbruch', 'Zg\n'],
    ['Punkt', 'Zm9v.Zg'],
    ['Umlaut', 'Zmäv'],
  ])('fromBase64Url weist ungültige Zeichen ab: %s', (_name, text) => {
    expect(() => fromBase64Url(text)).toThrow(Error);
  });

  it.each(['A', 'AAAAA', 'Zm9vYmFyZ'])('fromBase64Url weist die unmögliche Länge ab (Rest 1 bei Teilung durch 4): %s', (text) => {
    expect(text.length % 4).toBe(1);
    expect(() => fromBase64Url(text)).toThrow(Error);
  });
});

describe('compress – deflate-raw', () => {
  it('Roundtrip für Text mit Umlauten', async () => {
    const input = utf8('Mäusebau: a=setup:actpass – Größe zählt, Umlaute auch.');
    expect(await inflateRaw(await deflateRaw(input))).toEqual(input);
  });

  it('Roundtrip für leere Eingabe', async () => {
    const packed = await deflateRaw(new Uint8Array(0));
    expect(packed.length).toBeGreaterThan(0);
    expect(await inflateRaw(packed)).toEqual(new Uint8Array(0));
  });

  it('Roundtrip für alle Byte-Werte', async () => {
    expect(await inflateRaw(await deflateRaw(allBytes()))).toEqual(allBytes());
  });

  it('10 kB sich wiederholender Daten schrumpfen deutlich', async () => {
    const input = utf8('a=candidate:1 1 udp 2113937151 host '.repeat(300)).subarray(0, 10_000);
    expect(input).toHaveLength(10_000);
    const packed = await deflateRaw(input);
    expect(packed.length).toBeLessThan(input.length / 10);
    expect(await inflateRaw(packed)).toEqual(input);
  });

  it('liest nur die übergebene Teilansicht, nicht den ganzen Puffer dahinter', async () => {
    const backing = utf8('XXXXXnur-dieser-TeilYYYYY');
    const view = backing.subarray(5, 20);
    expect(new TextDecoder().decode(await inflateRaw(await deflateRaw(view)))).toBe('nur-dieser-Teil');
  });

  it('erzeugt rohes Deflate ohne zlib-Kopf: ein gespeicherter Block wird verstanden', async () => {
    // BFINAL=1/BTYPE=00, LEN=3, NLEN=~3, dann die drei Bytes wörtlich (RFC 1951, Abschnitt 3.2.4).
    const stored = new Uint8Array([0x01, 0x03, 0x00, 0xfc, 0xff, 0x61, 0x62, 0x63]);
    expect(new TextDecoder().decode(await inflateRaw(stored))).toBe('abc');
    const packed = await deflateRaw(utf8('abc'));
    expect(packed[0]).not.toBe(0x78); // 0x78 wäre der zlib-Kopf von "deflate" statt "deflate-raw"
  });

  it('inflateRaw lehnt Müll ab', async () => {
    // 0xff: BFINAL=1 mit dem reservierten Blocktyp 11 – in jedem Inflater ein Fehler.
    await expect(inflateRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).rejects.toBeInstanceOf(Error);
  });

  it('inflateRaw lehnt einen abgeschnittenen Strom ab', async () => {
    const packed = await deflateRaw(allBytes());
    await expect(inflateRaw(packed.subarray(0, packed.length >> 1))).rejects.toBeInstanceOf(Error);
    await expect(inflateRaw(new Uint8Array(0))).rejects.toBeInstanceOf(Error);
  });
});

describe('compress – supportsDeflateRaw', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ist in Node 24 (wie in aktuellen Browsern) wahr', () => {
    expect(supportsDeflateRaw()).toBe(true);
  });

  it('ist falsch, wenn CompressionStream fehlt', () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(supportsDeflateRaw()).toBe(false);
  });

  it('ist falsch, wenn DecompressionStream fehlt', () => {
    vi.stubGlobal('DecompressionStream', undefined);
    expect(supportsDeflateRaw()).toBe(false);
  });

  it('ist falsch, wenn der Browser das Format "deflate-raw" nicht kennt', () => {
    class OnlyGzip {
      constructor(format: string) {
        if (format !== 'gzip') throw new TypeError(`Unsupported compression format: ${format}`);
      }
    }
    vi.stubGlobal('CompressionStream', OnlyGzip);
    expect(supportsDeflateRaw()).toBe(false);
  });

  it('ohne CompressionStream lehnen deflateRaw/inflateRaw ab, statt synchron zu werfen', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(deflateRaw(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(Error);
    await expect(inflateRaw(new Uint8Array([3, 0]))).rejects.toBeInstanceOf(Error);
  });

  it('nach dem Zurücksetzen der Stubs ist die Erkennung wieder wahr', () => {
    expect(supportsDeflateRaw()).toBe(true);
  });
});
