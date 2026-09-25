import { describe, expect, it } from 'vitest';
import type { Collider, YRange } from '../../../../src/core/world/colliderTypes';
import { ALL_MASKS, CAMERA, CAT, MOUSE, SIGHT, createMoveResult } from '../../../../src/core/world/colliderTypes';
import {
  MAX_SLIDES,
  SKIN,
  SUPPORT_TOLERANCE,
  checkSupport,
  moveCircle,
  rayCast3,
  segmentBlocked,
  sweepCircle,
} from '../../../../src/core/world/collision';

// Tests liegen AUSSERHALB von src/core und duerfen deshalb Math.cos/Math.sin als Referenz benutzen
// (die Kollider tragen rc/rs ohnehin als Daten – zur Laufzeit rechnet der Kern kein Trig).

interface BoxSpec {
  id: number;
  cx: number; cz: number;
  hx: number; hz: number;
  y0: number; y1: number;
  rot?: number;
  blocks: number;
  group?: number;
}

function box(spec: BoxSpec): Collider {
  const rot = spec.rot ?? 0;
  return {
    id: spec.id,
    cx: spec.cx, cz: spec.cz,
    hx: spec.hx, hz: spec.hz,
    y0: spec.y0, y1: spec.y1,
    rot,
    rc: Math.cos(rot),
    rs: Math.sin(rot),
    blocks: spec.blocks,
    occluderGroup: spec.group ?? 0,
  };
}

/** Vorzeichenbehafteter Abstand des Mittelpunkts zum RECHTECK (negativ = im Kasten). */
function distanceToBox(x: number, z: number, c: Collider): number {
  const ox = x - c.cx;
  const oz = z - c.cz;
  const lx = ox * c.rc + oz * c.rs;
  const lz = -ox * c.rs + oz * c.rc;
  const dx = Math.abs(lx) - c.hx;
  const dz = Math.abs(lz) - c.hz;
  if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
  const ex = dx > 0 ? dx : 0;
  const ez = dz > 0 ? dz : 0;
  return Math.sqrt(ex * ex + ez * ez);
}

const MOUSE_Y: YRange = { y0: 0, y1: 1.9 };
const CAT_Y: YRange = { y0: 0, y1: 3 };
const MOUSE_R = 0.4;
const CAT_R = 1.2;

// Ein Regal wie generateColliders (T2) es baut: vier Beine (MOUSE|SIGHT, y 0..2) und EIN Baldachin
// ueber der ganzen Grundflaeche (CAT|SIGHT|CAMERA, y 2..5). Die Beine blocken CAT ausdruecklich nicht.
const SHELF_H = 2.5;
const LEG_HALF = 0.3;
const GAP = 2;
const TOP = 5;
const LEG_OFFSET = SHELF_H - LEG_HALF;

function shelfLegs(): Collider[] {
  return [
    box({ id: 0, cx: -LEG_OFFSET, cz: -LEG_OFFSET, hx: LEG_HALF, hz: LEG_HALF, y0: 0, y1: GAP, blocks: MOUSE | SIGHT, group: 1 }),
    box({ id: 1, cx: LEG_OFFSET, cz: -LEG_OFFSET, hx: LEG_HALF, hz: LEG_HALF, y0: 0, y1: GAP, blocks: MOUSE | SIGHT, group: 1 }),
    box({ id: 2, cx: -LEG_OFFSET, cz: LEG_OFFSET, hx: LEG_HALF, hz: LEG_HALF, y0: 0, y1: GAP, blocks: MOUSE | SIGHT, group: 1 }),
    box({ id: 3, cx: LEG_OFFSET, cz: LEG_OFFSET, hx: LEG_HALF, hz: LEG_HALF, y0: 0, y1: GAP, blocks: MOUSE | SIGHT, group: 1 }),
  ];
}

function shelfCanopy(): Collider {
  return box({ id: 4, cx: 0, cz: 0, hx: SHELF_H, hz: SHELF_H, y0: GAP, y1: TOP, blocks: CAT | SIGHT | CAMERA, group: 1 });
}

function shelf(): Collider[] {
  const parts = shelfLegs();
  parts.push(shelfCanopy());
  return parts;
}

describe('Konstanten', () => {
  it('haelt die gemessenen Werte fest', () => {
    // 1 Gleitschritt klemmt an jeder Wand fest (4992/10000 Ticks), 2 und 3 je 281, 4 bringt nichts mehr.
    expect(MAX_SLIDES).toBe(3);
    expect(SKIN).toBe(1e-4);
    expect(SUPPORT_TOLERANCE).toBe(0.1);
  });
});

