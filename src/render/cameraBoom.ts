import type { Vec2, Vec3 } from '../core/math/vec';
import { CAMERA, SIGHT } from '../core/world/colliderTypes';
import type { Collider, YRange } from '../core/world/colliderTypes';
import { rayCast3, segmentBlocked } from '../core/world/collision';
import type { LevelBounds } from '../core/world/levelTypes';

/**
 * Der Kamera-Boom als REINE Rechnung: kein Babylon, kein DOM, keine Uhr, keine eigene Allokation.
 * Alles, was in Vitest ohne Grafik prüfbar ist, steht hier; `cameraRig.ts` schreibt das Ergebnis in
 * eine Babylon-Kamera und schaltet die Okkluder halbdurchsichtig.
 *
 * `Math.exp`, `Math.cos/sin` und `Math.SQRT2` sind hier ERLAUBT – `src/render` ist kein Kern. Der
 * Kern wird nur über seine reinen Abfragen benutzt (`rayCast3`, `segmentBlocked`).
 *
 * BLICKRICHTUNG: `yaw` ist die Richtung, in die die Kamera SCHAUT, gelesen als
 * `(cos(yaw), sin(yaw))` im Grundriss – dieselbe Lesart wie `Collider.rc`/`rs` und wie `facing` im
 * Kern (`atan2(dz, dx)`). Die Kamera steht also ENTGEGEN dieser Richtung hinter dem Blickpunkt.
 * `dioramaPose` setzt `yaw = -PI/2` und die Kamera auf `z = cz + leg`: Blick nach Norden, Kamera im
 * Süden – genau diese Gleichung legt das Vorzeichen für den ganzen Boom fest.
 */

/** Gewünschter Abstand des Blickpunkts zur Kamera, LÄNGS des Arms. */
export const BOOM_DISTANCE = 6;
/** Gegenkathete des Arms: BOOM_HEIGHT : BOOM_DISTANCE ist die feste NEIGUNG (D8). */
export const BOOM_HEIGHT = 3;
/**
 * Der Blickpunkt liegt in der MITTE der Maus-Kugel: `capsuleHeight(0,4; 0,6)` klemmt auf 0,81 u,
 * der Mittelpunkt liegt also auf 0,405 u. Mit 0,4 schaut die Kamera auf den Körper und nicht auf
 * seine Silhouettenkante – so trifft die Bildmitte im Tor die Maus (R19).
 */
export const BOOM_TARGET_HEIGHT = 0.4;
/** Sicherheitsabstand vor der getroffenen Fläche; ohne ihn steckt die Kamera in der Wand. */
export const BOOM_MARGIN = 0.25;
/** Näher darf der Boom nie klemmen – sonst sieht man das Innere der eigenen Figur. */
export const BOOM_MIN_DISTANCE = 1.5;
/** Nachziehrate des Gierwinkels je Sekunde. */
export const BOOM_YAW_PER_S = 6;
/** Nachziehrate des Abstands je Sekunde – schneller als die Gier, damit eine Wand sofort greift. */
export const BOOM_POS_PER_S = 14;
/** Diorama-ABSTAND (nicht Höhe) = DIORAMA_HEIGHT_FACTOR * Raumdiagonale + DIORAMA_HEIGHT_BASE. */
export const DIORAMA_HEIGHT_FACTOR = 0.9;
export const DIORAMA_HEIGHT_BASE = 4;
/**
 * TANGENS der Diorama-Neigung: Höhe geteilt durch Rückversatz. `1` wäre die 45-Grad-Pose – und die
 * ist BLIND: die Sichtlinie zur Raummitte steigt vom Boden aus mit genau diesem Tangens, an der
 * Ebene der nahen Wand ist sie also `tan * Abstand(Mitte, Wandebene)` hoch. Beim `bau` sind das
 * 8,5 Einheiten Abstand gegen 12 Einheiten Wandhöhe: unter 45 Grad schaut die Kamera auf die
 * AUSSENSEITE der Südwand. GEMESSEN (T3/T7): ab tan > 1,41 ist die Mitte frei, bei 2,2 sind alle
 * vier Maus-Spawns zu sehen, bei 3 fast der ganze Boden. Gewählt ist 2,2 (66 Grad).
 */
