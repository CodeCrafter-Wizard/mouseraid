/**
 * Vektor-Helfer fuer den Kern.
 *
 * ALLOKATION: jeder Helfer ist REIN und gibt ein NEUES Objekt zurueck. Das ist die lesbare
 * Fassung – und genau deshalb rufen die heissen Pfade (`collision`, `playerMove`) sie NICHT je
 * Kollider auf, sondern rechnen dort mit Skalaren. Gemessen (Faktenblatt): eine `moveCircle`-Abfrage
 * gegen 196 Kollider kostet 5.4 us; je Kollider zwei Zwischenvektoren zu erzeugen waere die einzige
 * Stelle, an der der Kern den Erzeuger (GC) beschaeftigt.
 *
 * `Vec2` ist der GRUNDRISS (x, z) – das y fehlt absichtlich: Hoehen liegen als `YRange` am Kollider
 * bzw. am Bewegten, nie an einer Grundrissposition.
 */
import { sqrt } from './trig';

/** Punkt oder Richtung im Grundriss. */
export interface Vec2 { x: number; z: number }
/** Punkt oder Richtung im Raum. */
export interface Vec3 { x: number; y: number; z: number }

/** Neuer Grundrissvektor. */
export function v2(x: number, z: number): Vec2 {
  return { x, z };
}

/** Neuer Raumvektor. */
export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** Summe zweier Grundrissvektoren. */
export function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

/** Differenz a - b im Grundriss. */
export function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

/** Grundrissvektor mal Skalar. */
export function scale2(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, z: a.z * s };
}

/** Skalarprodukt im Grundriss. */
export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

/** Laenge im Grundriss. `Math.hypot` ist im Kern verboten (nicht bit-gleich vorgeschrieben). */
export function len2(a: Vec2): number {
  return sqrt(a.x * a.x + a.z * a.z);
}

/** Abstand zweier Grundrisspunkte. */
export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return sqrt(dx * dx + dz * dz);
}

/** Richtung der Laenge 1. Bei Laenge 0 das Nullergebnis – niemals NaN. */
export function normalize2(a: Vec2): Vec2 {
  const l = len2(a);
  if (l === 0) return { x: 0, z: 0 };
  return { x: a.x / l, z: a.z / l };
}

/**
 * Dreht (x, z) um die Y-Achse mit VORBERECHNETEM Kosinus/Sinus:
 *   x' = x*c - z*s,  z' = x*s + z*c
 * Mit `c = cos(rot)`, `s = sin(rot)` geht es vom LOKALEN in den WELT-Rahmen; fuer die Gegenrichtung
 * ruft man mit `-s` auf. So kommt in keiner Kollisionsabfrage Trig vor (`Collider.rc` / `.rs`).
 */
export function rotateY2(a: Vec2, c: number, s: number): Vec2 {
  return { x: a.x * c - a.z * s, z: a.x * s + a.z * c };
}

/** Summe zweier Raumvektoren. */
export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Differenz a - b im Raum. */
export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Raumvektor mal Skalar. */
export function scale3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** Skalarprodukt im Raum. */
export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Laenge im Raum. */
export function len3(a: Vec3): number {
  return sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

/** Abstand zweier Raumpunkte. */
export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return sqrt(dx * dx + dy * dy + dz * dz);
}

/** Richtung der Laenge 1 im Raum. Bei Laenge 0 das Nullergebnis – niemals NaN. */
export function normalize3(a: Vec3): Vec3 {
  const l = len3(a);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** Dreht um die Y-Achse; y bleibt unveraendert. Konvention wie `rotateY2`. */
export function rotateY3(a: Vec3, c: number, s: number): Vec3 {
  return { x: a.x * c - a.z * s, y: a.y, z: a.x * s + a.z * c };
}
