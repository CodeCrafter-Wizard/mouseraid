import { describe, expect, it } from 'vitest';
import { HALF_PI, PI, TAU, atan2, cos, normalizeAngle, sin, sqrt } from '../../../../src/core/math/trig';

// Toleranzen = die GEMESSENE Schranke x2 (Plan-Kopf, Interface Contract):
//   sin/cos  6.63e-10  ->  1.4e-9
//   atan2    9.73e-9   ->  2.0e-8   (der Vertrag nennt 1.36e-8 als Obergrenze; beides ist eingehalten)
const SIN_TOL = 1.4e-9;
const ATAN2_TOL = 2.0e-8;

/** Groesster Betrag von f(x) - g(x) ueber ein gleichmaessiges Gitter. */
function maxError(from: number, to: number, steps: number, mine: (x: number) => number, ref: (x: number) => number): number {
  let worst = 0;
  for (let i = 0; i <= steps; i += 1) {
    const x = from + ((to - from) * i) / steps;
    const e = Math.abs(mine(x) - ref(x));
    if (e > worst) worst = e;
  }
  return worst;
}

describe('trig: Konstanten', () => {
  it('PI, TAU und HALF_PI sind die naechstliegenden double-Werte', () => {
    expect(PI).toBe(Math.PI);
    expect(TAU).toBe(2 * Math.PI);
    expect(HALF_PI).toBe(Math.PI / 2);
  });
});

