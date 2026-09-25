import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { CAMERA, CAT, MOUSE, SIGHT, createMoveResult, overlapsY } from '../../../../src/core/world/colliderTypes';
import type { Collider } from '../../../../src/core/world/colliderTypes';
import { generateColliders } from '../../../../src/core/world/generateColliders';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import { CM_PER_UNIT } from '../../../../src/core/world/levelTypes';
import type { LevelShelf } from '../../../../src/core/world/levelTypes';
import miniLevel from '../../../fixtures/core/mini-level.json';
import testBalance from '../../../fixtures/core/test-balance.json';

const level = loadLevel(miniLevel);
const balance = loadBalance(testBalance);
const colliders = generateColliders(level);

/** Zugriff ohne `!` – tseslint verbietet die Nicht-Null-Zusicherung. */
function at(index: number): Collider {
  const collider = colliders[index];
  if (collider === undefined) throw new Error(`Kollider ${index} fehlt`);
  return collider;
}

function shelfAt(index: number): LevelShelf {
  const shelf = level.shelves[index];
  if (shelf === undefined) throw new Error(`Regal ${index} fehlt`);
  return shelf;
}

/** Lichte Weite zwischen zwei Beinen: Mittenabstand minus die beiden Halbmaße. */
function clearBetween(a: Collider, b: Collider): number {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  return Math.sqrt(dx * dx + dz * dz) - a.hx - b.hx;
}

// Die fünf Kollider je Regal: 4 Beine ab der lokalen Ecke (-x,-z) gegen den Uhrzeigersinn,
// dann der Baldachin. Regal 0 beginnt hinter den 4 Wänden.
const SHELF_BASE: readonly number[] = [4, 9];

function legsOf(shelf: number): Collider[] {
  const base = SHELF_BASE[shelf] ?? -1;
  return [at(base), at(base + 1), at(base + 2), at(base + 3)];
}

function canopyOf(shelf: number): Collider {
  return at((SHELF_BASE[shelf] ?? -1) + 4);
}

