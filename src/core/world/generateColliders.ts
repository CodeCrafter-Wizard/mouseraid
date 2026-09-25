import { atan2, cos, sin } from '../math/trig';
import { CAMERA, CAT, MOUSE, SIGHT } from './colliderTypes';
import type { Collider } from './colliderTypes';
import { CM_PER_UNIT } from './levelTypes';
import type { LevelDef, LevelShelf } from './levelTypes';

/** Eine Wand hält alles auf – auch Blick und Kamera. */
const WALL_BLOCKS = MOUSE | CAT | SIGHT | CAMERA;
/**
 * Regalbeine halten Maus und Blick auf, die Katze AUSDRÜCKLICH NICHT (D5): sonst lägen zwei
 * wirksame Grundflächen übereinander und drückten die Katze in widersprüchliche Richtungen
 * (gemessen 483 eingedrungene Ticks je 10 000, nach der Trennung 0). Gestoppt wird die Katze
 * vom Baldachin – der deckt dieselbe Grundfläche ab, nur im Höhenband darüber.
 */
const LEG_BLOCKS = MOUSE | SIGHT;
const CANOPY_BLOCKS = CAT | SIGHT | CAMERA;

/**
 * Ein Regalbein an der Ecke (sx, sz) der Grundfläche, um sein eigenes Halbmaß eingerückt,
 * damit es bündig mit der Grundfläche abschließt. Lokale Ecke -> Welt über die Drehung
 * (rc, rs) des Regals: welt = mitte + R(rot) * lokal.
 */
function legCollider(
  id: number, group: number, shelf: LevelShelf,
  legHalf: number, gap: number, rc: number, rs: number, sx: number, sz: number,
): Collider {
  const lx = sx * (shelf.hx - legHalf);
  const lz = sz * (shelf.hz - legHalf);
  return {
    id,
    cx: shelf.cx + lx * rc - lz * rs,
    cz: shelf.cz + lx * rs + lz * rc,
    hx: legHalf,
    hz: legHalf,
    y0: 0,
    y1: gap,
    rot: shelf.rot,
    rc,
    rs,
    blocks: LEG_BLOCKS,
    occluderGroup: group,
  };
}

/**
 * Baut aus den Level-Grundformen die Kollider – deterministisch in Definitionsreihenfolge
 * (erst Wände, dann Regale, dann Kisten), `id` fortlaufend ab 0, `occluderGroup` fortlaufend
 * ab 1 je QUELLOBJEKT (die fünf Kollider eines Regals teilen ihre Gruppe; 0 bleibt für
 * Kollider reserviert, die aus keinem Levelobjekt stammen).
 *
 * KEIN Balance-Argument: die Spalthöhe steht als `gapCm` am Regal, die Körperhöhen der
 * Bewegten kommen erst bei der Abfrage aus der Balance (`mouse.yRange` / `cat.yRange`).
 *
 * ERWARTET ein von `loadLevel` geprüftes `LevelDef`: jede Wand hat eine Länge > 0, jedes
 * Regal/jede Kiste hat `hx > 0` und `hz > 0` – `loadLevel` bürgt dafür (`walls[i]`: „Wand ohne
 * Länge", `shelves[i].hx`/`hz`, `boxes[i].hx`/`hz`: „muss größer als 0 sein"). Diese Funktion
 * prüft das NICHT erneut: eine Wand der Länge 0 ergäbe `hx = 0` und `rc = rs = NaN` (0/0),
 * still und ohne Fehler. Von Hand gebaute Testgeometrie muss dieselbe Vorbedingung einhalten.
 */
export function generateColliders(level: LevelDef): Collider[] {
  const out: Collider[] = [];
  let group = 0;

  // `id` ist die Position im Ergebnis – dadurch ist sie per Konstruktion fortlaufend ab 0.
  for (const wall of level.walls) {
    group += 1;
    const dx = wall.x1 - wall.x0;
    const dz = wall.z1 - wall.z0;
    const length = Math.sqrt(dx * dx + dz * dz);
    out.push({
      id: out.length,
      cx: (wall.x0 + wall.x1) / 2,
      cz: (wall.z0 + wall.z1) / 2,
      hx: length / 2,
      hz: wall.thicknessCm / 2 / CM_PER_UNIT,
      y0: 0,
      y1: wall.heightCm / CM_PER_UNIT,
      rot: atan2(dz, dx),
      // rc/rs kommen hier aus der NORMIERTEN Richtung statt aus cos/sin(rot): das ist exakt
      // (eine achsenparallele Wand bekommt rc = 1, rs = 0 ohne Polynomfehler) und spart zwei
      // Aufrufe. Für alle Aufrufer gilt weiter rc = cos(rot), rs = sin(rot).
      rc: dx / length,
      rs: dz / length,
      blocks: WALL_BLOCKS,
      occluderGroup: group,
    });
  }

  for (const shelf of level.shelves) {
    group += 1;
    const rc = cos(shelf.rot);
    const rs = sin(shelf.rot);
    const legHalf = shelf.legHalfCm / CM_PER_UNIT;
    const gap = shelf.gapCm / CM_PER_UNIT;
    // Vier Beine gegen den Uhrzeigersinn ab der lokalen Ecke (-x, -z) – feste Reihenfolge,
    // damit die IDs eines Regals zwischen zwei Läufen nie tauschen.
    out.push(legCollider(out.length, group, shelf, legHalf, gap, rc, rs, -1, -1));
    out.push(legCollider(out.length, group, shelf, legHalf, gap, rc, rs, 1, -1));
    out.push(legCollider(out.length, group, shelf, legHalf, gap, rc, rs, 1, 1));
    out.push(legCollider(out.length, group, shelf, legHalf, gap, rc, rs, -1, 1));
    // Baldachin über der GANZEN Grundfläche, im Höhenband gap…top.
    out.push({
      id: out.length,
      cx: shelf.cx,
      cz: shelf.cz,
      hx: shelf.hx,
      hz: shelf.hz,
      y0: gap,
      y1: shelf.topCm / CM_PER_UNIT,
      rot: shelf.rot,
      rc,
      rs,
      blocks: CANOPY_BLOCKS,
      occluderGroup: group,
    });
  }

  for (const box of level.boxes) {
    group += 1;
    out.push({
      id: out.length,
      cx: box.cx,
      cz: box.cz,
      hx: box.hx,
      hz: box.hz,
      y0: box.y0Cm / CM_PER_UNIT,
      y1: box.y1Cm / CM_PER_UNIT,
      rot: box.rot,
      rc: cos(box.rot),
      rs: sin(box.rot),
      blocks: box.blocks,
      occluderGroup: group,
    });
  }

  return out;
}
