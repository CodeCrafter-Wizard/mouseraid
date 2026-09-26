import { describe, expect, it } from 'vitest';
import {
  colliderCorners, colliderKindOf, colliderToBoxTransform, createBoxTransform,
} from '../../../src/render/levelMeshes';
// Die Farbtafel kommt aus dem Babylon-FREIEN Leaf, nicht über den Re-Export in `materials.ts`: der
// Re-Export funktioniert, aber der Test soll die QUELLE prüfen (R6).
import { GRAYBOX_COLORS, GRAYBOX_KINDS } from '../../../src/render/grayboxColors';
import type { GrayboxKind } from '../../../src/render/grayboxColors';
import { generateColliders } from '../../../src/core/world/generateColliders';
import { loadLevel } from '../../../src/core/world/levelLoad';
import type { LevelBox, LevelDef, LevelPlant, LevelShelf, LevelWall } from '../../../src/core/world/levelTypes';
import feinkostJson from '../../../src/data/levels/feinkost.json';
import miniJson from '../../fixtures/core/mini-level.json';
import { collider, emptyLevel } from '../core/testWorld';

/** Eine Wand mit Länge > 0 – `generateColliders` setzt das voraus. */
function wall(x0: number, x1: number): LevelWall {
  return { x0, z0: 0, x1, z1: 0, heightCm: 200, thicknessCm: 10 };
}

function shelf(cx: number, rot = 0): LevelShelf {
  return { cx, cz: 0, hx: 4, hz: 2, rot, gapCm: 12, topCm: 180, legHalfCm: 3 };
}

function levelBox(cx: number, kind: LevelBox['kind']): LevelBox {
  return { cx, cz: 0, hx: 1, hz: 1, rot: 0, y0Cm: 0, y1Cm: 80, blocks: 15, kind };
}

function plant(id: string): LevelPlant {
  return { id, x: 0, z: 0, radiusCm: 25, heightCm: 60 };
}

/**
 * Ein Level von HAND, in dem jede Gruppe genau einmal vorkommt und die IDs deshalb ABLESBAR sind:
 * 2 Wände (0–1), 1 Regal (2–6), 3 Kisten (7–9), 2 Pflanzen (10–11), Stopfen (12).
 */
function orderedLevel(): LevelDef {
  return emptyLevel({
    walls: [wall(-10, 0), wall(0, 10)],
    shelves: [shelf(0)],
    boxes: [levelBox(-4, 'counter'), levelBox(0, 'window'), levelBox(4, 'crate')],
    plants: [plant('p1'), plant('p2')],
  });
}

describe('levelMeshes: colliderToBoxTransform', () => {
  it('nimmt VOLLE Kantenlängen und die Mitte des Höhenbands', () => {
    const out = colliderToBoxTransform(collider(0, 3, -5, { hx: 2, hz: 0.5, y0: 1, y1: 4 }), createBoxTransform());
    expect(out.x).toBe(3);
    expect(out.z).toBe(-5);
    expect(out.y).toBe(2.5);
    expect(out.width).toBe(4);
    expect(out.depth).toBe(1);
    expect(out.height).toBe(3);
    // `-0` und nicht `0`: die Drehung ist IMMER `-rot`, auch bei rot = 0. Für Babylon ist das
    // dasselbe, für `toEqual` nicht – deshalb stehen die Felder hier einzeln.
    expect(out.rotationY).toBe(-0);
  });

  it('dreht mit UMGEKEHRTEM Vorzeichen – Babylon ist linkshändig', () => {
    const halbePi = Math.PI / 2;
    const out = colliderToBoxTransform(collider(1, 0, 0, { rot: halbePi }), createBoxTransform());
    expect(out.rotationY).toBe(-halbePi);
  });

  it('schreibt in `out` und gibt genau dieses Objekt zurück – kein Bild allokiert', () => {
    const out = createBoxTransform();
    expect(colliderToBoxTransform(collider(2, 1, 1), out)).toBe(out);
  });

  it('createBoxTransform liefert einen neutralen Kasten', () => {
    expect(createBoxTransform()).toEqual({ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, rotationY: 0 });
  });
});

describe('levelMeshes: colliderCorners', () => {
  it('gibt die vier Ecken ungedreht in der vereinbarten Reihenfolge', () => {
    const out = colliderCorners(collider(0, 10, 20, { hx: 3, hz: 1 }), new Float64Array(8));
    expect(Array.from(out)).toEqual([7, 19, 13, 19, 13, 21, 7, 21]);
  });

  it('dreht um PI/2 – aus Halbmaß x wird Ausdehnung z', () => {
    const out = colliderCorners(collider(0, 0, 0, { hx: 3, hz: 1, rot: Math.PI / 2 }), new Float64Array(8));
    // rc = cos(PI/2) = 6,1e-17, rs = 1: die Ecke (-3,-1) landet auf (+1, -3).
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(-3, 12);
    expect(out[4]).toBeCloseTo(-1, 12);
    expect(out[5]).toBeCloseTo(3, 12);
  });

  it('dreht um PI/4 – aus dem Quadrat wird eine Raute, von Hand gerechnet', () => {
    const out = colliderCorners(collider(0, 0, 0, { hx: 2, hz: 2, rot: Math.PI / 4 }), new Float64Array(8));
    const d = 2 * Math.SQRT2;
    // Ein um 45 Grad gedrehtes Quadrat der Halbmaße 2 hat seine Ecken auf den Achsen.
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(-d, 12);
    expect(out[2]).toBeCloseTo(d, 12);
    expect(out[3]).toBeCloseTo(0, 12);
    expect(out[4]).toBeCloseTo(0, 12);
    expect(out[5]).toBeCloseTo(d, 12);
    expect(out[6]).toBeCloseTo(-d, 12);
    expect(out[7]).toBeCloseTo(0, 12);
  });

  it('gibt genau das übergebene Array zurück', () => {
    const out = new Float64Array(8);
    expect(colliderCorners(collider(0, 0, 0), out)).toBe(out);
  });
});

