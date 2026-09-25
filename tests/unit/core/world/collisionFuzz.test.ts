import { describe, expect, it } from 'vitest';
import type { RngState } from '../../../../src/core/math/rng';
import { nextInt, nextRange, seedRng } from '../../../../src/core/math/rng';
import type { Collider, MoveResult, YRange } from '../../../../src/core/world/colliderTypes';
import { ALL_MASKS, CAMERA, CAT, MOUSE, SIGHT, createMoveResult } from '../../../../src/core/world/colliderTypes';
import { moveCircle, segmentBlocked } from '../../../../src/core/world/collision';

// D14: 10 000 Ticks x 8 Bewegte gegen 60 gesaete OBBs. Der Fuzz sichert DREI Invarianten:
// (1) alle Zahlen endlich, (2) nie in einem blockierenden Kasten, (3) die Strecke alt->neu
// kreuzt keinen blockierenden Kasten (sonst waere der Bewegte hindurchgesprungen).
// Keine Zeit-Zusicherung – Tempo misst `npm run core:bench` (T6).
const TICKS = 10_000;
const MOVERS = 8;

interface Mover {
  x: number; z: number;
  radius: number;
  yRange: YRange;
  mask: number;
  angle: number;
  speed: number;
}

const MOUSE_Y: YRange = { y0: 0, y1: 1.9 };
const CAT_Y: YRange = { y0: 0, y1: 3 };

/** Vorzeichenbehafteter Abstand zum RECHTECK (negativ = im Kasten) – die Gegenrechnung zum Kern. */
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

function obb(id: number, cx: number, cz: number, hx: number, hz: number, rot: number, y0: number, y1: number, blocks: number): Collider {
  return { id, cx, cz, hx, hz, y0, y1, rot, rc: Math.cos(rot), rs: Math.sin(rot), blocks, occluderGroup: 0 };
}

/** Vier Aussenwaende, damit die Bewegten im Feld bleiben (Halbdicke frei waehlbar). */
function arena(half: number, thick: number, y1: number, startId: number): Collider[] {
  return [
    obb(startId, 0, -half, half + thick, thick, 0, 0, y1, ALL_MASKS),
    obb(startId + 1, 0, half, half + thick, thick, 0, 0, y1, ALL_MASKS),
    obb(startId + 2, -half, 0, thick, half + thick, 0, 0, y1, ALL_MASKS),
    obb(startId + 3, half, 0, thick, half + thick, 0, 0, y1, ALL_MASKS),
  ];
}

/** Wirksam = Maskenbit gesetzt UND Hoehenbaender ueberlappen sich (die Regel gilt je BEWEGTEM). */
function blocksMover(c: Collider, m: Mover): boolean {
  return (c.blocks & m.mask) !== 0 && m.yRange.y0 < c.y1 && c.y0 < m.yRange.y1;
}

function placeMovers(rng: RngState, colliders: readonly Collider[], reach: number): Mover[] {
  const movers: Mover[] = [];
  for (let i = 0; i < MOVERS; i += 1) {
    const isCat = i % 2 === 1;
    const mover: Mover = {
      x: 0, z: 0,
      radius: isCat ? 1.2 : 0.4,
      yRange: isCat ? CAT_Y : MOUSE_Y,
      mask: isCat ? CAT : MOUSE,
      angle: nextRange(rng, -Math.PI, Math.PI),
      speed: isCat ? 1 : 0.8,
    };
    for (let attempt = 0; attempt < 400; attempt += 1) {
      mover.x = nextRange(rng, -reach, reach);
      mover.z = nextRange(rng, -reach, reach);
      let free = true;
      for (const c of colliders) {
        if (!blocksMover(c, mover)) continue;
        if (distanceToBox(mover.x, mover.z, c) < mover.radius + 0.25) { free = false; break; }
      }
      if (free) break;
    }
    movers.push(mover);
  }
  return movers;
}

/**
 * Laesst die Bewegten TICKS Schritte laufen und sammelt Regelverstoesse (hoechstens fuenf, damit die
 * Fehlermeldung lesbar bleibt). Ein `expect` je Tick waere hunderttausendfach und unnoetig langsam.
 */
