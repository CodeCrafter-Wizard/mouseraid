import { describe, expect, it } from 'vitest';
import { CAPSULE_SLACK, capsuleHeight, lerp, lerpAngle } from '../../../src/render/actors';

describe('actors: capsuleHeight', () => {
  it('klemmt die Maus der echten Balance auf 2*r + Spiel', () => {
    // Werte als LITERALE, nicht aus `src/data/balance.json` gelesen: die Balance ist provisorisch,
    // die Klemmregel ist es nicht. Maus radius 0,4 / height 0,6 -> 0,81 u, und zwar GENAU
    // (gemessen: `2 * 0.4 + 0.01 === 0.81` ist in IEEE-754 wahr).
    expect(capsuleHeight(0.4, 0.6)).toBe(0.81);
  });

  it('lässt die Katze der echten Balance ungeklemmt', () => {
    expect(capsuleHeight(1.2, 3)).toBe(3);
  });

  it('klemmt auch bei height GENAU 2*r – sonst entsteht eine Kugel', () => {
    expect(capsuleHeight(1, 2)).toBe(2 + CAPSULE_SLACK);
  });

  it('lässt einen schlanken Körper unangetastet', () => {
    expect(capsuleHeight(0.5, 4)).toBe(4);
  });
});

describe('actors: lerp', () => {
  it('trifft t = 0 bitgenau und t = 1 nur numerisch', () => {
    // `t = 0` ist exakt: `a + (b - a) * 0` ist `a`, in IEEE-754 immer.
    expect(lerp(-60, -51, 0)).toBe(-60);
    // `t = 1` ist es NICHT im Allgemeinen – hier faellt es nur zufaellig zusammen, weil 9 und 60
    // beide exakt darstellbar sind. Deshalb steht hier `toBeCloseTo`, wie es die Regel am Modul fuer
    // JEDEN Vergleich gegen einen Zustandswert verlangt (Task-3-Review, Minor 4).
    expect(lerp(-60, -51, 1)).toBeCloseTo(-51, 12);
  });

  // Abschlussreview MIN-22: auf dieser Messung steht eine PROJEKTWEITE Regel (`actors.ts:36-40`,
  // `levelMeshes.ts:43`, `graybox-bounds.test.ts`: Mesh- und Posenwerte immer mit `toBeCloseTo`
  // vergleichen) – gepinnt war sie nicht. Ein `lerp`, das bei `t === 1` kurzschliesst, waere gruen
  // gewesen, und der Kommentar samt Regel waere still falsch geworden.
  it('trifft b bei t = 1 NICHT bitgenau – die Messung, auf der die toBeCloseTo-Regel steht', () => {
    const a = -60;
    const b = -12.3456789;
    // GEMESSEN: Abweichung 3,55e-15 (rund 16 ULP bei dieser Groessenordnung).
    expect(lerp(a, b, 1)).not.toBe(b);
    expect(lerp(a, b, 1)).toBeCloseTo(b, 12);
    expect(Math.abs(lerp(a, b, 1) - b)).toBeLessThan(1e-14);
    expect(Math.abs(lerp(a, b, 1) - b)).toBeGreaterThan(0);
  });

  it('mischt in der Mitte', () => {
    expect(lerp(2, 6, 0.5)).toBe(4);
  });

  it('extrapoliert, ohne zu klemmen – das Klemmen ist Sache der Schleife', () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe('actors: lerpAngle', () => {
  const PI = Math.PI;

  it('nimmt den kürzesten Weg über +-PI statt einmal herum', () => {
    // Von PI-0,1 nach -PI+0,1 sind es 0,2 vorwärts, nicht 2*PI-0,2 zurück.
    expect(lerpAngle(PI - 0.1, -PI + 0.1, 0.5)).toBeCloseTo(PI, 12);
    expect(lerpAngle(PI - 0.1, -PI + 0.1, 1)).toBeCloseTo(PI + 0.1, 12);
  });

  it('dreht in der anderen Richtung genauso kurz', () => {
    expect(lerpAngle(-PI + 0.1, PI - 0.1, 1)).toBeCloseTo(-PI - 0.1, 12);
  });

  it('lässt gleiche Winkel in Ruhe', () => {
    expect(lerpAngle(1.25, 1.25, 0.37)).toBe(1.25);
  });

  it('trifft die Enden genau', () => {
    expect(lerpAngle(0.5, 1.5, 0)).toBe(0.5);
    expect(lerpAngle(0.5, 1.5, 1)).toBe(1.5);
  });

  it('nimmt bei genau PI Unterschied die positive Richtung', () => {
    expect(lerpAngle(0, PI, 1)).toBeCloseTo(PI, 12);
  });

  it('kommt auch mit mehr als einer Umdrehung Unterschied zurecht', () => {
    expect(lerpAngle(0, 4 * PI + 0.25, 1)).toBeCloseTo(0.25, 12);
  });
});