describe('moveCircle: Grundfaelle', () => {
  it('ohne Kollider bleibt die Bewegung unveraendert und out wird zurueckgegeben', () => {
    const out = createMoveResult();
    const res = moveCircle({ x: 1, z: 2 }, { x: 0.3, z: -0.4 }, MOUSE_R, MOUSE_Y, MOUSE, [], out);
    expect(res).toBe(out);
    expect(res.x).toBeCloseTo(1.3, 12);
    expect(res.z).toBeCloseTo(1.6, 12);
    expect(res.hits).toBe(0);
    expect(res.blockedX).toBe(false);
    expect(res.blockedZ).toBe(false);
  });

  it('stoppt frontal vor einer achsparallelen Wand (SKIN Rest-Abstand)', () => {
    const wall = box({ id: 0, cx: 0, cz: 5, hx: 10, hz: 0.5, y0: 0, y1: 3, blocks: ALL_MASKS });
    const res = moveCircle({ x: 0, z: 3 }, { x: 0, z: 2 }, MOUSE_R, MOUSE_Y, MOUSE, [wall], createMoveResult());
    expect(res.z).toBeCloseTo(4.5 - MOUSE_R - SKIN, 9);
    expect(res.x).toBeCloseTo(0, 12);
    expect(res.blockedZ).toBe(true);
    expect(res.blockedX).toBe(false);
    expect(res.hits).toBe(1);
    expect(distanceToBox(res.x, res.z, wall)).toBeGreaterThan(MOUSE_R);
  });

  it('gleitet an der Wand und behaelt das Tangentialtempo vollstaendig', () => {
    const wall = box({ id: 0, cx: 0, cz: 5, hx: 10, hz: 0.5, y0: 0, y1: 3, blocks: ALL_MASKS });
    const res = moveCircle({ x: 0, z: 3 }, { x: 2, z: 2 }, MOUSE_R, MOUSE_Y, MOUSE, [wall], createMoveResult());
    // Tangential (x) kommt der ganze Weg an, normal (z) wird an der Flaeche abgeschnitten.
    expect(res.x).toBeCloseTo(2, 9);
    expect(res.z).toBeCloseTo(4.5 - MOUSE_R - SKIN, 9);
    expect(res.blockedZ).toBe(true);
    expect(res.blockedX).toBe(false);
    expect(res.hits).toBe(1);
  });

  it('gleitet auch an einer gedrehten Wand tangential weiter', () => {
    const rot = Math.PI / 4;
    const wall = box({ id: 0, cx: 0, cz: 0, hx: 2, hz: 0.5, rot, y0: 0, y1: 3, blocks: ALL_MASKS });
    const start = { x: 2, z: -2 };
    const delta = { x: 0, z: 3 };
    const res = moveCircle(start, delta, 0.5, MOUSE_Y, MOUSE, [wall], createMoveResult());
    const tx = Math.cos(rot);
    const tz = Math.sin(rot);
    const gotTangential = (res.x - start.x) * tx + (res.z - start.z) * tz;
    expect(gotTangential).toBeCloseTo(delta.x * tx + delta.z * tz, 9);
    expect(distanceToBox(res.x, res.z, wall)).toBeGreaterThan(0.5);
    expect(res.hits).toBe(1);
  });

  it('ignoriert Kollider ohne passendes Maskenbit (reine SIGHT-Box)', () => {
    const glass = box({ id: 0, cx: 0, cz: 5, hx: 10, hz: 0.5, y0: 0, y1: 3, blocks: SIGHT });
    const res = moveCircle({ x: 0, z: 3 }, { x: 0, z: 4 }, MOUSE_R, MOUSE_Y, MOUSE, [glass], createMoveResult());
    expect(res.z).toBeCloseTo(7, 12);
    expect(res.hits).toBe(0);
    expect(res.blockedZ).toBe(false);
  });

  it('ignoriert Kollider ohne Hoehenband-Ueberlappung', () => {
    const highBeam = box({ id: 0, cx: 0, cz: 5, hx: 10, hz: 0.5, y0: 2, y1: 3, blocks: ALL_MASKS });
    const res = moveCircle({ x: 0, z: 3 }, { x: 0, z: 4 }, MOUSE_R, MOUSE_Y, MOUSE, [highBeam], createMoveResult());
    expect(res.z).toBeCloseTo(7, 12);
    expect(res.hits).toBe(0);
  });

  it('bleibt in einer Innenecke stehen, ohne in eine der Waende zu geraten', () => {
    const walls = [
      box({ id: 0, cx: 3, cz: 0, hx: 0.5, hz: 6, y0: 0, y1: 3, blocks: ALL_MASKS }),
      box({ id: 1, cx: 0, cz: 3, hx: 6, hz: 0.5, y0: 0, y1: 3, blocks: ALL_MASKS }),
    ];
    const out = createMoveResult();
    let x = 0;
    let z = 0;
    for (let tick = 0; tick < 20; tick += 1) {
      moveCircle({ x, z }, { x: 0.5, z: 0.5 }, MOUSE_R, MOUSE_Y, MOUSE, walls, out);
      x = out.x;
      z = out.z;
      expect(distanceToBox(x, z, walls[0] as Collider)).toBeGreaterThan(MOUSE_R - 1e-9);
      expect(distanceToBox(x, z, walls[1] as Collider)).toBeGreaterThan(MOUSE_R - 1e-9);
    }
    expect(x).toBeCloseTo(2.5 - MOUSE_R - SKIN, 6);
    expect(z).toBeCloseTo(2.5 - MOUSE_R - SKIN, 6);
    expect(out.blockedX).toBe(true);
    expect(out.blockedZ).toBe(true);
  });
});

