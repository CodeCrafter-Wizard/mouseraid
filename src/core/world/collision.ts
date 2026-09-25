import type { Vec2, Vec3 } from '../math/vec';
import type { Collider, MoveResult, RayHit, YRange } from './colliderTypes';

/**
 * Die fünf Abfragen der 2.5D-Welt. Alle rein, alle ohne Broadphase (gemessen: brute force trägt
 * weit über 200 Kollider) und alle ohne Trigonometrie – die Kollider tragen `rc`/`rs` als Daten.
 * Erlaubt sind nur die bit-gleich spezifizierten Rechenarten; `Math.sqrt` ist laut ECMA-262
 * 21.3.2.33 exakt vorgeschrieben (`sqrt` aus math/trig reicht es nur weiter – deshalb hier direkt,
 * so bleibt dieses Modul frei von Wert-Importen).
 */

/** Gemessen: 1 Gleitschritt klemmt an jeder Wand fest (4992/10 000 Ticks), 2 und 3 je 281, 4 bringt nichts. */
export const MAX_SLIDES = 3;
/** Rest-Abstand beim Anlegen an eine Fläche – ohne ihn gilt der Bewegte im nächsten Tick als eingedrungen. */
export const SKIN = 1e-4;
/** Standardtoleranz für checkSupport; übergeben wird sie trotzdem vom Aufrufer. */
export const SUPPORT_TOLERANCE = 0.1;

/** Darunter gilt ein verworfener Bewegungsanteil als Rundungsrest, nicht als Sperre. */
const BLOCK_EPSILON = 1e-9;

/**
 * Ergebnis EINES Kollider-Sweeps. Ein einziges Modul-Objekt statt eines neuen je Kollider:
 * moveCircle macht bis zu MAX_SLIDES × (Zahl der Kollider) Sweeps je Bewegtem und Tick. Es wird
 * bei jedem Treffer vollständig neu beschrieben, bevor es gelesen wird, und nie über einen Aufruf
 * hinaus – die Abfragen bleiben damit rein, nur eben allokationsfrei.
 *
 * NICHT WIEDEREINTRITTSFÄHIG (wie `playerMove`): `moveCircle` und `sweepCircle` teilen sich dieses
 * eine Modul-Objekt. Folge: keine Abfrage dieses Moduls darf eine andere Abfrage *während* ihres
 * eigenen Laufs auslösen – also kein Rückruf-Parameter. M4 baut mit `sweepCircle` Nav-Kanten; die
 * Kanten werden nacheinander geprüft, nie aus einem Rückruf heraus.
 */
interface SweepOut { t: number; nx: number; nz: number; push: number }
const sweepOut: SweepOut = { t: 0, nx: 0, nz: 0, push: 0 };

/**
 * Wirkt der Kollider auf diesen Bewegten? Maskenbit UND Höhenband – und zwar je BEWEGTEM, nicht
 * je Kollider-Paar (Falle 2 des Faktenblatts: Regalbein und Baldachin überlappen sich nicht,
 * treffen aber beide die Katze). Dieselbe Regel wie `overlapsY` in colliderTypes; sie steht hier
 * BEWUSST DOPPELT ausgeschrieben, damit collision.ts außer Typen nichts importiert. Beide Seiten
 * sind getestet – diese hier in `collision.test.ts` (bündige Bänder, also genau der `<`/`<=`-Mutant),
 * `overlapsY` in `generateColliders.test.ts`. Wer hier das Vergleichszeichen ändert, muss dort mit.
 */
function affects(c: Collider, yRange: YRange, mask: number): boolean {
  return (c.blocks & mask) !== 0 && yRange.y0 < c.y1 && c.y0 < yRange.y1;
}

/**
 * Frühester Treffer eines Kreises (Mittelpunkt px/pz, Bewegung dx/dz, Radius r) mit dem
 * Minkowski-Körper des Kolliders = um r abgerundetes Rechteck. Ergebnis in `sweepOut`:
 * t in [0,1], Normale in WELT-Koordinaten, push > 0 = die Startlage steckt schon drin.
 *
 * FALLE 1 (gemessen): ein reiner Slab-Test gegen das scharf um r aufgeblähte Rechteck liefert
 * kein t > 0, wenn der Startpunkt in dessen Eckzone liegt (|lx| < hx+r UND |lz| < hz+r, Abstand
 * trotzdem > r). Der Kollider würde für den ganzen Schritt ignoriert und der Bewegte liefe
 * hindurch. Deshalb werden 2 Flächen- und 4 Eck-Kandidaten EINZELN geprüft.
 */