describe('trig: sin/cos gegen Math.*', () => {
  it('haelt die Schranke auf einem dichten Gitter ueber [-PI, PI]', () => {
    expect(maxError(-PI, PI, 200000, sin, Math.sin)).toBeLessThan(SIN_TOL);
    expect(maxError(-PI, PI, 200000, cos, Math.cos)).toBeLessThan(SIN_TOL);
  });

  it('haelt die Schranke auch bei +-100 Umdrehungen', () => {
    const r = 100 * TAU;
    expect(maxError(-r, r, 200000, sin, Math.sin)).toBeLessThan(SIN_TOL);
    expect(maxError(-r, r, 200000, cos, Math.cos)).toBeLessThan(SIN_TOL);
  });

  it('haelt die Schranke an den Naehten der Bereichsreduktion (Vielfache von PI)', () => {
    // k = Math.round(x / PI) springt genau bei x = (k + 1/2) * PI; beide Seiten muessen passen.
    const offsets = [-1e-6, -1e-9, -1e-12, 0, 1e-12, 1e-9, 1e-6];
    let worst = 0;
    for (let k = -200; k <= 200; k += 1) {
      for (const d of offsets) {
        for (const base of [k * PI, (k + 0.5) * PI]) {
          const x = base + d;
          worst = Math.max(worst, Math.abs(sin(x) - Math.sin(x)), Math.abs(cos(x) - Math.cos(x)));
        }
      }
    }
    expect(worst).toBeLessThan(SIN_TOL);
  });

  it('liefert fuer riesige und negative Argumente endliche Werte in [-1, 1]', () => {
    // Bei sehr grossen Argumenten frisst die Ausloeschung in x - k*PI die Genauigkeit auf; der
    // WERTEBEREICH muss trotzdem heil bleiben, sonst wandert ein NaN in den Zustand.
    for (const x of [-1e12, -1e9, -1e6, -12345.678, 0, 12345.678, 1e6, 1e9, 1e12]) {
      for (const f of [sin, cos]) {
        const v = f(x);
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ist ungerade bzw. gerade und erfuellt sin^2 + cos^2 = 1', () => {
    let worst = 0;
    for (let i = 0; i <= 20000; i += 1) {
      const x = -8 + (16 * i) / 20000;
      worst = Math.max(worst, Math.abs(sin(-x) + sin(x)), Math.abs(cos(-x) - cos(x)));
      worst = Math.max(worst, Math.abs(sin(x) * sin(x) + cos(x) * cos(x) - 1));
    }
    expect(worst).toBeLessThan(2 * SIN_TOL);
  });
});

describe('trig: atan2', () => {
  it('haelt die Schranke auf einem 401x401-Gitter in [-1,1]^2', () => {
    let worst = 0;
    for (let i = 0; i <= 400; i += 1) {
      const x = -1 + i / 200;
      for (let j = 0; j <= 400; j += 1) {
        const y = -1 + j / 200;
        worst = Math.max(worst, Math.abs(atan2(y, x) - Math.atan2(y, x)));
      }
    }
    expect(worst).toBeLessThan(ATAN2_TOL);
  });

  it('haelt die Schranke auf einem Kreis-Sweep mit wechselnden Laengen', () => {
    let worst = 0;
    for (let i = 0; i <= 100000; i += 1) {
      const t = -PI + (TAU * i) / 100000;
      const r = 1 + (i % 977) * 0.031;
      const x = Math.cos(t) * r;
      const y = Math.sin(t) * r;
      worst = Math.max(worst, Math.abs(atan2(y, x) - Math.atan2(y, x)));
    }
    expect(worst).toBeLessThan(ATAN2_TOL);
  });

  it('nimmt die Argumente in derselben Reihenfolge wie Math.atan2 (y, x)', () => {
    // Haette die Reihenfolge gedreht, waere das Ergebnis PI/2 statt PI/4 - der Aufrufer
    // schreibt atan2(vel.z, vel.x).
    expect(Math.abs(atan2(1, 2) - Math.atan2(1, 2))).toBeLessThan(ATAN2_TOL);
    expect(Math.abs(atan2(2, 1) - Math.atan2(2, 1))).toBeLessThan(ATAN2_TOL);
    expect(Math.abs(atan2(1, 1) - PI / 4)).toBeLessThan(ATAN2_TOL);
    expect(atan2(1, 2)).toBeLessThan(atan2(2, 1));
  });

  it('trifft die Achsen und den Ursprung', () => {
    expect(atan2(0, 0)).toBe(0);
    expect(atan2(0, 1)).toBe(0);
    expect(atan2(1, 0)).toBe(HALF_PI);
    expect(atan2(-1, 0)).toBe(-HALF_PI);
    expect(atan2(0, -1)).toBe(PI);
  });

  it('bleibt bei sehr kleinen und sehr grossen Verhaeltnissen endlich', () => {
    for (const [y, x] of [[1e-300, 1], [1, 1e-300], [-1e-300, -1], [1e300, 1], [1, 1e300]] as const) {
      const a = atan2(y, x);
      expect(Number.isFinite(a)).toBe(true);
      expect(Math.abs(a)).toBeLessThanOrEqual(PI);
    }
  });
});

describe('trig: normalizeAngle', () => {
  it('liefert immer einen Wert in [-PI, PI)', () => {
    let violations = 0;
    for (let i = 0; i <= 200000; i += 1) {
      const a = -1000 + (2000 * i) / 200000;
      const r = normalizeAngle(a);
      if (!(r >= -PI && r < PI)) violations += 1;
    }
    expect(violations).toBe(0);
  });

  it('haelt den Rand: PI wird -PI, -PI bleibt -PI, TAU wird 0', () => {
    expect(normalizeAngle(PI)).toBe(-PI);
    expect(normalizeAngle(-PI)).toBe(-PI);
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(TAU)).toBe(0);
    expect(normalizeAngle(-TAU)).toBe(0);
  });

  it('aendert den Winkel nur um Vielfache von TAU', () => {
    let worst = 0;
    for (let i = 0; i <= 50000; i += 1) {
      const a = -500 + (1000 * i) / 50000;
      const r = normalizeAngle(a);
      worst = Math.max(worst, Math.abs(Math.sin(r) - Math.sin(a)), Math.abs(Math.cos(r) - Math.cos(a)));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('bleibt auch bei +-1e6 im Bereich', () => {
    for (const a of [1e6, -1e6, 1e5 + 0.5, -1e5 - 0.5]) {
      const r = normalizeAngle(a);
      expect(r).toBeGreaterThanOrEqual(-PI);
      expect(r).toBeLessThan(PI);
    }
  });

  it('bleibt an den Naehten grosser TAU-Vielfacher im Bereich', () => {
    // Ohne die zwei Nachkorrekturen in normalizeAngle rutscht das Ergebnis ab |a| ~ 1.26e6 durch
    // Rundung von `a - k*TAU` knapp unter -PI bzw. auf PI (gemessen: 121 149 Verletzungen in diesem
    // Gitter). Das dichte Gitter oben endet bei 1000 und sieht das nicht.
    let violations = 0;
    for (let k = -200000; k <= 200000; k += 1) {
      for (const d of [0, PI, -PI, PI - 1e-13, -PI + 1e-13]) {
        const r = normalizeAngle(k * TAU + d);
        if (!(r >= -PI && r < PI)) violations += 1;
      }
    }
    expect(violations).toBe(0);
  });
});

describe('trig: sqrt', () => {
  it('reicht Math.sqrt unveraendert durch', () => {
    for (const v of [0, 1, 2, 1e-8, 1e8, 123.456]) expect(sqrt(v)).toBe(Math.sqrt(v));
  });
});
