import { describe, expect, it } from 'vitest';
import {
  add2, add3, dist2, dist3, dot2, dot3, len2, len3, normalize2, normalize3,
  rotateY2, rotateY3, scale2, scale3, sub2, sub3, v2, v3,
} from '../../../../src/core/math/vec';
import { HALF_PI, cos, sin } from '../../../../src/core/math/trig';

const EPS = 1e-12;

describe('vec: Erzeuger', () => {
  it('v2 hat genau x und z – ein y waere im Grundriss eine stille Falle', () => {
    const a = v2(1, 2);
    expect(a).toEqual({ x: 1, z: 2 });
    expect('y' in a).toBe(false);
  });

  it('v3 hat x, y und z', () => {
    expect(v3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('vec: Algebra in 2D', () => {
  const a = v2(3, -4);
  const b = v2(-1, 2.5);

  it('Addition ist kommutativ, Subtraktion ihre Umkehrung', () => {
    expect(add2(a, b)).toEqual(add2(b, a));
    expect(sub2(add2(a, b), b)).toEqual(a);
    expect(sub2(a, a)).toEqual({ x: 0, z: 0 });
  });

  it('Skalierung verteilt sich ueber die Addition', () => {
    const l = scale2(add2(a, b), 2.5);
    const r = add2(scale2(a, 2.5), scale2(b, 2.5));
    expect(Math.abs(l.x - r.x)).toBeLessThan(EPS);
    expect(Math.abs(l.z - r.z)).toBeLessThan(EPS);
  });

  it('dot2 mit sich selbst ist das Laengenquadrat', () => {
    expect(dot2(a, a)).toBeCloseTo(len2(a) * len2(a), 12);
    expect(len2(a)).toBe(5);
  });

  it('dist2 ist die Laenge der Differenz', () => {
    expect(dist2(a, b)).toBeCloseTo(len2(sub2(a, b)), 12);
    expect(dist2(a, b)).toBe(dist2(b, a));
  });

  it('normalize2 liefert Laenge 1', () => {
    expect(len2(normalize2(a))).toBeCloseTo(1, 12);
  });

  it('normalize2 der Nulllaenge ist {0,0} und NIE NaN', () => {
    const n = normalize2(v2(0, 0));
    expect(n).toEqual({ x: 0, z: 0 });
    expect(Number.isNaN(n.x)).toBe(false);
    expect(Number.isNaN(n.z)).toBe(false);
  });
});

describe('vec: Algebra in 3D', () => {
  const a = v3(1, -2, 2);
  const b = v3(0.5, 4, -1);

  it('Addition, Subtraktion und Skalierung verhalten sich wie in 2D', () => {
    expect(add3(a, b)).toEqual(add3(b, a));
    expect(sub3(add3(a, b), b)).toEqual(a);
    // -2 * 0 ergibt -0. Genau dafuer normalisiert `hashF64` spaeter auf +0: sonst haetten zwei
    // rechnerisch gleiche Zustaende verschiedene Hashes.
    expect(scale3(a, 0)).toEqual({ x: 0, y: -0, z: 0 });
  });

  it('len3 ist die Wurzel aus dot3 mit sich selbst', () => {
    expect(len3(a)).toBe(3);
    expect(dot3(a, a)).toBeCloseTo(len3(a) * len3(a), 12);
  });

  it('dist3 ist die Laenge der Differenz', () => {
    expect(dist3(a, b)).toBeCloseTo(len3(sub3(a, b)), 12);
  });

  it('normalize3 liefert Laenge 1, die Nulllaenge liefert {0,0,0}', () => {
    expect(len3(normalize3(a))).toBeCloseTo(1, 12);
    expect(normalize3(v3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('vec: Drehung um die Y-Achse', () => {
  it('dreht mit VORBERECHNETEM Kosinus/Sinus – zur Laufzeit faellt kein Trig an', () => {
    // Viertelkreis: (1,0) -> (0,1).
    const r = rotateY2(v2(1, 0), cos(HALF_PI), sin(HALF_PI));
    expect(Math.abs(r.x)).toBeLessThan(1e-9);
    expect(Math.abs(r.z - 1)).toBeLessThan(1e-9);
  });

  it('laesst die Laenge unveraendert', () => {
    const a = v2(3, -4);
    for (let i = 0; i < 64; i += 1) {
      const t = (i / 64) * 6.283185307179586;
      expect(len2(rotateY2(a, cos(t), sin(t)))).toBeCloseTo(5, 8);
    }
  });

  it('ist mit c = 1, s = 0 die Identitaet', () => {
    expect(rotateY2(v2(7, -3), 1, 0)).toEqual({ x: 7, z: -3 });
    expect(rotateY3(v3(7, 9, -3), 1, 0)).toEqual({ x: 7, y: 9, z: -3 });
  });

  it('dreht mit -s zurueck (Welt -> lokaler Rahmen)', () => {
    const c = cos(0.7);
    const s = sin(0.7);
    const p = v2(2.5, -1.25);
    const back = rotateY2(rotateY2(p, c, s), c, -s);
    expect(Math.abs(back.x - p.x)).toBeLessThan(1e-9);
    expect(Math.abs(back.z - p.z)).toBeLessThan(1e-9);
  });

  it('rotateY3 laesst y unberuehrt', () => {
    const r = rotateY3(v3(1, 42, 0), cos(1.1), sin(1.1));
    expect(r.y).toBe(42);
    expect(Math.abs(r.x * r.x + r.z * r.z - 1)).toBeLessThan(1e-9);
  });
});

describe('vec: Reinheit', () => {
  it('jeder Helfer gibt ein NEUES Objekt zurueck und laesst die Eingaben in Ruhe', () => {
    const a2 = v2(1, 2);
    const b2 = v2(3, 4);
    const a3 = v3(1, 2, 3);
    const b3 = v3(4, 5, 6);
    const results: object[] = [
      add2(a2, b2), sub2(a2, b2), scale2(a2, 2), normalize2(a2), rotateY2(a2, 0, 1),
      add3(a3, b3), sub3(a3, b3), scale3(a3, 2), normalize3(a3), rotateY3(a3, 0, 1),
    ];
    for (const r of results) {
      expect(r).not.toBe(a2);
      expect(r).not.toBe(b2);
      expect(r).not.toBe(a3);
      expect(r).not.toBe(b3);
    }
    expect(a2).toEqual({ x: 1, z: 2 });
    expect(b2).toEqual({ x: 3, z: 4 });
    expect(a3).toEqual({ x: 1, y: 2, z: 3 });
    expect(b3).toEqual({ x: 4, y: 5, z: 6 });
  });
});
