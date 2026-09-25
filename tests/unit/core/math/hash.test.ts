import { describe, expect, it } from 'vitest';
import { NaNError, createHasher, hashNumbers } from '../../../../src/core/math/hash';

/** Schiebt eine ASCII-Zeichenkette Byte fuer Byte durch den Hasher – ohne Laengenpraefix. */
function hashBytes(text: string): number {
  const h = createHasher();
  for (let i = 0; i < text.length; i += 1) h.hashU8(text.charCodeAt(i));
  return h.digest();
}

/** Schiebt eine ausgeschriebene Bytefolge durch den Hasher. */
function hashRaw(bytes: readonly number[]): number {
  const h = createHasher();
  for (const b of bytes) h.hashU8(b);
  return h.digest();
}

describe('hash: FNV-1a-32 Testvektoren', () => {
  // Die offiziellen FNV-Testvektoren. Sie pinnen Startwert (0x811c9dc5), Primzahl (16777619)
  // und die Reihenfolge XOR-dann-Multiplizieren.
  it('leerer Strom ergibt den Startwert 0x811c9dc5', () => {
    expect(hashBytes('')).toBe(0x811c9dc5);
    expect(createHasher().digest()).toBe(0x811c9dc5);
  });

  it('"a" ergibt 0xe40c292c', () => {
    expect(hashBytes('a')).toBe(0xe40c292c);
  });

  it('"foobar" ergibt 0xbf9cf968', () => {
    expect(hashBytes('foobar')).toBe(0xbf9cf968);
  });

  it('digest ist immer ein uint32', () => {
    for (const text of ['', 'a', 'foobar', 'Maeusebau', 'x'.repeat(1000)]) {
      const d = hashBytes(text);
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(4294967295);
    }
  });

  it('hashU8 nimmt nur das niederwertige Byte', () => {
    expect(hashRaw([0x161])).toBe(hashRaw([0x61]));
    expect(hashRaw([-1])).toBe(hashRaw([0xff]));
  });
});

describe('hash: Zahlen als kanonischer Little-Endian-Strom', () => {
  // IEEE-754-Kodierung, AUSGESCHRIEBEN (nicht aus einer DataView gewonnen) – nur so beweist der
  // Test, dass der Hasher das Flag `littleEndian = true` benutzt und nicht die Plattformsicht
  // eines Float64Array. ECMA-262 9.6 nennt die Plattformsicht "implementation-defined".
  const CASES: readonly { value: number; bytes: readonly number[] }[] = [
    { value: 0, bytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] },
    { value: 1.5, bytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f] },
    { value: -1, bytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xbf] },
    { value: 12.5, bytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x29, 0x40] },
  ];

  for (const { value, bytes } of CASES) {
    it(`${value} geht als ${bytes.length} Little-Endian-Bytes in den Strom`, () => {
      const h = createHasher();
      h.hashF64(value, 'test');
      expect(h.digest()).toBe(hashRaw(bytes));
    });
  }

  it('-0 hasht wie +0', () => {
    const a = createHasher();
    a.hashF64(-0, 'a');
    const b = createHasher();
    b.hashF64(0, 'b');
    expect(a.digest()).toBe(b.digest());
    // Gegenprobe: die ROHEN Bytes von -0 waeren andere (Vorzeichenbit gesetzt).
    expect(hashRaw([0, 0, 0, 0, 0, 0, 0, 0x80])).not.toBe(a.digest());
  });

  it('eine Aenderung um 1 ULP aendert den Hash', () => {
    const a = createHasher();
    a.hashF64(12.5, 'a');
    const b = createHasher();
    b.hashF64(12.500000000000002, 'b');
    expect(a.digest()).not.toBe(b.digest());
  });

  it('die Reihenfolge der Felder gehoert zum Vertrag', () => {
    const a = createHasher();
    a.hashF64(1, 'x');
    a.hashF64(2, 'z');
    const b = createHasher();
    b.hashF64(2, 'x');
    b.hashF64(1, 'z');
    expect(a.digest()).not.toBe(b.digest());
  });
});

