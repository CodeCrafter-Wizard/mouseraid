import { describe, expect, it } from 'vitest';
import type { RngState } from '../../../../src/core/math/rng';
import { cloneRng, nextFloat, nextInt, nextRange, nextU32, seedRng } from '../../../../src/core/math/rng';

/** Prueft, dass alle vier Felder als uint32 im Zustand liegen (der Hash-Lauf verlaesst sich darauf). */
function isUint32State(s: RngState): boolean {
  return [s.a, s.b, s.c, s.d].every((v) => Number.isInteger(v) && v >= 0 && v <= 4294967295);
}

describe('rng: sfc32-Kern', () => {
  it('reproduziert den eingefrorenen Testvektor sfc32(1,2,3,4) nach 12 Warmrunden', () => {
    // PractRand-Saatregel: 12 Runden verwerfen. Die Werte stammen aus einer unabhaengigen
    // BigInt-Referenz (Faktenblatt §2) und pinnen die Rundenfunktion Zeile fuer Zeile.
    const s: RngState = { a: 1, b: 2, c: 3, d: 4 };
    for (let i = 0; i < 12; i += 1) nextU32(s);
    const got: number[] = [];
    for (let i = 0; i < 6; i += 1) got.push(nextU32(s));
    expect(got).toEqual([417285410, 1196253302, 123583739, 800524041, 903873393, 3641854082]);
  });

  it('MUTIERT den uebergebenen Zustand statt einen neuen zurueckzugeben', () => {
    const s: RngState = { a: 1, b: 2, c: 3, d: 4 };
    const before = { ...s };
    const value = nextU32(s);
    expect(typeof value).toBe('number');
    expect(s).not.toEqual(before);
    // Der Zustand liegt IM WorldState – ein zurueckgegebener neuer Zustand muesste an jeder
    // Aufrufstelle zurueckgeschrieben werden, und genau das vergisst man einmal.
  });

  it('haelt den Zustand in jedem Schritt als uint32', () => {
    const s = seedRng('maeusebau');
    for (let i = 0; i < 1000; i += 1) {
      nextU32(s);
      expect(isUint32State(s)).toBe(true);
    }
  });

  it('liefert uint32-Werte', () => {
    const s = seedRng('maeusebau');
    for (let i = 0; i < 10000; i += 1) {
      const u = nextU32(s);
      expect(Number.isInteger(u)).toBe(true);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(4294967295);
    }
  });
});

describe('rng: seedRng', () => {
  it('liefert fuer die Saat "maeusebau" die eingefrorenen ersten acht Werte', () => {
    const s = seedRng('maeusebau');
    expect(s).toEqual({ a: 1902471303, b: 3084646724, c: 999379058, d: 1082080008 });
    const got: number[] = [];
    for (let i = 0; i < 8; i += 1) got.push(nextU32(s));
    expect(got).toEqual([
      1774230739, 270214083, 2430573527, 3874433173,
      605405248, 2462506617, 2992111139, 595964876,
    ]);
  });

  it('ist rein: dieselbe Saat, derselbe Zustand', () => {
    expect(seedRng('feinkost')).toEqual(seedRng('feinkost'));
    expect(seedRng(7)).toEqual(seedRng(7));
  });

  it('unterscheidet Saaten – auch solche, die sich nur in einem Zeichen unterscheiden', () => {
    expect(seedRng('a')).not.toEqual(seedRng('b'));
    expect(seedRng('maeusebau')).not.toEqual(seedRng('maeusebav'));
    expect(seedRng(1)).not.toEqual(seedRng(2));
  });

  it('behandelt eine Zahl wie ihre Dezimalziffern', () => {
    expect(seedRng(42)).toEqual(seedRng('42'));
    expect(seedRng(-1.5)).toEqual(seedRng('-1.5'));
  });

  it('kommt auch mit nicht endlichen Zahlen und der leeren Saat aus', () => {
    // Die Saat geht als TEXT in den Hash – ein NaN wirft hier also nicht, anders als hashF64.
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, 0, -0, '']) {
      const s = seedRng(seed);
      expect(isUint32State(s)).toBe(true);
    }
    expect(seedRng(0)).toEqual(seedRng(-0));
  });
});

describe('rng: nextFloat', () => {
  it('liegt immer in [0, 1)', () => {
    const s = seedRng('float');
    let below = 0;
    let atOrAbove = 0;
    for (let i = 0; i < 200000; i += 1) {
      const f = nextFloat(s);
      if (f < 0) below += 1;
      if (f >= 1) atOrAbove += 1;
    }
    expect(below).toBe(0);
    expect(atOrAbove).toBe(0);
  });

  it('ist u / 4294967296 – dieselbe Folge wie nextU32', () => {
    const a = seedRng('float');
    const b = seedRng('float');
    for (let i = 0; i < 100; i += 1) {
      expect(nextFloat(a)).toBe(nextU32(b) / 4294967296);
    }
  });
});