function sweepCollider(px: number, pz: number, dx: number, dz: number, radius: number, c: Collider): boolean {
  // In den lokalen Rahmen drehen (Weltpunkt -> Kollider-Koordinaten, Drehung um -rot).
  const ox = px - c.cx;
  const oz = pz - c.cz;
  const lx = ox * c.rc + oz * c.rs;
  const lz = -ox * c.rs + oz * c.rc;
  const ldx = dx * c.rc + dz * c.rs;
  const ldz = -dx * c.rs + dz * c.rc;
  const hx = c.hx;
  const hz = c.hz;

  // --- Fall A: der Kreis steckt schon im abgerundeten Rechteck -> t = 0 mit Herausdrück-Normale.
  const qx = lx < -hx ? -hx : (lx > hx ? hx : lx);
  const qz = lz < -hz ? -hz : (lz > hz ? hz : lz);
  const ex = lx - qx;
  const ez = lz - qz;
  const gap2 = ex * ex + ez * ez;
  if (gap2 < radius * radius) {
    let nlx: number;
    let nlz: number;
    let depth: number;
    if (gap2 > 0) {
      const gap = Math.sqrt(gap2);
      nlx = ex / gap;
      nlz = ez / gap;
      depth = radius + SKIN - gap;
    } else {
      // Mittelpunkt IM Rechteck: entlang der Achse mit der geringsten Eindringtiefe heraus.
      const ax = lx < 0 ? -lx : lx;
      const az = lz < 0 ? -lz : lz;
      const overX = hx - ax;
      const overZ = hz - az;
      if (overX <= overZ) {
        nlx = lx < 0 ? -1 : 1;
        nlz = 0;
        depth = overX + radius + SKIN;
      } else {
        nlx = 0;
        nlz = lz < 0 ? -1 : 1;
        depth = overZ + radius + SKIN;
      }
    }
    sweepOut.t = 0;
    sweepOut.nx = nlx * c.rc - nlz * c.rs;
    sweepOut.nz = nlx * c.rs + nlz * c.rc;
    sweepOut.push = depth;
    return true;
  }

  // --- Fall B: Sweep. Zwei Flächen (nur die dem Weg zugewandte Seite kann getroffen werden) ...
  let best = 2;
  let bnx = 0;
  let bnz = 0;
  if (ldx !== 0) {
    const sx = ldx < 0 ? 1 : -1;
    const t = (sx * (hx + radius) - lx) / ldx;
    if (t >= 0 && t <= 1) {
      const zAt = lz + ldz * t;
      if (zAt >= -hz && zAt <= hz) {
        best = t;
        bnx = sx;
        bnz = 0;
      }
    }
  }
  if (ldz !== 0) {
    const sz = ldz < 0 ? 1 : -1;
    const t = (sz * (hz + radius) - lz) / ldz;
    if (t >= 0 && t <= 1 && t < best) {
      const xAt = lx + ldx * t;
      if (xAt >= -hx && xAt <= hx) {
        best = t;
        bnx = 0;
        bnz = sz;
      }
    }
  }
  // ... und vier Eckkreise mit Radius r um die Rechteckecken (ohne sie greift Falle 1).
  const a = ldx * ldx + ldz * ldz;
  if (a > 0 && radius > 0) {
    for (let k = 0; k < 4; k += 1) {
      const kx = (k & 1) === 0 ? -hx : hx;
      const kz = (k & 2) === 0 ? -hz : hz;
      const rx = lx - kx;
      const rz = lz - kz;
      const half = rx * ldx + rz * ldz;                 // halbes b der Mitternachtsformel
      const cc = rx * rx + rz * rz - radius * radius;
      const disc = half * half - a * cc;
      if (disc < 0) continue;
      const t = (-half - Math.sqrt(disc)) / a;
      if (t < 0 || t > 1 || t >= best) continue;
      best = t;
      bnx = (rx + ldx * t) / radius;
      bnz = (rz + ldz * t) / radius;
    }
  }
  if (best > 1) return false;
  sweepOut.t = best;
  sweepOut.nx = bnx * c.rc - bnz * c.rs;
  sweepOut.nz = bnx * c.rs + bnz * c.rc;
  sweepOut.push = 0;
  return true;
}