export const DIORAMA_PITCH_TAN = 2.2;

const TAU = Math.PI * 2;

/**
 * Länge des UNGEKLEMMTEN Arms und die beiden Anteile der NORMIERTEN Armrichtung.
 * `rayCast3` verlangt eine normierte Richtung, damit `t` eine Entfernung ist – deshalb wird der Arm
 * einmal hier normiert und nicht je Bild.
 */
const ARM_LENGTH = Math.sqrt(BOOM_DISTANCE * BOOM_DISTANCE + BOOM_HEIGHT * BOOM_HEIGHT);
const ARM_RUN = BOOM_DISTANCE / ARM_LENGTH;
const ARM_RISE = BOOM_HEIGHT / ARM_LENGTH;

/**
 * Maske der Okkluder-Prüfung. `CAMERA` allein wäre zu wenig: eine Topfpflanze blockt bewusst KEINE
 * Kamera (sonst klemmte der Boom an jedem Busch), verdeckt die Maus aber sehr wohl – und genau das
 * ist der Fall, für den es die Halbdurchsichtigkeit gibt.
 */
const OCCLUDER_MASK = CAMERA | SIGHT;

export type BoomMode = 'follow' | 'diorama';

export interface BoomPose {
  mode: BoomMode;
  x: number; y: number; z: number;
  targetX: number; targetY: number; targetZ: number;
  yaw: number; distance: number;
}

/**
 * Eine Pose zum Wiederbeschreiben. `distance` startet auf `BOOM_DISTANCE` statt auf 0, damit eine
 * noch nie gerechnete Pose nicht in der Figur steckt.
 *
 * `yaw = 0` liest sich als Blick nach +x (`cos 0 = 1`, `sin 0 = 0`) – die Kamera steht also bei -x,
 * `z` bleibt 0 (Task-4-Review, Minor 2: die frühere Lage `z = BOOM_DISTANCE * ARM_RUN` gehörte zu
 * `yaw = -PI/2`, wie `dioramaPose` sie schreibt, und widersprach dem eigenen `yaw`-Feld).
 */
export function createBoomPose(): BoomPose {
  return {
    mode: 'follow',
    x: -BOOM_DISTANCE * ARM_RUN, y: BOOM_TARGET_HEIGHT + ARM_RISE * BOOM_DISTANCE, z: 0,
    targetX: 0, targetY: BOOM_TARGET_HEIGHT, targetZ: 0,
    yaw: 0, distance: BOOM_DISTANCE,
  };
}

/**
 * Kürzester Weg von `from` nach `to` um den Kreis, Ergebnis in `(-PI, PI]`. Ohne diese Funktion
 * dreht der Boom bei `PI -> -PI` einmal ganz herum.
 */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta <= -Math.PI) delta += TAU;
  return delta;
}

/**
 * Anteil, um den ein nachziehender Wert in `dtMs` an sein Ziel rückt: `1 - exp(-perSecond*dt/1000)`,
 * geklemmt auf `[0, 1]`. ZEITBASIERT, nicht je Bild – sonst zöge die Kamera bei 144 Hz doppelt so
 * schnell nach wie bei 72 Hz. `dtMs <= 0` (und ein nicht positives `perSecond`) ergibt 0, also
 * „unverändert"; ein sehr großes `dt` ergibt genau 1 und nie mehr.
 */
export function smoothFactor(perSecond: number, dtMs: number): number {
  if (!(dtMs > 0) || !(perSecond > 0)) return 0;
  const factor = 1 - Math.exp(-perSecond * dtMs / 1000);
  if (!(factor > 0)) return 0;
  return factor > 1 ? 1 : factor;
}