function run(rng: RngState, colliders: readonly Collider[], movers: Mover[], ticks: number, bounds: number): string[] {
  const problems: string[] = [];
  const out: MoveResult = createMoveResult();
  const note = (text: string): void => { if (problems.length < 5) problems.push(text); };
  for (let tick = 0; tick < ticks; tick += 1) {
    for (let i = 0; i < movers.length; i += 1) {
      const m = movers[i] as Mover;
      m.angle += nextRange(rng, -0.25, 0.25);
      const from = { x: m.x, z: m.z };
      const delta = { x: Math.cos(m.angle) * m.speed, z: Math.sin(m.angle) * m.speed };
      moveCircle(from, delta, m.radius, m.yRange, m.mask, colliders, out);
      if (!Number.isFinite(out.x) || !Number.isFinite(out.z)) {
        note(`Tick ${tick}, Bewegter ${i}: keine endliche Lage (${out.x}, ${out.z})`);
        m.x = 0; m.z = 0;
        continue;
      }
      m.x = out.x;
      m.z = out.z;
      for (const c of colliders) {
        if (!blocksMover(c, m)) continue;
        const dist = distanceToBox(m.x, m.z, c);
        if (dist < m.radius - 1e-9) {
          note(`Tick ${tick}, Bewegter ${i}: steckt in Kollider ${c.id} (Abstand ${dist.toFixed(6)} < r ${m.radius})`);
        }
      }
      // Die Strecke alt->neu IST der gelaufene Weg nur, wenn kein Treffer gezaehlt wurde. Mit
      // Gleitschritten ist der Weg ein Polygonzug, und eine Sehne, die eine Aussenecke abkuerzt,
      // waere ein Fehlalarm. Genau der Fall ohne Treffer ist aber der, in dem Tunneln auftraete:
      // ein uebersprungener Kasten meldet sich nicht als Treffer.
      if (out.hits === 0 && segmentBlocked(from, { x: m.x, z: m.z }, m.yRange, m.mask, colliders)) {
        note(`Tick ${tick}, Bewegter ${i}: Strecke (${from.x.toFixed(3)}|${from.z.toFixed(3)}) -> (${m.x.toFixed(3)}|${m.z.toFixed(3)}) kreuzt ungebremst einen Kasten`);
      }
      if (bounds > 0 && (Math.abs(m.x) > bounds || Math.abs(m.z) > bounds)) {
        note(`Tick ${tick}, Bewegter ${i}: ausserhalb der Arena bei (${m.x.toFixed(3)}|${m.z.toFixed(3)})`);
      }
      // Nach einer Sperre die Richtung wechseln, sonst druecken alle acht bis zum Ende gegen dieselbe Wand.
      if (out.blockedX || out.blockedZ) m.angle += nextRange(rng, 0.8, 2.4);
    }
  }
  return problems;
}

describe('Kollisions-Fuzz (D14)', () => {
  it('10 000 Ticks x 8 Bewegte gegen 60 gesaete OBBs halten alle Invarianten', () => {
    const rng = seedRng('maeusebau-m3-kollision');
    const colliders: Collider[] = arena(40, 1, 5, 0);
    for (let i = 4; i < 60; i += 1) {
      const rot = nextRange(rng, -Math.PI, Math.PI);
      const kind = nextInt(rng, 3);
      // 0 = volle Saeule, 1 = Regalbein (die Katze geht hindurch), 2 = Baldachin (die Maus geht darunter).
      const y0 = kind === 2 ? 2 : 0;
      const y1 = kind === 0 ? 3 : (kind === 1 ? 2 : 5);
      const blocks = kind === 0 ? ALL_MASKS : (kind === 1 ? MOUSE | SIGHT : CAT | SIGHT | CAMERA);
      colliders.push(obb(i, nextRange(rng, -36, 36), nextRange(rng, -36, 36), nextRange(rng, 0.3, 3), nextRange(rng, 0.3, 3), rot, y0, y1, blocks));
    }
    expect(colliders).toHaveLength(60);
    const movers = placeMovers(rng, colliders, 34);
    expect(run(rng, colliders, movers, TICKS, 40)).toEqual([]);
  });

  it('20 u/Tick gegen 0,05 Halbdicke tunnelt nicht', () => {
    const rng = seedRng('maeusebau-m3-tunnel');
    const colliders: Collider[] = arena(20, 0.05, 5, 0);
    // Sechs duenne Innenwaende – bei 20 u/Tick ueberspringt ein Schritt das ganze Feld mehrfach.
    for (let i = 0; i < 6; i += 1) {
      const rot = nextRange(rng, -Math.PI, Math.PI);
      colliders.push(obb(4 + i, nextRange(rng, -14, 14), nextRange(rng, -14, 14), nextRange(rng, 2, 8), 0.05, rot, 0, 3, ALL_MASKS));
    }
    const movers = placeMovers(rng, colliders, 14);
    for (const m of movers) m.speed = 20;
    // Schranke 19,95 = Innenkante der Aussenwand: wer tunnelt, faellt im SELBEN Tick auf.
    expect(run(rng, colliders, movers, TICKS, 19.95)).toEqual([]);
  });
});
