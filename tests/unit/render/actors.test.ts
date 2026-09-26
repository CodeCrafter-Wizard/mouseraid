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
  it('trifft die Enden genau', () => {
    expect(lerp(-60, -51, 0)).toBe(-60);
    expect(lerp(-60, -51, 1)).toBe(-51);
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