describe('generateColliders – Anzahl, Reihenfolge, Masken', () => {
  it('4 Wände + 2 Regale a 5 + 1 Kiste = 15 Kollider mit fortlaufenden IDs ab 0', () => {
    expect(colliders).toHaveLength(15);
    expect(colliders.map((collider) => collider.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('die Reihenfolge ist Wände -> Regale -> Kisten, jede Gruppe in Definitionsreihenfolge', () => {
    const wall = MOUSE | CAT | SIGHT | CAMERA;
    const leg = MOUSE | SIGHT;
    const canopy = CAT | SIGHT | CAMERA;
    expect(colliders.map((collider) => collider.blocks)).toEqual([
      wall, wall, wall, wall,
      leg, leg, leg, leg, canopy,
      leg, leg, leg, leg, canopy,
      wall,
    ]);
  });

  it('occluderGroup zählt je QUELLOBJEKT ab 1 – die fünf Kollider eines Regals teilen sie', () => {
    expect(colliders.map((collider) => collider.occluderGroup)).toEqual([
      1, 2, 3, 4,
      5, 5, 5, 5, 5,
      6, 6, 6, 6, 6,
      7,
    ]);
  });

  it('ist deterministisch: zwei Läufe liefern dasselbe Ergebnis', () => {
    expect(generateColliders(level)).toEqual(colliders);
  });

  it('ein Level ohne Grundformen liefert keine Kollider', () => {
    const bare = JSON.parse(JSON.stringify(miniLevel)) as Record<string, unknown>;
    bare['walls'] = [];
    bare['shelves'] = [];
    bare['boxes'] = [];
    expect(generateColliders(loadLevel(bare))).toHaveLength(0);
  });

  it('rc/rs sind cos(rot)/sin(rot) und bilden einen Einheitsvektor', () => {
    for (const collider of colliders) {
      expect(collider.rc).toBeCloseTo(Math.cos(collider.rot), 7);
      expect(collider.rs).toBeCloseTo(Math.sin(collider.rot), 7);
      expect(collider.rc * collider.rc + collider.rs * collider.rs).toBeCloseTo(1, 7);
    }
  });

  it('alle Halbmaße sind positiv und jedes Höhenband ist nicht leer', () => {
    for (const collider of colliders) {
      expect(collider.hx).toBeGreaterThan(0);
      expect(collider.hz).toBeGreaterThan(0);
      expect(collider.y1).toBeGreaterThan(collider.y0);
    }
  });
});

describe('generateColliders – Wände', () => {
  it('die Südwand steht mittig auf ihrer Strecke: halbe Länge x halbe Dicke, y 0…Höhe', () => {
    expect(at(0).cx).toBe(0);
    expect(at(0).cz).toBe(-15);
    expect(at(0).hx).toBe(20); // Länge 40 / 2
    expect(at(0).hz).toBe(0.5); // thicknessCm 10 / 2 / CM_PER_UNIT
    expect(at(0).y0).toBe(0);
    expect(at(0).y1).toBe(20); // heightCm 200 / CM_PER_UNIT
  });

  it('rot folgt der Laufrichtung der Strecke (Süd 0, Ost +PI/2, Nord PI, West -PI/2)', () => {
    expect(at(0).rot).toBeCloseTo(0, 9);
    expect(at(1).rot).toBeCloseTo(Math.PI / 2, 9);
    expect(at(2).rot).toBeCloseTo(Math.PI, 9);
    expect(at(3).rot).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('achsenparallele Wände bekommen rc/rs EXAKT aus der normierten Richtung', () => {
    expect(at(0).rc).toBe(1);
    expect(at(0).rs).toBe(0);
    expect(at(1).rc).toBe(0);
    expect(at(1).rs).toBe(1);
    expect(at(2).rc).toBe(-1);
    expect(at(3).rs).toBe(-1);
  });
});

describe('generateColliders – Regal: vier Beine + ein Baldachin', () => {
  it('die Beine stehen im Spaltband, der Baldachin darüber', () => {
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const source = shelfAt(shelf);
      for (const leg of legsOf(shelf)) {
        expect(leg.y0).toBe(0);
        expect(leg.y1).toBe(source.gapCm / CM_PER_UNIT);
        expect(leg.hx).toBe(source.legHalfCm / CM_PER_UNIT);
        expect(leg.hz).toBe(source.legHalfCm / CM_PER_UNIT);
      }
      expect(canopyOf(shelf).y0).toBe(source.gapCm / CM_PER_UNIT);
      expect(canopyOf(shelf).y1).toBe(source.topCm / CM_PER_UNIT);
      expect(canopyOf(shelf).hx).toBe(source.hx);
      expect(canopyOf(shelf).hz).toBe(source.hz);
      expect(canopyOf(shelf).cx).toBe(source.cx);
      expect(canopyOf(shelf).cz).toBe(source.cz);
    }
  });

  it('die Beine blocken MOUSE|SIGHT und AUSDRÜCKLICH NICHT CAT (D5)', () => {
    for (let shelf = 0; shelf < 2; shelf += 1) {
      for (const leg of legsOf(shelf)) {
        expect(leg.blocks).toBe(MOUSE | SIGHT);
        expect(leg.blocks & CAT).toBe(0);
        expect(leg.blocks & CAMERA).toBe(0);
      }
    }
  });

  it('der Baldachin blockt CAT|SIGHT|CAMERA und nicht MOUSE', () => {
    for (let shelf = 0; shelf < 2; shelf += 1) {
      expect(canopyOf(shelf).blocks).toBe(CAT | SIGHT | CAMERA);
      expect(canopyOf(shelf).blocks & MOUSE).toBe(0);
    }
  });

  it('das achsenparallele Regal 0 setzt seine Beine bündig in die vier Ecken', () => {
    expect(legsOf(0).map((leg) => [leg.cx, leg.cz])).toEqual([
      [expect.closeTo(-5.7, 6), expect.closeTo(3.8, 6)],
      [expect.closeTo(5.7, 6), expect.closeTo(3.8, 6)],
      [expect.closeTo(5.7, 6), expect.closeTo(6.2, 6)],
      [expect.closeTo(-5.7, 6), expect.closeTo(6.2, 6)],
    ]);
  });

  it('das gedrehte Regal 1 dreht die Beine mit: welt = mitte + R(rot) * lokal', () => {
    const source = shelfAt(1);
    const rc = Math.cos(source.rot);
    const rs = Math.sin(source.rot);
    const legHalf = source.legHalfCm / CM_PER_UNIT;
    const signs: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const legs = legsOf(1);
    for (let i = 0; i < 4; i += 1) {
      const sign = signs[i] ?? [0, 0];
      const lx = sign[0] * (source.hx - legHalf);
      const lz = sign[1] * (source.hz - legHalf);
      expect(legs[i]?.cx).toBeCloseTo(source.cx + lx * rc - lz * rs, 6);
      expect(legs[i]?.cz).toBeCloseTo(source.cz + lx * rs + lz * rc, 6);
      expect(legs[i]?.rot).toBe(source.rot);
    }
  });

  it('alle vier Beine haben denselben Abstand zur Regalmitte (drehungsunabhängig)', () => {
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const source = shelfAt(shelf);
      const legHalf = source.legHalfCm / CM_PER_UNIT;
      const dx = source.hx - legHalf;
      const dz = source.hz - legHalf;
      const expected = Math.sqrt(dx * dx + dz * dz);
      for (const leg of legsOf(shelf)) {
        const ax = leg.cx - source.cx;
        const az = leg.cz - source.cz;
        expect(Math.sqrt(ax * ax + az * az)).toBeCloseTo(expected, 6);
      }
    }
  });
});

describe('generateColliders – Kiste', () => {
  it('die Kiste kommt unverändert durch, nur cm werden zu Einheiten', () => {
    const box = at(14);
    expect(box.cx).toBe(10);
    expect(box.cz).toBe(-8);
    expect(box.hx).toBe(1.5);
    expect(box.hz).toBe(1.5);
    expect(box.y0).toBe(0);
    expect(box.y1).toBe(4); // y1Cm 40 / CM_PER_UNIT
    expect(box.rot).toBe(0);
    expect(box.blocks).toBe(MOUSE | CAT | SIGHT | CAMERA);
  });
});

describe('colliderTypes – die beiden Helfer', () => {
  it('createMoveResult liefert einen neutralen Puffer', () => {
    expect(createMoveResult()).toEqual({ x: 0, z: 0, blockedX: false, blockedZ: false, hits: 0 });
  });

  it('overlapsY ist halboffen: bündige Bänder überlappen NICHT', () => {
    expect(overlapsY({ y0: 0, y1: 2 }, { y0: 2, y1: 6 })).toBe(false);
    expect(overlapsY({ y0: 2, y1: 6 }, { y0: 0, y1: 2 })).toBe(false);
    expect(overlapsY({ y0: 0, y1: 2.5 }, { y0: 2, y1: 6 })).toBe(true);
  });
});

/**
 * Der Kernsatz von M3, rein geometrisch nachgerechnet – OHNE Kollisionsabfrage (die kommt in T3).
 * Gebraucht werden nur die erzeugten Kollider und die Körpermaße aus der TEST-Balance.
 */
describe('Maus passt unter das Regal, die Katze nicht', () => {
  it('Höhen: Maus bleibt im Spaltband, die Katze ragt in den Baldachin', () => {
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const canopy = canopyOf(shelf);
      expect(balance.mouse.yRange.y1).toBeLessThan(canopy.y0);
      expect(balance.cat.yRange.y1).toBeGreaterThan(canopy.y0);
      expect(overlapsY(balance.mouse.yRange, canopy)).toBe(false);
      expect(overlapsY(balance.cat.yRange, canopy)).toBe(true);
    }
  });

  it('die Beine halten die Maus auf (Höhenband und Maske), die Katze nicht', () => {
    for (let shelf = 0; shelf < 2; shelf += 1) {
      for (const leg of legsOf(shelf)) {
        expect(overlapsY(balance.mouse.yRange, leg)).toBe(true);
        expect(leg.blocks & MOUSE).toBe(MOUSE);
        expect(leg.blocks & CAT).toBe(0);
      }
    }
  });

  it('lichte Weite: zwischen je zwei benachbarten Beinen passt die Maus durch', () => {
    const mouseWidth = 2 * balance.mouse.radius;
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const legs = legsOf(shelf);
      expect(clearBetween(legs[0] as Collider, legs[1] as Collider)).toBeGreaterThan(mouseWidth);
      expect(clearBetween(legs[0] as Collider, legs[3] as Collider)).toBeGreaterThan(mouseWidth);
      expect(clearBetween(legs[2] as Collider, legs[1] as Collider)).toBeGreaterThan(mouseWidth);
      expect(clearBetween(legs[2] as Collider, legs[3] as Collider)).toBeGreaterThan(mouseWidth);
    }
  });

  it('Regal 0: die schmale Beinseite ist für die Katze zu eng – der Baldachin stoppt sie ohnehin', () => {
    const legs = legsOf(0);
    const narrow = clearBetween(legs[0] as Collider, legs[3] as Collider);
    // 2*(hz - legHalf) - 2*legHalf = 2*1.2 - 0.6. sin/cos sind an den Achsen exakt (T1 klemmt auf
    // [-1,1]), Regal 0 ist also exakt achsenparallel; die Toleranz gilt dem GEDREHTEN Regal 1,
    // dessen rot = PI/4 durch das Polynom laeuft (gemessene Schranke 6.6e-10).
    expect(narrow).toBeCloseTo(1.8, 6);
    expect(narrow).toBeGreaterThan(2 * balance.mouse.radius); // 1.0
    expect(narrow).toBeLessThan(2 * balance.cat.radius); // 2.0
  });

  it('die Zahlen der beiden Fixtures passen zusammen: Maushöhe < Spalt < Katzenhöhe', () => {
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const gap = shelfAt(shelf).gapCm / CM_PER_UNIT;
      expect(balance.mouse.yRange.y1).toBeLessThan(gap);
      expect(gap).toBeLessThan(balance.cat.yRange.y1);
    }
  });
});