describe('moveCircle: Tempo-Sweep gegen duenne Waende', () => {
  // Die Fassung "bewegen + herausdruecken" tunnelt gemessen ab |d| > hz + r durch (Maus r 0.4
  // gegen ein Regalbein hz 0.3 schon beim Sprint). Der TOI-Sweep haelt jede Kombination.
  it.each([0.05, 0.1, 0.3, 1])('haelt eine Wand der Halbdicke %s von 0,8 bis 100 u/Tick', (half) => {
    const wall = box({ id: 0, cx: 0, cz: 0, hx: 20, hz: half, y0: 0, y1: 3, blocks: ALL_MASKS });
    const start = { x: 0, z: -(half + MOUSE_R + 0.5) };
    for (const speed of [0.8, 1.6, 6.4, 20, 100]) {
      const res = moveCircle(start, { x: 0, z: speed }, MOUSE_R, MOUSE_Y, MOUSE, [wall], createMoveResult());
      expect(res.z).toBeCloseTo(-half - MOUSE_R - SKIN, 9);
      expect(res.blockedZ).toBe(true);
    }
  });
});

describe('moveCircle: Gleichstand und Reihenfolge', () => {
  // Zwei an der x-Achse gespiegelte Kisten: der Bewegte faehrt genau in die Luecke und trifft
  // beide Eckkreise bei BIT-GLEICHEM t (die Rechnung der einen ist die gespiegelte der anderen).
  // Damit entscheidet allein die id – und das ist sichtbar: die gewinnende Kiste schiebt den
  // Bewegten auf IHRE Gegenseite.
  function tieBox(id: number, side: number): Collider {
    return box({ id, cx: 2.4, cz: 1.35 * side, hx: 1, hz: 1, y0: 0, y1: 3, blocks: ALL_MASKS });
  }
  const start = { x: 0, z: 0 };
  const delta = { x: 2, z: 0 };

  it('nimmt bei gleichem t den Kollider mit der kleineren id', () => {
    const upperWins = moveCircle(start, delta, MOUSE_R, MOUSE_Y, MOUSE, [tieBox(0, 1), tieBox(1, -1)], createMoveResult());
    const lowerWins = moveCircle(start, delta, MOUSE_R, MOUSE_Y, MOUSE, [tieBox(1, 1), tieBox(0, -1)], createMoveResult());
    // Der Bewegte verkeilt sich anschliessend zwischen beiden Kisten (Luecke 0.7 < 2r), landet
    // aber auf der Seite, die der GEWINNER vorgibt: gemessen -3.0335e-5 bzw. +3.0335e-5.
    expect(upperWins.z).toBeLessThan(0);
    expect(Math.abs(upperWins.z)).toBeGreaterThan(1e-6);
    expect(lowerWins.z).toBe(-upperWins.z);           // exakt gespiegelt
    expect(lowerWins.x).toBe(upperWins.x);
  });

  it('haengt nicht von der Reihenfolge im Array ab, nur von der id', () => {
    const a = moveCircle(start, delta, MOUSE_R, MOUSE_Y, MOUSE, [tieBox(0, 1), tieBox(1, -1)], createMoveResult());
    const b = moveCircle(start, delta, MOUSE_R, MOUSE_Y, MOUSE, [tieBox(1, -1), tieBox(0, 1)], createMoveResult());
    expect(b.x).toBe(a.x);
    expect(b.z).toBe(a.z);
    expect(b.hits).toBe(a.hits);
  });
});