describe('hash: NaN-Waechter', () => {
  it('wirft NaNError mit dem Feldpfad bei NaN', () => {
    const h = createHasher();
    expect(() => h.hashF64(Number.NaN, 'players[2].pos.x')).toThrow(NaNError);
    try {
      createHasher().hashF64(Number.NaN, 'players[2].pos.x');
      expect.unreachable('haette werfen muessen');
    } catch (error) {
      expect(error).toBeInstanceOf(NaNError);
      expect(error).toBeInstanceOf(Error);
      expect((error as NaNError).path).toBe('players[2].pos.x');
      expect((error as NaNError).name).toBe('NaNError');
      expect((error as NaNError).message).toContain('players[2].pos.x');
    }
  });

  it('wirft auch bei +Infinity und -Infinity', () => {
    for (const v of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => createHasher().hashF64(v, 'cat.awareness[0]')).toThrow(NaNError);
    }
  });

  it('laesst endliche Extremwerte durch', () => {
    for (const v of [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 0]) {
      expect(() => createHasher().hashF64(v, 'x')).not.toThrow();
    }
  });
});

describe('hash: Wahrheitswerte, Zeichenketten, Laengen', () => {
  it('hashBool schreibt genau ein Byte 0 oder 1', () => {
    const t = createHasher();
    t.hashBool(true);
    const f = createHasher();
    f.hashBool(false);
    expect(t.digest()).toBe(hashRaw([1]));
    expect(f.digest()).toBe(hashRaw([0]));
    expect(t.digest()).not.toBe(f.digest());
  });

  it('hashLen schreibt vier Bytes uint32 LE', () => {
    const h = createHasher();
    h.hashLen(258);
    expect(h.digest()).toBe(hashRaw([0x02, 0x01, 0x00, 0x00]));
  });

  it('hashStr schreibt Laengenpraefix + UTF-16-Code-Einheiten LE', () => {
    const h = createHasher();
    h.hashStr('Ab');
    expect(h.digest()).toBe(hashRaw([0x02, 0x00, 0x00, 0x00, 0x41, 0x00, 0x62, 0x00]));
  });

  it('haelt Zeichen ausserhalb von ASCII auseinander (zwei Bytes je Code-Einheit)', () => {
    // Die beiden Code-Einheiten sind byte-vertauscht: U+00E4 -> [0xE4, 0x00], U+0E00 -> [0x00, 0x0E].
    // Der zweite steht als \u-Escape im Quelltext – es ist ein nicht belegter Codepunkt, der als
    // woertliches Zeichen in der Datei nur wie ein leerer Kasten aussaehe.
    const a = createHasher();
    a.hashStr('ä');
    const b = createHasher();
    b.hashStr('\u0E00');
    expect(a.digest()).not.toBe(b.digest());
  });

  it('das Laengenpraefix trennt "ab" von "a" + "b"', () => {
    const one = createHasher();
    one.hashStr('ab');
    const two = createHasher();
    two.hashStr('a');
    two.hashStr('b');
    expect(one.digest()).not.toBe(two.digest());
  });
});

describe('hash: hashNumbers', () => {
  it('ist Laengenpraefix + hashF64 je Wert', () => {
    const values = [1, -2.5, 0, 1e-9];
    const manual = createHasher();
    manual.hashLen(values.length);
    for (let i = 0; i < values.length; i += 1) manual.hashF64(values[i] as number, `values[${i}]`);
    expect(hashNumbers(values)).toBe(manual.digest());
  });

  it('unterscheidet Reihenfolge und Laenge', () => {
    expect(hashNumbers([1, 2])).not.toBe(hashNumbers([2, 1]));
    expect(hashNumbers([1, 2])).not.toBe(hashNumbers([1, 2, 0]));
    expect(hashNumbers([])).not.toBe(createHasher().digest());
  });

  it('wirft bei NaN mit dem Index im Pfad', () => {
    try {
      hashNumbers([1, Number.NaN]);
      expect.unreachable('haette werfen muessen');
    } catch (error) {
      expect(error).toBeInstanceOf(NaNError);
      expect((error as NaNError).path).toBe('values[1]');
    }
  });
});

describe('hash: Determinismus', () => {
  it('zwei unabhaengige Hasher liefern bei gleicher Folge denselben Wert', () => {
    function run(): number {
      const h = createHasher();
      h.hashLen(3);
      h.hashU8(7);
      h.hashBool(true);
      h.hashStr('Feinkost');
      h.hashF64(-0, 'a');
      h.hashF64(1234.5678, 'b');
      return h.digest();
    }
    expect(run()).toBe(run());
  });

  it('derselbe Hasher liefert bei wiederholtem digest denselben Wert', () => {
    const h = createHasher();
    h.hashF64(42, 'x');
    expect(h.digest()).toBe(h.digest());
  });
});
