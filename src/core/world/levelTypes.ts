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

export interface LevelBox {
  cx: number; cz: number; hx: number; hz: number; rot: number;
  y0Cm: number; y1Cm: number; blocks: number;
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
  spawns: LevelSpawns;
  mouseHole: Vec2;
}
// `LevelDef` ist die NORMALISIERTE Form: der Loader füllt Vorgaben (fehlendes box.blocks -> ALL_MASKS).
// M4 erweitert den Typ (Theke, Vitrine, Pflanzen, Loot, Nav); M3 nimmt nur, was die Kollision braucht.