/** Schicht-Test (Slab) einer Strecke im lokalen Rahmen gegen das SCHARFE Rechteck, t in [0,1]. */
function segmentHitsRect(lx: number, lz: number, ldx: number, ldz: number, hx: number, hz: number): boolean {
  let tmin = 0;
  let tmax = 1;
  if (ldx === 0) {
    if (lx < -hx || lx > hx) return false;
  } else {
    const inv = 1 / ldx;
    let t1 = (-hx - lx) * inv;
    let t2 = (hx - lx) * inv;
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (ldz === 0) {
    if (lz < -hz || lz > hz) return false;
  } else {
    const inv = 1 / ldz;
    let t1 = (-hz - lz) * inv;
    let t2 = (hz - lz) * inv;
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return true;
}

/**
 * Durchgehende Bewegung (TOI + Gleiten), NICHT "bewegen + herausdrücken": letzteres tunnelt
 * gemessen schon beim vorgesehenen Sprint durch Regalbeine und erzeugt Lagen, die kein
 * Bewegungspfad je erreicht hat. Je Gleitschritt wird der früheste Treffer gesucht (Gleichstand
 * -> kleinere id), der Bewegte bis SKIN davor gelegt und die Restbewegung auf die Fläche
 * projiziert. `out` wird beschrieben UND zurückgegeben.
 *
 * Eine Bewegung von genau (0,0) fragt gar nichts ab: ein stehender Bewegter kostet keine Rechnung
 * und wird auch nicht herausgedrückt – das passiert beim nächsten Schritt mit Bewegung.
 */
export function moveCircle(
  pos: Vec2, delta: Vec2, radius: number, yRange: YRange,
  mask: number, colliders: readonly Collider[], out: MoveResult,
): MoveResult {
  let px = pos.x;
  let pz = pos.z;
  let rx = delta.x;
  let rz = delta.z;
  out.blockedX = false;
  out.blockedZ = false;
  out.hits = 0;
  for (let slide = 0; slide < MAX_SLIDES; slide += 1) {
    if (rx === 0 && rz === 0) break;
    let bestT = 2;
    let bestNx = 0;
    let bestNz = 0;
    let bestPush = 0;
    let bestId = -1;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (c === undefined) continue;                  // noUncheckedIndexedAccess
      if (!affects(c, yRange, mask)) continue;
      if (!sweepCollider(px, pz, rx, rz, radius, c)) continue;
      // Strikt kleineres t, bei Gleichstand die kleinere id – nie die Reihenfolge im Array.
      if (sweepOut.t < bestT || (sweepOut.t === bestT && c.id < bestId)) {
        bestT = sweepOut.t;
        bestNx = sweepOut.nx;
        bestNz = sweepOut.nz;
        bestPush = sweepOut.push;
        bestId = c.id;
      }
    }
    if (bestId < 0) {
      px += rx;
      pz += rz;
      rx = 0;
      rz = 0;
      break;
    }
    out.hits += 1;
    if (bestPush > 0) {
      // Startlage steckt im Körper: erst heraus, die Restbewegung bleibt vollständig erhalten.
      px += bestNx * bestPush;
      pz += bestNz * bestPush;
    } else {
      px += rx * bestT + bestNx * SKIN;
      pz += rz * bestT + bestNz * SKIN;
      rx *= 1 - bestT;
      rz *= 1 - bestT;
    }
    // Gleiten: den Anteil der Restbewegung IN die Fläche hinein verwerfen.
    const into = rx * bestNx + rz * bestNz;
    if (into < 0) {
      const cutX = bestNx * into;
      const cutZ = bestNz * into;
      rx -= cutX;
      rz -= cutZ;
      if (cutX > BLOCK_EPSILON || cutX < -BLOCK_EPSILON) out.blockedX = true;
      if (cutZ > BLOCK_EPSILON || cutZ < -BLOCK_EPSILON) out.blockedZ = true;
    }
  }
  // Was nach MAX_SLIDES übrig ist, wird verworfen und gemeldet – sonst liefe der Bewegte im
  // letzten Schritt ungeprüft weiter und käme in einer engen Ecke doch noch hindurch.
  if (rx > BLOCK_EPSILON || rx < -BLOCK_EPSILON) out.blockedX = true;
  if (rz > BLOCK_EPSILON || rz < -BLOCK_EPSILON) out.blockedZ = true;
  out.x = px;
  out.z = pz;
  return out;
}

/** Sicht-/Hörlinie: Slab-Test im lokalen Rahmen + Höhenband + Maske. true = BLOCKIERT. */
export function segmentBlocked(a: Vec2, b: Vec2, yRange: YRange, mask: number, colliders: readonly Collider[]): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (c === undefined) continue;
    if (!affects(c, yRange, mask)) continue;
    const ox = a.x - c.cx;
    const oz = a.z - c.cz;
    const lx = ox * c.rc + oz * c.rs;
    const lz = -ox * c.rs + oz * c.rc;
    const ldx = dx * c.rc + dz * c.rs;
    const ldz = -dx * c.rs + dz * c.rc;
    if (segmentHitsRect(lx, lz, ldx, ldz, c.hx, c.hz)) return true;
  }
  return false;
}