describe('moveCircle: Falle 1 – Start in der Eckzone des aufgeblaehten Rechtecks', () => {
  // Der Startpunkt liegt INNERHALB des scharf um r aufgeblaehten Rechtecks (|lx| < hx+r UND
  // |lz| < hz+r), aber ausserhalb des abgerundeten Minkowski-Koerpers (Abstand 0.566 > r = 0.5).
  // Ein reiner Slab-Test gegen das aufgeblaehte Rechteck liefert hier kein t > 0, ignoriert den
  // Kollider fuer den ganzen Schritt – und der Bewegte laeuft hindurch.
  const wall = box({ id: 0, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 3, blocks: ALL_MASKS });
  const radius = 0.5;
  const start = { x: 1.4, z: 1.4 };

  it('erkennt den Kollider trotzdem und laesst den Bewegten nicht hindurch', () => {
    expect(Math.abs(start.x)).toBeLessThan(wall.hx + radius); // Eckzone, Bedingung (a)
    expect(Math.abs(start.z)).toBeLessThan(wall.hz + radius); // Eckzone, Bedingung (b)
    expect(distanceToBox(start.x, start.z, wall)).toBeGreaterThan(radius); // aber nicht eingedrungen

    const res = moveCircle(start, { x: -0.6, z: 0 }, radius, MOUSE_Y, MOUSE, [wall], createMoveResult());
    expect(res.hits).toBeGreaterThanOrEqual(1);
    // Die naive Fassung landete bei (0.8, 1.4) – Abstand 0.4 < r, also IM Kasten.
    expect(distanceToBox(res.x, res.z, wall)).toBeGreaterThan(radius - 1e-9);
  });

  it('haelt die Ecke auch ueber viele Ticks hinweg', () => {
    const out = createMoveResult();
    let x = start.x;
    let z = start.z;
    for (let tick = 0; tick < 40; tick += 1) {
      moveCircle({ x, z }, { x: -0.6, z: -0.05 }, radius, MOUSE_Y, MOUSE, [wall], out);
      x = out.x;
      z = out.z;
      expect(distanceToBox(x, z, wall)).toBeGreaterThan(radius - 1e-9);
    }
  });

  it('drueckt einen schon eingedrungenen Bewegten heraus (t = 0 mit Herausdrueck-Normale)', () => {
    const res = moveCircle({ x: 1.2, z: 0 }, { x: 0.01, z: 0 }, radius, MOUSE_Y, MOUSE, [wall], createMoveResult());
    expect(res.hits).toBe(1);
    // Erst heraus an die Oberflaeche, DANN die Restbewegung – sie geht nicht verloren.
    expect(res.x).toBeCloseTo(1 + radius + SKIN + 0.01, 9);
    expect(distanceToBox(res.x, res.z, wall)).toBeGreaterThan(radius);
  });

  it('fragt bei einer Bewegung von genau (0,0) gar nichts ab', () => {
    // Bewusst: ein stehender Bewegter kostet keine Abfrage. Herausgedrueckt wird er beim
    // naechsten Schritt MIT Bewegung (Test darueber) – eingedrungene Lagen erzeugt der Kern nicht.
    const res = moveCircle({ x: 1.2, z: 0 }, { x: 0, z: 0 }, radius, MOUSE_Y, MOUSE, [wall], createMoveResult());
    expect(res.hits).toBe(0);
    expect(res.x).toBe(1.2);
    expect(res.z).toBe(0);
  });
});

