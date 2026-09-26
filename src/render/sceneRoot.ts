/**
 * Der Zusammenbau der Graybox: zwei Lichter, die Materialtafel, ein Kasten je Kollider, ein Boden je
 * Raum, fünf Figuren. Genau EINE Stelle, die die Aufbaureihenfolge kennt.
 */
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene.pure';
import type { Balance } from '../core/data/balanceTypes';
import type { LevelRuntime } from '../core/world/levelRuntime';
import { buildActors } from './actors';
import type { ActorMeshes } from './actors';
import { buildLevelMeshes } from './levelMeshes';
import type { LevelMeshes } from './levelMeshes';
import { createMaterials } from './materials';
import type { MaterialTable } from './materials';

export const HEMI_INTENSITY = 0.55;
/**
 * Anteil, den das Hemisphärenlicht der ABGEWANDTEN Seite lässt. Babylons Vorgabe für `groundColor`
 * ist SCHWARZ; im Probe-Screenshot ist eine vom Licht abgewandte Wandfläche damit kaum heller als
 * der Hintergrund und verliert ihre Eigenfarbe – eine dunkle Wand und eine dunkle Theke sind nicht
 * mehr zu unterscheiden. Mit 0,35 bleibt die Fläche deutlich dunkler als die Oberseite (die Form ist
 * weiter lesbar), behält aber ihre Farbe.
 */
export const HEMI_GROUND_SHARE = 0.35;
export const DIR_INTENSITY = 0.75;
/**
 * Von oben-vorne-links, damit drei Kastenseiten unterschiedlich hell sind – das ist die ganze
 * Lesbarkeit der Form. Keine Schatten (das ist M8).
 */
export const DIR_DIRECTION: readonly [number, number, number] = [-0.4, -1, 0.25];

export interface SceneRoot {
  readonly materials: MaterialTable;
  readonly meshes: LevelMeshes;
  readonly actors: ActorMeshes;
  meshCount(): number;
  dispose(): void;
}

/**
 * Reihenfolge: Lichter -> Materialtafel -> Kästen und Böden -> Figuren. `dispose()` gibt in der
 * UMGEKEHRTEN Reihenfolge frei – ein Material, das noch an einem Mesh hängt, wird sonst zweimal
 * angefasst.
 *
 * Die Lichter bleiben im Abschluss und stehen nicht in `SceneRoot`: niemand liest sie, und ein Feld,
 * das niemand liest, ist eine Naht, die niemand pflegt.
 */
export function buildSceneRoot(scene: Scene, runtime: LevelRuntime, balance: Balance): SceneRoot {
  const hemi = new HemisphericLight('licht-himmel', new Vector3(0, 1, 0), scene);
  hemi.intensity = HEMI_INTENSITY;
  hemi.groundColor = new Color3(HEMI_GROUND_SHARE, HEMI_GROUND_SHARE, HEMI_GROUND_SHARE);
  const sun = new DirectionalLight(
    'licht-sonne', new Vector3(DIR_DIRECTION[0], DIR_DIRECTION[1], DIR_DIRECTION[2]), scene,
  );
  sun.intensity = DIR_INTENSITY;

  const materials = createMaterials(scene);
  const meshes = buildLevelMeshes(scene, runtime, materials);
  const actors = buildActors(scene, balance, materials);

  return {
    materials,
    meshes,
    actors,
    meshCount: () => meshes.boxes.length + meshes.floors.length + actors.players.length + 1,
    dispose(): void {
      actors.dispose();
      meshes.dispose();
      materials.dispose();
      sun.dispose();
      hemi.dispose();
    },
  };
}
