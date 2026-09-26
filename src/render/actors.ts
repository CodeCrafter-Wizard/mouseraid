/**
 * Die Figuren der Graybox: vier Maus-Kapseln und eine Katzen-Kapsel, zwischen zwei Ticks
 * interpoliert.
 *
 * `applyActors` liest AUSSCHLIESSLICH den `RenderView` – nie den `WorldState` und nie `slow`. Das
 * ist der ganze Grund, warum `prev`/`curr` Schnappschüsse sind und keine Zustände (D5).
 */
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene.pure';
import type { Balance } from '../core/data/balanceTypes';
import { MAX_PLAYERS } from '../core/sim/state';
import { SNAPSHOT_CAT, SNAPSHOT_STRIDE } from '../core/sim/views';
import type { FastSnapshot, RenderView } from '../core/sim/views';
import type { MaterialTable } from './materials';

/** EINHEITEN, also 0,1 cm (Q5). */
export const CAPSULE_SLACK = 0.01;

/**
 * `CreateCapsule` verlangt `height >= 2 * radius`, sonst entsteht eine KUGEL. Beide Maße stehen in
 * EINHEITEN, so hält sie die Balance.
 *
 * GEMESSEN an `src/data/balance.json`: Maus radius 0,4 / height 0,6 -> geklemmt auf 0,81 u;
 * Katze 1,2 / 3,0 -> 3,0 u (ungeklemmt). Das ist eine echte DATENSPANNUNG und kein Rundungsfehler:
 * eine Maus mit 4 cm Radius und 6 cm Höhe ist geometrisch keine Kapsel. Die Balance bleibt
 * unangetastet – sie trägt das Kollisions-Höhenband; die echte Gestalt entscheidet M10s
 * Proportionsdurchgang.
 */
export function capsuleHeight(radius: number, height: number): number {
  return Math.max(height, 2 * radius + CAPSULE_SLACK);
}

/**
 * `lerp(a, b, 1)` trifft `b` NICHT bitgenau: `a + (b - a) * 1` ist in IEEE-754 im Allgemeinen ein
 * anderer Float als `b` (gemessen: Δ 3,55e-15 bei `a = -60, b = -12.3456789`). Die Formel ist Vertrag
 * (Planzeilen 959–961 sagen „genau dieser Zustand" und meinen numerisch gleich, nicht bitidentisch) –
 * wer Mesh-/Posenwerte gegen einen Zustandswert prüft, vergleicht deshalb IMMER mit Toleranz
 * (`toBeCloseTo`), nie mit `toBe`/`toEqual` (Task-3-Review, Minor 4).
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const TWO_PI = Math.PI * 2;

/**
 * Winkel über den KÜRZESTEN Weg um den Kreis. Ohne das springt eine Figur bei PI -> -PI einmal ganz
 * herum.
 *
 * Dieselbe Regel steht als `angleDelta` in `cameraBoom.ts` (T4) – bewusst zweimal: die Figuren
 * dürfen nicht von der Kamera abhängen, und ein drittes Modul für vier Zeilen wäre eine Datei zu
 * viel. Beide Seiten sind einzeln geprüft, jede über +-PI.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return a + delta * t;
}

export interface ActorMeshes { readonly players: readonly Mesh[]; readonly cat: Mesh; dispose(): void }

/** Mittelpunkt auf halber Höhe, damit die Kapsel auf dem Boden steht und nicht in ihm. */
function buildCapsule(scene: Scene, name: string, radius: number, height: number,
  material: StandardMaterial): Mesh {
  const total = capsuleHeight(radius, height);
  const mesh = CreateCapsule(name, { radius, height: total }, scene);
  mesh.position.set(0, total / 2, 0);
  mesh.material = material;
  return mesh;
}

/**
 * Vier Maus-Kapseln und eine Katzen-Kapsel. Das Material 'mouseWeak' wird in M5 noch NICHT
 * umgeschaltet – der Eintrag der Farbtafel steht für M7.
 */
export function buildActors(scene: Scene, balance: Balance, materials: MaterialTable): ActorMeshes {
  const mouse = materials.get('mouse');
  const players: Mesh[] = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
    players.push(buildCapsule(scene, `maus-${slot}`, balance.mouse.radius, balance.mouse.height, mouse));
  }
  const cat = buildCapsule(scene, 'katze', balance.cat.radius, balance.cat.height, materials.get('cat'));

  return {
    players,
    cat,
    dispose(): void {
      cat.dispose();
      for (const mesh of players) mesh.dispose();
      players.length = 0;
    },
  };
}

/** `noUncheckedIndexedAccess` macht jeden Typed-Array-Index optional; eine fehlende Zahl ist 0. */
function valueAt(snapshot: FastSnapshot, index: number): number {
  return snapshot.values[index] ?? 0;
}

/**
 * Position aus `lerp(prev, curr, alpha)`, Gierwinkel aus `facing` über den kürzesten Weg und mit
 * demselben Vorzeichen wie bei den Kästen (Babylon ist linkshändig). `visible === 0` – also ein
 * stiller oder gefangener Platz – schaltet das Mesh ab; die Katze ist immer sichtbar.
 *
 * Die y-Lage bleibt die vom Bau: das Spiel ist 2,5D, die Figuren heben nie ab.
 */
export function applyActors(actors: ActorMeshes, view: RenderView): void {
  for (let slot = 0; slot < actors.players.length; slot += 1) {
    const mesh = actors.players[slot];
    if (mesh === undefined) continue;
    applyOne(mesh, view, slot);
  }
  applyOne(actors.cat, view, SNAPSHOT_CAT);
}

/** `alpha = 1` setzt die Meshposition nur NUMERISCH gleich `curr` – s. `lerp` oben. */
function applyOne(mesh: Mesh, view: RenderView, index: number): void {
  const base = index * SNAPSHOT_STRIDE;
  const { prev, curr, alpha } = view;
  mesh.position.x = lerp(valueAt(prev, base), valueAt(curr, base), alpha);
  mesh.position.z = lerp(valueAt(prev, base + 1), valueAt(curr, base + 1), alpha);
  mesh.rotation.y = -lerpAngle(valueAt(prev, base + 2), valueAt(curr, base + 2), alpha);
  mesh.setEnabled((curr.visible[index] ?? 0) !== 0);
}