describe('moveCircle: Falle 2 – die Ueberlappungsregel gilt je BEWEGTEM', () => {
  it('laesst die Maus unter dem Baldachin durch, das Regalbein haelt sie auf', () => {
    const parts = shelf();
    const through = moveCircle({ x: 0, z: -6 }, { x: 0, z: 12 }, MOUSE_R, MOUSE_Y, MOUSE, parts, createMoveResult());
    expect(through.hits).toBe(0);
    expect(through.z).toBeCloseTo(6, 12);

    const atLeg = moveCircle({ x: LEG_OFFSET, z: -6 }, { x: 0, z: 12 }, MOUSE_R, MOUSE_Y, MOUSE, parts, createMoveResult());
    expect(atLeg.hits).toBeGreaterThanOrEqual(1);
    expect(atLeg.z).toBeCloseTo(-LEG_OFFSET - LEG_HALF - MOUSE_R - SKIN, 9);
    expect(atLeg.blockedZ).toBe(true);
  });

  it('stoppt die Katze am Baldachin – die Beine blocken CAT ausdruecklich nicht', () => {
    const legsOnly = shelfLegs();
    const catThroughLegs = moveCircle({ x: LEG_OFFSET, z: -6 }, { x: 0, z: 12 }, CAT_R, CAT_Y, CAT, legsOnly, createMoveResult());
    expect(catThroughLegs.hits).toBe(0);
    expect(catThroughLegs.z).toBeCloseTo(6, 12);

    const parts = shelf();
    const atCanopy = moveCircle({ x: LEG_OFFSET, z: -6 }, { x: 0, z: 12 }, CAT_R, CAT_Y, CAT, parts, createMoveResult());
    // Gemessene Erwartung des Faktenblatts: Baldachinkante 2.5 + Katzenradius 1.2 = 3.7.
    expect(atCanopy.z).toBeCloseTo(-SHELF_H - CAT_R - SKIN, 9);
    expect(atCanopy.blockedZ).toBe(true);
  });

  it('drueckt die Katze auch nach 30 Ticks Dauerdruck nirgends hinein', () => {
    const parts = shelf();
    const out = createMoveResult();
    let x = LEG_OFFSET;
    let z = -6;
    for (let tick = 0; tick < 30; tick += 1) {
      moveCircle({ x, z }, { x: 0, z: 0.5 }, CAT_R, CAT_Y, CAT, parts, out);
      expect(out.z).toBeGreaterThanOrEqual(z - 1e-9); // kein Rueckstoss durch widerspruechliche Normalen
      x = out.x;
      z = out.z;
      for (const c of parts) {
        if ((c.blocks & CAT) === 0) continue;
        if (!(CAT_Y.y0 < c.y1 && c.y0 < CAT_Y.y1)) continue;
        expect(distanceToBox(x, z, c)).toBeGreaterThan(CAT_R - 1e-9);
      }
    }
    expect(z).toBeCloseTo(-SHELF_H - CAT_R - SKIN, 6);
  });
});

describe('segmentBlocked', () => {
  const parts = shelf();
  const eye: YRange = { y0: 2.5, y1: 2.6 };
  const floor: YRange = { y0: 0.3, y1: 0.4 };

  it('blockiert die Sichtlinie auf Baldachinhoehe quer ueber das Regal', () => {
    expect(segmentBlocked({ x: -8, z: 0 }, { x: 8, z: 0 }, eye, SIGHT, parts)).toBe(true);
  });

  it('laesst die Sichtlinie knapp ueber dem Boden zwischen zwei Beinen frei', () => {
    expect(segmentBlocked({ x: -8, z: 0 }, { x: 8, z: 0 }, floor, SIGHT, parts)).toBe(false);
  });

  it('blockiert die Sichtlinie knapp ueber dem Boden genau auf ein Bein', () => {
    expect(segmentBlocked({ x: -8, z: LEG_OFFSET }, { x: 8, z: LEG_OFFSET }, floor, SIGHT, parts)).toBe(true);
  });

  it('achtet auf die Maske: eine reine CAMERA-Blende haelt keine Sichtlinie auf', () => {
    const blind = [box({ id: 0, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 3, blocks: CAMERA })];
    expect(segmentBlocked({ x: -5, z: 0 }, { x: 5, z: 0 }, floor, SIGHT, blind)).toBe(false);
    expect(segmentBlocked({ x: -5, z: 0 }, { x: 5, z: 0 }, floor, CAMERA, blind)).toBe(true);
  });

  it('endet die Strecke vor dem Kollider, ist sie frei', () => {
    const wall = [box({ id: 0, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 3, blocks: ALL_MASKS })];
    expect(segmentBlocked({ x: -5, z: 0 }, { x: -1.5, z: 0 }, floor, SIGHT, wall)).toBe(false);
    expect(segmentBlocked({ x: -5, z: 0 }, { x: -0.5, z: 0 }, floor, SIGHT, wall)).toBe(true);
  });

  it('beginnt die Strecke im Kollider, ist sie blockiert', () => {
    const wall = [box({ id: 0, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 3, blocks: ALL_MASKS })];
    expect(segmentBlocked({ x: 0, z: 0 }, { x: 5, z: 0 }, floor, SIGHT, wall)).toBe(true);
  });

  it('rechnet im lokalen Rahmen: die gedrehte Wand blockt quer, nicht laengs', () => {
    const rot = Math.PI / 4;
    const wall = [box({ id: 0, cx: 0, cz: 0, hx: 3, hz: 0.2, rot, y0: 0, y1: 3, blocks: ALL_MASKS })];
    expect(segmentBlocked({ x: 2, z: -2 }, { x: -2, z: 2 }, floor, SIGHT, wall)).toBe(true);
    expect(segmentBlocked({ x: 2, z: -2 }, { x: 4, z: -4 }, floor, SIGHT, wall)).toBe(false);
  });
});