describe('rng: nextInt', () => {
  it('liefert nur Werte in [0, n)', () => {
    const s = seedRng('int');
    for (const n of [1, 2, 3, 6, 255, 1000000]) {
      for (let i = 0; i < 2000; i += 1) {
        const v = nextInt(s, n);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
      }
    }
  });

  it('verteilt gleichmaessig – die Zaehlungen sind eingefroren', () => {
    // Feste Saat, feste Zahl Ziehungen: der Test pinnt EXAKTE Zaehlungen (Erwartung je 10000).
    // Eine Aenderung an der Rundenfunktion oder an der Verwerfungsregel faellt hier sofort auf.
    const s = seedRng('verteilung');
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i += 1) {
      // `noUncheckedIndexedAccess` steht in tsconfig.base.json – der Index braucht die Absicherung.
      const k = nextInt(s, 6);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual([10080, 10036, 10064, 9911, 10004, 9905]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(60000);
  });

  it('VERWIRFT statt Modulo zu rechnen – nachgewiesen an n = 2^31 + 1', () => {
    // Bei n = 2147483649 wird rund die Haelfte aller Rohwerte verworfen (LIMIT = 2147483649).
    // Die Referenz baut die Verwerfung von Hand nach; reines Modulo ergaebe eine andere Folge.
    const N = 2147483649;
    const LIMIT = 4294967296 - (4294967296 % N);
    const refRng = seedRng('verwerfung');
    const reference: number[] = [];
    let rejected = 0;
    for (let i = 0; i < 1000; i += 1) {
      let u = nextU32(refRng);
      while (u >= LIMIT) {
        rejected += 1;
        u = nextU32(refRng);
      }
      reference.push(u % N);
    }
    expect(rejected).toBe(1026);

    const rng = seedRng('verwerfung');
    const got: number[] = [];
    for (let i = 0; i < 1000; i += 1) got.push(nextInt(rng, N));
    expect(got).toEqual(reference);

    // Gegenprobe: die naive Modulo-Fassung liefert eine ANDERE Folge.
    const naiveRng = seedRng('verwerfung');
    const naive: number[] = [];
    for (let i = 0; i < 1000; i += 1) naive.push(nextU32(naiveRng) % N);
    expect(naive).not.toEqual(reference);
  });

  it('verbraucht bei n = 1 genau einen Rohwert und liefert 0', () => {
    const s = seedRng('eins');
    const ref = seedRng('eins');
    for (let i = 0; i < 100; i += 1) {
      expect(nextInt(s, 1)).toBe(0);
      nextU32(ref);
    }
    expect(s).toEqual(ref);
  });

  it('wirft bei n <= 0 und bei nicht ganzzahligem n', () => {
    const s = seedRng('wurf');
    for (const n of [0, -1, -1000]) expect(() => nextInt(s, n)).toThrow(RangeError);
    for (const n of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => nextInt(s, n)).toThrow(RangeError);
  });

  it('wirft bei n > 2^32 statt still nur die untere Haelfte zu liefern', () => {
    // Ohne den Wurf waere `limit` 0: jeder Rohwert verworfen, 65 Rohwerte verbraucht, Ergebnis < 2^32.
    const s = seedRng('gross');
    const before = { ...s };
    expect(() => nextInt(s, 2 ** 33)).toThrow(RangeError);
    expect(s).toEqual(before); // kein Rohwert verbraucht
    expect(nextInt(s, 2 ** 32)).toBeGreaterThanOrEqual(0); // die Grenze selbst bleibt erlaubt
  });
});

describe('rng: nextRange', () => {
  it('liegt in [lo, hi)', () => {
    const s = seedRng('range');
    for (let i = 0; i < 20000; i += 1) {
      const v = nextRange(s, -3.5, 7.25);
      expect(v).toBeGreaterThanOrEqual(-3.5);
      expect(v).toBeLessThan(7.25);
    }
  });

  it('ist lo + nextFloat * (hi - lo)', () => {
    const a = seedRng('range');
    const b = seedRng('range');
    for (let i = 0; i < 100; i += 1) {
      expect(nextRange(a, 2, 5)).toBe(2 + nextFloat(b) * 3);
    }
  });

  it('liefert bei lo === hi immer lo', () => {
    const s = seedRng('range');
    for (let i = 0; i < 50; i += 1) expect(nextRange(s, 4, 4)).toBe(4);
  });
});

describe('rng: cloneRng', () => {
  it('kopiert alle vier Felder in ein NEUES Objekt', () => {
    const s = seedRng('klon');
    const c = cloneRng(s);
    expect(c).toEqual(s);
    expect(c).not.toBe(s);
  });

  it('laeuft nach dem Klonen getrennt, aber gleich', () => {
    const s = seedRng('klon');
    const c = cloneRng(s);
    const fromS: number[] = [];
    const fromC: number[] = [];
    for (let i = 0; i < 500; i += 1) fromS.push(nextU32(s));
    for (let i = 0; i < 500; i += 1) fromC.push(nextU32(c));
    expect(fromC).toEqual(fromS);
    expect(c).toEqual(s);
  });
});