describe('levelMeshes: colliderKindOf (Reihenfolge ist Vertrag)', () => {
  const level = orderedLevel();

  it('Wände stehen vorn', () => {
    expect(colliderKindOf(level, 0)).toBe('wall');
    expect(colliderKindOf(level, 1)).toBe('wall');
  });

  it('Regal: vier Beine, dann der Baldachin', () => {
    expect([2, 3, 4, 5, 6].map((id) => colliderKindOf(level, id)))
      .toEqual(['shelfLeg', 'shelfLeg', 'shelfLeg', 'shelfLeg', 'shelfCanopy']);
  });

  it('Kisten tragen ihre eigene `kind`', () => {
    expect([7, 8, 9].map((id) => colliderKindOf(level, id))).toEqual(['counter', 'window', 'crate']);
  });

  it('Pflanzen, dann GENAU EIN Stopfen', () => {
    expect([10, 11, 12].map((id) => colliderKindOf(level, id))).toEqual(['plant', 'plant', 'holePlug']);
  });

  it('eine id ausserhalb faellt auf `crate` zurück – auch eine negative oder gebrochene', () => {
    expect(colliderKindOf(level, 13)).toBe('crate');
    expect(colliderKindOf(level, -1)).toBe('crate');
    expect(colliderKindOf(level, 1.5)).toBe('crate');
  });

  it('ein Level OHNE Grundformen hat genau den Stopfen', () => {
    const leer = emptyLevel();
    expect(colliderKindOf(leer, 0)).toBe('holePlug');
    expect(colliderKindOf(leer, 1)).toBe('crate');
  });

  it('die Ableitung passt zu `generateColliders` – Stückzahlen je Art, kein Literal', () => {
    // Das ist der Wächter über Abweichung 14: wer die Erzeugungsreihenfolge im Kern ändert, bekommt
    // hier eine rote Zeile statt still vertauschter Farben. Geprüft wird STRUKTURELL gegen die
    // Listenlängen des Levels – keine Zahl aus `feinkost.json` steht im Test.
    for (const def of [loadLevel(feinkostJson), loadLevel(miniJson)]) {
      const kinds = generateColliders(def).map((c) => colliderKindOf(def, c.id));
      const count = (kind: GrayboxKind): number => kinds.filter((k) => k === kind).length;
      expect(count('wall')).toBe(def.walls.length);
      expect(count('shelfLeg')).toBe(def.shelves.length * 4);
      expect(count('shelfCanopy')).toBe(def.shelves.length);
      expect(count('plant')).toBe(def.plants.length);
      expect(count('holePlug')).toBe(1);
      expect(count('crate') + count('counter') + count('vitrine') + count('window'))
        .toBe(def.boxes.length);
      // Jede Kiste behält ihre eigene Bauart, in ihrer eigenen Reihenfolge.
      const boxBase = def.walls.length + def.shelves.length * 5;
      expect(def.boxes.map((box) => box.kind))
        .toEqual(kinds.slice(boxBase, boxBase + def.boxes.length));
    }
  });
});

describe('levelMeshes: die Farbtafel deckt jede Art ab', () => {
  it('GRAYBOX_KINDS und GRAYBOX_COLORS haben dieselben vierzehn Einträge', () => {
    expect(GRAYBOX_KINDS).toHaveLength(14);
    for (const kind of GRAYBOX_KINDS) {
      const rgb = GRAYBOX_COLORS[kind];
      expect(rgb).toHaveLength(3);
      for (const channel of rgb) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('GRAYBOX_KINDS hat keine Duplikate und deckt GENAU die Schlüssel von GRAYBOX_COLORS (Task-3-Review, Minor 3)', () => {
    // Der Kommentar in `grayboxColors.ts:16` behauptet „ein Test hält beide Listen aneinander" –
    // die Länge allein tut das nicht: 'wall' doppelt und 'cat' fehlend hätte auch 14 Einträge.
    const unique = new Set(GRAYBOX_KINDS);
    expect(unique.size).toBe(GRAYBOX_KINDS.length);
    expect([...GRAYBOX_KINDS].sort()).toEqual(Object.keys(GRAYBOX_COLORS).sort());
  });
});