/** Kratzflächen des Strahls: EIN Objektpaar je Modul, je Aufruf vollständig neu beschrieben. */
const rayOrigin: Vec3 = { x: 0, y: 0, z: 0 };
const rayDir: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Ein Schritt des Verfolger-Booms. Schreibt `pose` und gibt sie zurück; dieses Modul allokiert dabei
 * nichts (nur `rayCast3` legt bei einem TREFFER sein `RayHit` an – das ist Kern-Code und bleibt in
 * M5 unangetastet).
 *
 * Reihenfolge: Blickpunkt setzen -> Gier nachziehen -> Arm aus der neuen Gier bilden -> Strahl
 * `rayCast3(Blickpunkt, Armrichtung, BOOM_DISTANCE, CAMERA, colliders)` -> Wunschabstand aus dem
 * Treffer -> Abstand nachziehen -> Kameralage aus Blickpunkt + Armrichtung * Abstand.
 *
 * `initial = true` setzt Gier UND Abstand ohne Glättung: erstes Bild, nach `cmd.teleport` und nach
 * `resume()` – dort wäre ein weiches Nachziehen ein Schwenk über die halbe Karte.
 */
export function stepBoom(
  pose: BoomPose, focusX: number, focusZ: number, facing: number, dtMs: number,
  colliders: readonly Collider[], initial: boolean,
): BoomPose {
  pose.mode = 'follow';
  pose.targetX = focusX;
  pose.targetY = BOOM_TARGET_HEIGHT;
  pose.targetZ = focusZ;
  pose.yaw = initial
    ? facing
    : pose.yaw + angleDelta(pose.yaw, facing) * smoothFactor(BOOM_YAW_PER_S, dtMs);

  const lookX = Math.cos(pose.yaw);
  const lookZ = Math.sin(pose.yaw);
  rayOrigin.x = focusX;
  rayOrigin.y = BOOM_TARGET_HEIGHT;
  rayOrigin.z = focusZ;
  rayDir.x = -lookX * ARM_RUN;
  rayDir.y = ARM_RISE;
  rayDir.z = -lookZ * ARM_RUN;

  const hit = rayCast3(rayOrigin, rayDir, BOOM_DISTANCE, CAMERA, colliders);
  let wanted = BOOM_DISTANCE;
  if (hit !== null) {
    const clamped = hit.t - BOOM_MARGIN;
    wanted = clamped > BOOM_MIN_DISTANCE ? clamped : BOOM_MIN_DISTANCE;
  }
  pose.distance = initial
    ? wanted
    : pose.distance + (wanted - pose.distance) * smoothFactor(BOOM_POS_PER_S, dtMs);

  pose.x = focusX + rayDir.x * pose.distance;
  pose.y = BOOM_TARGET_HEIGHT + rayDir.y * pose.distance;
  pose.z = focusZ + rayDir.z * pose.distance;
  return pose;
}

/**
 * Feste, erhöhte Pose auf die Raummitte – kein Boom, keine Glättung, keine Okkluder. Blickpunkt ist
 * die Mitte auf `y = 0`, die Kamera steht im Süden und schaut nach Norden; die Neigung trägt
 * `DIORAMA_PITCH_TAN`: `back = distance / sqrt(1 + t²)`, `height = back * t`. Mit `t = 1` ergibt das
 * genau die alte 45-Grad-Form (`back = height = distance / SQRT2`) – die aber war BLIND, siehe die
 * Erklärung an der Konstante.
 *
 * `distance` ist bei jeder Neigung wirklich der Abstand zum Blickpunkt:
 * `sqrt(back² + height²) = back * sqrt(1 + t²) = distance`.
 *
 * Der Abstand wächst mit der Raumdiagonale, nicht mit einer Kante: ein langer, schmaler Raum braucht
 * denselben Abstand wie ein quadratischer mit gleicher Diagonale. Für einen Raum von 24 x 16
 * Einheiten ergibt das `diag = sqrt(832)` und `distance = 0,9 * diag + 4`.
 */