describe('sweepCircle', () => {
  // M4 baut damit die Nav-Kanten: passt der Kreis von a nach b durch?
  const gate = [
    box({ id: 0, cx: -2, cz: 0, hx: 1, hz: 0.3, y0: 0, y1: 3, blocks: ALL_MASKS }),
    box({ id: 1, cx: 2, cz: 0, hx: 1, hz: 0.3, y0: 0, y1: 3, blocks: ALL_MASKS }),
  ];

  it('laesst eine Kante durch eine Luecke breiter als 2r durch', () => {
    expect(sweepCircle({ x: 0, z: -3 }, { x: 0, z: 3 }, 0.4, MOUSE_Y, MOUSE, gate)).toBe(false);
  });

  it('sperrt dieselbe Kante fuer einen groesseren Radius (Engpass)', () => {
    expect(sweepCircle({ x: 0, z: -3 }, { x: 0, z: 3 }, 1.2, CAT_Y, CAT, gate)).toBe(true);
  });

  it('laesst eine Kante knapp an einer Wand vorbei frei', () => {
    expect(sweepCircle({ x: -1.5, z: -3 }, { x: -1.5, z: -0.75 }, 0.4, MOUSE_Y, MOUSE, gate)).toBe(false);
    expect(sweepCircle({ x: -1.5, z: -3 }, { x: -1.5, z: -0.65 }, 0.4, MOUSE_Y, MOUSE, gate)).toBe(true);
  });

  it('meldet eine Kante blockiert, die schon im Kollider beginnt', () => {
    expect(sweepCircle({ x: -2, z: 0 }, { x: -2, z: 5 }, 0.4, MOUSE_Y, MOUSE, gate)).toBe(true);
  });

  it('achtet auf Maske und Hoehenband wie moveCircle', () => {
    const parts = shelf();
    expect(sweepCircle({ x: 0, z: -6 }, { x: 0, z: 6 }, MOUSE_R, MOUSE_Y, MOUSE, parts)).toBe(false);
    expect(sweepCircle({ x: 0, z: -6 }, { x: 0, z: 6 }, CAT_R, CAT_Y, CAT, parts)).toBe(true);
  });
});

