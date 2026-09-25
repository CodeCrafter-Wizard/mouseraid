import type { Vec2 } from '../math/vec';

/**
 * Weltmaßstab (Spec Zeile 72). REGEL für alle Level- und Balance-Felder:
 * ein Feld mit dem Suffix `Cm` steht in ZENTIMETERN, jedes andere Zahlenfeld in EINHEITEN.
 */
export const CM_PER_UNIT = 10;

export type CameraMode = 'follow' | 'diorama';

/** Achsenparallele Grundriss-Grenzen eines Raums, x1 > x0 und z1 > z0. */
export interface LevelBounds { x0: number; z0: number; x1: number; z1: number }

export interface LevelRoom { id: string; name: string; bounds: LevelBounds; cameraMode: CameraMode }

/** Wand als Strecke MIT Dicke – ohne Dicke ergäbe sich keine OBB. */
export interface LevelWall { x0: number; z0: number; x1: number; z1: number; heightCm: number; thicknessCm: number }

/**
 * Regal: Grundfläche + drei Höhen. `gapCm` ist der Spalt darunter (Maus passt durch,
 * Katze nicht), `topCm` die Oberkante, `legHalfCm` das Halbmaß eines der vier Beine.
 */
export interface LevelShelf {
  cx: number; cz: number; hx: number; hz: number; rot: number;
  gapCm: number; topCm: number; legHalfCm: number;
}

/**
 * Bauart einer Kiste. Sie ändert in M4 KEINE Geometrie und KEINE Maske – sie sagt nur, was das
 * Ding IST, damit M5 Material und Mesh daran hängen kann und die Daten nicht lügen.
 * Das Schaufenster ist deshalb eine Kiste mit `kind: 'window'` und `blocks: 11` (ohne SIGHT) und
 * keine Wand: Wände bekommen in `generateColliders` hart ALL_MASKS.
 */
export type BoxKind = 'crate' | 'counter' | 'vitrine' | 'window';

export interface LevelBox {
  cx: number; cz: number; hx: number; hz: number; rot: number;
  y0Cm: number; y1Cm: number; blocks: number; kind: BoxKind;
}

/**
 * Topfpflanze = Versteck (§8.3). Aus dem Kreis wird in `generateColliders` das UMSCHREIBENDE
 * Quadrat (Halbmaß = Radius): ein Versteck darf lieber etwas zu groß sein – zu klein heißt,
 * die Katze greift hinein.
 */
export interface LevelPlant { id: string; x: number; z: number; radiusCm: number; heightCm: number }

/**
 * Beuteplatz. `table` ist die ID einer Loot-Tabelle; die Tabellen selbst entstehen in M14.
 * M4 prüft nur, dass die ID nicht leer ist – ein Verweis auf eine noch nicht existierende
 * Tabelle ist in M4 KEIN Fehler.
 */
export interface LevelLootSpawn { id: string; x: number; z: number; table: string }

/**
 * Wegpunkte sind HANDGESETZT, nicht generiert: ein reines Raster lässt Punkte in Nischen hängen
 * (Faktenblatt §6, gemessen). Das Raster ist der Startpunkt, der Validator (T3) ist der Beweis.
 */
export interface LevelNavPoint { id: string; x: number; z: number }
export interface LevelNav { points: readonly LevelNavPoint[] }

/**
 * Das Mauseloch: Portal für die Maus und Sperre für die Katze. Die vier Maße sind PFLICHT und
 * stehen AUSGESCHRIEBEN im Level – `generateColliders` sucht nie im Level nach „der Wand, in der
 * das Loch sitzt". Eine solche Suche machte die Kollider-Reihenfolge von Geometrie abhängig, und
 * die Kollider-`id` ist der Tiebreak jeder Abfrage.
 */
export interface LevelMouseHole {
  /** Mittelpunkt der lichten Öffnung, auf der Wandlinie (darf auf einer Raumgrenze liegen). */
  x: number; z: number;
  /**
   * Lichte Weite der Öffnung. Der Validator prüft sie GEOMETRISCH (Sweep der Länge 0 gegen den
   * Stopfen: Maus frei, Katze blockiert) – nicht als Zahlenvergleich: mit der eingefrorenen
   * Testbalance ist 2*catRadius = 2,0 u = 20 cm, ein `<` wäre dort falsch, obwohl die Katze
   * geometrisch nicht durchpasst (R7).
   */
  widthCm: number;
  /** Höhe des Sperrkörpers = Höhe der Wand (sonst rutscht der Kamera-Boom aus M5 darüber). */
  heightCm: number;
  /** Dicke des Sperrkörpers = Dicke dieser Wand. */
  thicknessCm: number;
  /** Gierwinkel der Wandlinie im Bogenmaß – ausgeschrieben, nie gesucht. */
  rot: number;
}

export interface LevelSpawns { mice: readonly Vec2[]; cat: Vec2 }

export interface LevelDef {
  id: string;
  /** Muss CM_PER_UNIT sein – der Loader besteht darauf. */
  scale: number;
  rooms: readonly LevelRoom[];
  walls: readonly LevelWall[];
  shelves: readonly LevelShelf[];
  boxes: readonly LevelBox[];
  /** Im JSON OPTIONAL, im normalisierten Typ PFLICHT – der Loader füllt `[]`. */
  plants: readonly LevelPlant[];
  lootSpawns: readonly LevelLootSpawn[];
  nav: LevelNav;
  spawns: LevelSpawns;
  mouseHole: LevelMouseHole;
}
// `LevelDef` ist die NORMALISIERTE Form: der Loader füllt Vorgaben (fehlendes box.blocks -> ALL_MASKS,
// fehlende Liste -> [], fehlendes box.kind -> 'crate').
// `LevelMouseHole` ist strukturell ein `Vec2` MIT Zusatzfeldern – deshalb bleibt `createInitialState`
// (liest nur x/z, um Plätze ohne Spawn zu parken) und damit `src/core/sim/**` unangetastet.