export function dioramaPose(bounds: LevelBounds, out: BoomPose): BoomPose {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cz = (bounds.z0 + bounds.z1) / 2;
  const spanX = bounds.x1 - bounds.x0;
  const spanZ = bounds.z1 - bounds.z0;
  const diag = Math.sqrt(spanX * spanX + spanZ * spanZ);
  const distance = DIORAMA_HEIGHT_FACTOR * diag + DIORAMA_HEIGHT_BASE;
  const back = distance / Math.sqrt(1 + DIORAMA_PITCH_TAN * DIORAMA_PITCH_TAN);
  out.mode = 'diorama';
  out.targetX = cx;
  out.targetY = 0;
  out.targetZ = cz;
  out.x = cx;
  out.y = back * DIORAMA_PITCH_TAN;
  out.z = cz + back;
  out.yaw = -Math.PI / 2;
  out.distance = distance;
  return out;
}

/**
 * Höhenband der Okkluder-Prüfung: vom Boden bis zur Armhöhe. Höher liegende Bänder können die Sicht
 * auf eine Maus am Boden nicht verdecken.
 */
export const OCCLUDER_YRANGE: Readonly<YRange> = { y0: 0, y1: BOOM_HEIGHT };

/**
 * Requisiten, deren Oberkante nicht über den Blickpunkt reicht, werden NIE durchsichtig: sie
 * verdecken die Maus nicht, und ein flackernder Sockel wäre nur Unruhe im Bild.
 */
export const OCCLUDER_MASK_LOW_Y1 = BOOM_TARGET_HEIGHT;

/** Kratzflächen der Okkluder-Prüfung – ein frisches Array je Kollider wäre eine Allokation je Bild. */
const segA: Vec2 = { x: 0, z: 0 };
const segB: Vec2 = { x: 0, z: 0 };
const oneCollider: Collider[] = [];

/**
 * Trägt `group` AUFSTEIGEND und HÖCHSTENS EINMAL in `out` ein, ohne `splice` (das legt ein Array an).
 * Die Liste ist immer schon sortiert; steht an der ersten größeren Stelle ein Wert, kann `group`
 * dahinter nicht mehr vorkommen – deshalb darf die Suche dort abbrechen.
 */
function insertGroup(out: number[], group: number): void {
  let at = out.length;
  for (let i = 0; i < out.length; i += 1) {
    const value = out[i];
    if (value === undefined) continue;
    if (value === group) return;
    if (value > group) { at = i; break; }
  }
  for (let i = out.length; i > at; i -= 1) out[i] = out[i - 1] ?? 0;
  out[at] = group;
}

/**
 * Die `occluderGroup`-Werte auf der Strecke Blickpunkt -> Kamera, aufsteigend und ohne Dopplung.
 * Schreibt `out` (die Länge wird gesetzt) und gibt es zurück.
 *
 * Geprüft wird je Kollider EINZELN, weil `segmentBlocked` nur „irgendetwas blockt" meldet und nicht
 * WER. Übersprungen werden `occluderGroup === 0` (Kollider ohne Quellobjekt) und niedrige Requisiten.
 */
export function occluderGroups(pose: BoomPose, colliders: readonly Collider[], out: number[]): number[] {
  out.length = 0;
  segA.x = pose.targetX;
  segA.z = pose.targetZ;
  segB.x = pose.x;
  segB.z = pose.z;
  for (let i = 0; i < colliders.length; i += 1) {
    const collider = colliders[i];
    if (collider === undefined) continue;
    if (collider.occluderGroup === 0) continue;
    if (collider.y1 <= OCCLUDER_MASK_LOW_Y1) continue;
    oneCollider[0] = collider;
    if (!segmentBlocked(segA, segB, OCCLUDER_YRANGE, OCCLUDER_MASK, oneCollider)) continue;
    insertGroup(out, collider.occluderGroup);
  }
  return out;
}
