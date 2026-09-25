/**
 * 2.5D-Kollidermodell: ein gedrehter Kasten im Grundriss (XZ) mit einem Höhenband.
 * Alle Längen sind Welt-EINHEITEN (1 Einheit = 10 cm, siehe `levelTypes.CM_PER_UNIT`).
 */

/** Maskenbits: wen hält ein Kollider auf? */
export const MOUSE = 1;
export const CAT = 2;
export const SIGHT = 4;
export const CAMERA = 8;
/** Alle vier Bits – zugleich die Vorgabe für eine Kiste ohne eigenes `blocks`. */
export const ALL_MASKS = 15;

/** Halboffenes Höhenband [y0, y1): zwei Bänder, die sich nur berühren, überlappen NICHT. */
export interface YRange { y0: number; y1: number }

export interface Collider {
  /** Fortlaufend in Erzeugungsreihenfolge – der Tiebreak aller Abfragen. */
  id: number;
  /** Mittelpunkt im Grundriss. */
  cx: number; cz: number;
  /** Halbmaße im LOKALEN (mitgedrehten) Rahmen, beide > 0. */
  hx: number; hz: number;
  /** Höhenband, y1 > y0. */
  y0: number; y1: number;
  /** Gierwinkel im Bogenmaß. */
  rot: number;
  /**
   * cos(rot)/sin(rot), beim Erzeugen EINMAL gerechnet. Zur Laufzeit kommt damit in keiner
   * Abfrage mehr Trigonometrie vor – das ist der ganze Zweck der beiden Felder.
   */
  rc: number; rs: number;
  /** Bitmaske aus MOUSE|CAT|SIGHT|CAMERA. */
  blocks: number;
  /** Gruppen-ID der Quelle (alle Kollider eines Regals teilen sie), 0 = keine. */
  occluderGroup: number;
}

/** Ergebnis von `moveCircle` (T3): flach, damit kein verschachteltes `pos` mitgeteilt werden muss. */
export interface MoveResult { x: number; z: number; blockedX: boolean; blockedZ: boolean; hits: number }

/** Treffer eines Strahls (T3): Laufparameter und die getroffene Kollider-ID. */
export interface RayHit { t: number; id: number }

/** Der Aufrufer legt EINEN an und reicht ihn je Tick durch – `moveCircle` allokiert nichts. */
export function createMoveResult(): MoveResult {
  return { x: 0, z: 0, blockedX: false, blockedZ: false, hits: 0 };
}

/**
 * Überlappen sich zwei Höhenbänder? Halboffen, deshalb `<` und nicht `<=`:
 * ein Regalbein 0…2 und ein Baldachin 2…6 liegen bündig übereinander und überlappen sich nicht.
 *
 * BEWUSST DOPPELT: dieselbe Regel steht ausgeschrieben in `affects()` (`src/core/world/collision.ts`),
 * damit `collision.ts` außer Typen nichts importiert. Beide Seiten sind getestet – diese hier in
 * `generateColliders.test.ts`, die Kopie in `collision.test.ts` (bündige Bänder, also genau der
 * `<`/`<=`-Mutant). Wer hier das Vergleichszeichen ändert, muss dort mit ändern.
 */
export function overlapsY(a: YRange, b: YRange): boolean {
  return a.y0 < b.y1 && b.y0 < a.y1;
}