describe('rayCast3', () => {
  const parts = shelf();

  it('trifft den Baldachin von oben (Kamera-Boom) und liefert die Entfernung', () => {
    const hit = rayCast3({ x: 0, y: 12, z: 0 }, { x: 0, y: -1, z: 0 }, 20, CAMERA, parts);
    expect(hit).not.toBeNull();
    expect(hit?.id).toBe(4);
    expect(hit?.t).toBeCloseTo(7, 9); // 12 - TOP
  });

  it('liefert null, wenn der Strahl daneben geht', () => {
    expect(rayCast3({ x: 9, y: 12, z: 0 }, { x: 0, y: -1, z: 0 }, 20, CAMERA, parts)).toBeNull();
  });

  it('liefert null, wenn maxDist vor dem Treffer endet', () => {
    expect(rayCast3({ x: 0, y: 12, z: 0 }, { x: 0, y: -1, z: 0 }, 6, CAMERA, parts)).toBeNull();
  });

  it('ignoriert Kollider ohne Maskenbit (Beine sind fuer die Kamera unsichtbar)', () => {
    const legs = shelfLegs();
    expect(rayCast3({ x: LEG_OFFSET, y: 12, z: LEG_OFFSET }, { x: 0, y: -1, z: 0 }, 20, CAMERA, legs)).toBeNull();
    // Derselbe Strahl mit MOUSE trifft das vordere Bein (id 1 liegt bei -LEG_OFFSET in z).
    expect(rayCast3({ x: LEG_OFFSET, y: 1, z: -8 }, { x: 0, y: 0, z: 1 }, 20, MOUSE, legs)?.id).toBe(1);
  });

  it('nimmt den naechsten Treffer, bei Gleichstand die kleinere id', () => {
    const near = box({ id: 7, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 2, blocks: CAMERA });
    const far = box({ id: 3, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 5, blocks: CAMERA });
    // far reicht hoeher hinauf, wird also FRUEHER getroffen – die id entscheidet hier nicht.
    expect(rayCast3({ x: 0, y: 9, z: 0 }, { x: 0, y: -1, z: 0 }, 20, CAMERA, [near, far])?.id).toBe(3);
    const twinA = box({ id: 5, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 2, blocks: CAMERA });
    const twinB = box({ id: 2, cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 2, blocks: CAMERA });
    expect(rayCast3({ x: 0, y: 9, z: 0 }, { x: 0, y: -1, z: 0 }, 20, CAMERA, [twinA, twinB])?.id).toBe(2);
    expect(rayCast3({ x: 0, y: 9, z: 0 }, { x: 0, y: -1, z: 0 }, 20, CAMERA, [twinB, twinA])?.id).toBe(2);
  });

  it('dreht den Strahl in den lokalen Rahmen (Drehung nur um Y)', () => {
    const rot = Math.PI / 4;
    const slab = [box({ id: 0, cx: 0, cz: 0, hx: 4, hz: 0.25, rot, y0: 0, y1: 3, blocks: CAMERA })];
    const along = Math.SQRT1_2;
    expect(rayCast3({ x: -3, y: 1, z: 3 }, { x: along, y: 0, z: -along }, 20, CAMERA, slab)).not.toBeNull();
    expect(rayCast3({ x: 3, y: 1, z: 3 }, { x: along, y: 0, z: -along }, 20, CAMERA, slab)).toBeNull();
  });

  it('liefert t = 0, wenn der Ursprung schon im Kollider liegt', () => {
    const hit = rayCast3({ x: 0, y: 3, z: 0 }, { x: 0, y: -1, z: 0 }, 20, CAMERA, parts);
    expect(hit?.t).toBe(0);
  });
});

describe('checkSupport', () => {
  const parts = shelf();

  it('findet die Deckflaeche des Baldachins innerhalb der Toleranz', () => {
    expect(checkSupport({ x: 0, z: 0 }, TOP, SUPPORT_TOLERANCE, parts)).toBe(true);
    expect(checkSupport({ x: 0, z: 0 }, TOP + 0.05, SUPPORT_TOLERANCE, parts)).toBe(true);
    expect(checkSupport({ x: 0, z: 0 }, TOP + 0.5, SUPPORT_TOLERANCE, parts)).toBe(false);
  });

  it('prueft den Grundriss: neben dem Regal traegt nichts', () => {
    expect(checkSupport({ x: 6, z: 0 }, TOP, SUPPORT_TOLERANCE, parts)).toBe(false);
  });

  it('findet auch die Oberkante eines Beins (y1 = gapCm)', () => {
    expect(checkSupport({ x: LEG_OFFSET, z: LEG_OFFSET }, GAP, SUPPORT_TOLERANCE, parts)).toBe(true);
    expect(checkSupport({ x: 0, z: 0 }, GAP, SUPPORT_TOLERANCE, parts)).toBe(false);
  });

  it('rechnet den Grundriss im lokalen Rahmen einer gedrehten Kiste', () => {
    const rot = Math.PI / 4;
    const crate = [box({ id: 0, cx: 0, cz: 0, hx: 3, hz: 0.5, rot, y0: 0, y1: 1, blocks: ALL_MASKS })];
    expect(checkSupport({ x: 1.5, z: 1.5 }, 1, SUPPORT_TOLERANCE, crate)).toBe(true);
    expect(checkSupport({ x: 1.5, z: -1.5 }, 1, SUPPORT_TOLERANCE, crate)).toBe(false);
  });
});