/**
 * Kommt ein Kreis mit `radius` von a nach b durch? true = BLOCKIERT (gleiche Leserichtung wie
 * segmentBlocked). Ein Start, der schon im Kollider steckt, gilt als blockiert. M4 baut damit
 * die Nav-Kanten.
 */
export function sweepCircle(a: Vec2, b: Vec2, radius: number, yRange: YRange, mask: number, colliders: readonly Collider[]): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (c === undefined) continue;
    if (!affects(c, yRange, mask)) continue;
    if (sweepCollider(a.x, a.z, dx, dz, radius, c)) return true;
  }
  return false;
}

/**
 * 3D-Slab-Test, Drehung nur um Y; `dir` muss normiert sein, dann ist `t` eine Entfernung.
 * Nächster Treffer, Gleichstand über die kleinere id. Liegt der Ursprung schon im Kollider,
 * ist t = 0. null = kein Treffer. Kamera-Boom (M5).
 */
export function rayCast3(origin: Vec3, dir: Vec3, maxDist: number, mask: number, colliders: readonly Collider[]): RayHit | null {
  let bestT = 0;
  let bestId = -1;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (c === undefined) continue;
    if ((c.blocks & mask) === 0) continue;
    const ox = origin.x - c.cx;
    const oz = origin.z - c.cz;
    const lx = ox * c.rc + oz * c.rs;
    const lz = -ox * c.rs + oz * c.rc;
    const ldx = dir.x * c.rc + dir.z * c.rs;
    const ldz = -dir.x * c.rs + dir.z * c.rc;
    let tmin = 0;
    let tmax = maxDist;
    if (ldx === 0) {
      if (lx < -c.hx || lx > c.hx) continue;
    } else {
      const inv = 1 / ldx;
      let t1 = (-c.hx - lx) * inv;
      let t2 = (c.hx - lx) * inv;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (ldz === 0) {
      if (lz < -c.hz || lz > c.hz) continue;
    } else {
      const inv = 1 / ldz;
      let t1 = (-c.hz - lz) * inv;
      let t2 = (c.hz - lz) * inv;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Das Höhenband ist NICHT symmetrisch: y0 und y1 stehen einzeln im Kollider.
    if (dir.y === 0) {
      if (origin.y < c.y0 || origin.y > c.y1) continue;
    } else {
      const inv = 1 / dir.y;
      let t1 = (c.y0 - origin.y) * inv;
      let t2 = (c.y1 - origin.y) * inv;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (bestId < 0 || tmin < bestT || (tmin === bestT && c.id < bestId)) {
      bestT = tmin;
      bestId = c.id;
    }
  }
  if (bestId < 0) return null;
  return { t: bestT, id: bestId };
}

/**
 * true, wenn eine Deckfläche (y1) mit |y1 - y| <= tolerance den Grundriss-Punkt enthält –
 * "steht auf einer Plattform". Ohne Maske: eine Fläche trägt, egal wen sie sonst blockt.
 */
export function checkSupport(pos: Vec2, y: number, tolerance: number, colliders: readonly Collider[]): boolean {
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (c === undefined) continue;
    const dy = c.y1 - y;
    if (dy > tolerance || dy < -tolerance) continue;
    const ox = pos.x - c.cx;
    const oz = pos.z - c.cz;
    const lx = ox * c.rc + oz * c.rs;
    const lz = -ox * c.rs + oz * c.rc;
    if (lx >= -c.hx && lx <= c.hx && lz >= -c.hz && lz <= c.hz) return true;
  }
  return false;
}
