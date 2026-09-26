/**
 * Ein Kasten je Kollider und ein Boden je Raum – aus dem Level, nicht aus einer zweiten Datenquelle.
 *
 * Die drei reinen Funktionen oben (`colliderToBoxTransform`, `colliderCorners`, `colliderKindOf`)
 * stehen HIER und nicht in einem eigenen Modul: dieses Modul ist ihr einziger Aufrufer, und der
 * reine Test prüft sie ohne Babylon.
 */
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene.pure';
import type { Collider } from '../core/world/colliderTypes';
import type { LevelRuntime } from '../core/world/levelRuntime';
import type { LevelDef } from '../core/world/levelTypes';
import type { GrayboxKind } from './grayboxColors';
import type { MaterialTable } from './materials';

/** Kollider eines Regals: vier Beine, dann der Baldachin. Die Reihenfolge ist Vertrag (Q4). */
const SHELF_COLLIDERS = 5;
const SHELF_CANOPY_OFFSET = 4;

export interface BoxTransform {
  x: number; y: number; z: number;
  /** VOLLE Kantenlängen – `CreateBox` nimmt Durchmesser, nicht Halbmaße. */
  width: number; height: number; depth: number;
  rotationY: number;
}

/** Der Aufrufer legt EINEN an und reicht ihn durch – `colliderToBoxTransform` allokiert nichts. */
export function createBoxTransform(): BoxTransform {
  return { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, rotationY: 0 };
}

/**
 * REIN: schreibt `out` und gibt es zurück.
 *
 * `rotationY = -collider.rot`, weil Babylon LINKSHÄNDIG ist – gemessen, nicht geraten: der Vergleich
 * der Mesh-Weltbounds mit den vier gedrehten Kollider-Ecken (`tests/unit/render/graybox-bounds.test.ts`)
 * ist mit dem Minus exakt und mit `+rot` für jeden gedrehten Körper falsch.
 */
export function colliderToBoxTransform(collider: Collider, out: BoxTransform): BoxTransform {
  out.x = collider.cx;
  out.y = (collider.y0 + collider.y1) / 2;
  out.z = collider.cz;
  out.width = 2 * collider.hx;
  out.height = collider.y1 - collider.y0;
  out.depth = 2 * collider.hz;
  out.rotationY = -collider.rot;
  return out;
}

/**
 * Die vier gedrehten Grundriss-Ecken als x,z-Paare (8 Zahlen), in der Reihenfolge
 * (-hx,-hz), (+hx,-hz), (+hx,+hz), (-hx,+hz).
 *
 * Gerechnet wird über `rc`/`rs` des Kolliders (welt = mitte + R(rot) * lokal) – kein Trig-Aufruf,
 * genau wie in `generateColliders`. Ausgeschrieben statt in einer Schleife über Vorzeichen: vier
 * Zeilenpaare sind lesbar, eine Vorzeichentabelle mit Index-Prüfung ist es nicht.
 */
export function colliderCorners(collider: Collider, out: Float64Array): Float64Array {
  const { cx, cz, hx, hz, rc, rs } = collider;
  out[0] = cx - hx * rc + hz * rs;
  out[1] = cz - hx * rs - hz * rc;
  out[2] = cx + hx * rc + hz * rs;
  out[3] = cz + hx * rs - hz * rc;
  out[4] = cx + hx * rc - hz * rs;
  out[5] = cz + hx * rs + hz * rc;
  out[6] = cx - hx * rc - hz * rs;
  out[7] = cz - hx * rs + hz * rc;
  return out;
}

/**
 * Art eines Kolliders aus seiner `id`, also aus der REIHENFOLGE, in der `generateColliders` baut:
 * WÄNDE -> REGALE (vier Beine, dann Baldachin) -> KISTEN -> PFLANZEN -> MAUSELOCH-STOPFEN.
 *
 * Diese Reihenfolge ist Vertrag (Q4, `docs/decisions.md` M4) und die Stückzahlen stehen im Level –
 * damit ist die Art EXAKT statt aus der Maske geraten, und die Ableitung bleibt rein. Der Preis:
 * wer die Reihenfolge ändert, ändert die Graybox-Farben mit, und `levelMeshes.test.ts` fällt.
 *
 * Eine `id` ausserhalb (auch eine negative) ergibt 'crate' – so bekommt eine neue Kollider-Art
 * NICHT still die Farbe der letzten bekannten, und ein Test hält den Rückfall fest.
 */
export function colliderKindOf(level: LevelDef, id: number): GrayboxKind {
  if (!Number.isInteger(id) || id < 0) return 'crate';
  const shelfBase = level.walls.length;
  if (id < shelfBase) return 'wall';
  const boxBase = shelfBase + level.shelves.length * SHELF_COLLIDERS;
  if (id < boxBase) {
    return (id - shelfBase) % SHELF_COLLIDERS === SHELF_CANOPY_OFFSET ? 'shelfCanopy' : 'shelfLeg';
  }
  const plantBase = boxBase + level.boxes.length;
  if (id < plantBase) return level.boxes[id - boxBase]?.kind ?? 'crate';
  const plugId = plantBase + level.plants.length;
  if (id < plugId) return 'plant';
  if (id === plugId) return 'holePlug';
  return 'crate';
}

/** Knapp unter 0 – auf 0 z-fightet der Boden mit `y0 = 0` jedes Kastens. */
export const FLOOR_Y = -0.02;

export interface LevelMeshes {
  /** Parallel zu `runtime.colliders`, gleiche Reihenfolge. */
  readonly boxes: readonly Mesh[];
  /** Einer je Raum. */
  readonly floors: readonly Mesh[];
  /** `groupOf[i] = colliders[i].occluderGroup`. */
  readonly groupOf: readonly number[];
  setGroupVisibility(group: number, visibility: number): void;
  /** Alle Kästen zurück auf 1. */
  resetVisibility(): void;
  dispose(): void;
}

/**
 * Einzel-Meshes, KEINE Thin Instances: gemessen 19 Zeichenaufrufe bei 46 Meshes (Budget 60) – die
 * Instanzen kommen mit den Requisiten in M9. Und KEIN `scene.freezeActiveMeshes` (Entscheidung 22):
 * der Gewinn ist bei 46 Meshes nicht messbar, die bekannte Einfrier-Falle ist ungeprüft.
 */
export function buildLevelMeshes(scene: Scene, runtime: LevelRuntime, materials: MaterialTable): LevelMeshes {
  const transform = createBoxTransform();
  const boxes: Mesh[] = [];
  const groupOf: number[] = [];
  for (const collider of runtime.colliders) {
    colliderToBoxTransform(collider, transform);
    const mesh = CreateBox(`kollider-${collider.id}`, {
      width: transform.width, height: transform.height, depth: transform.depth,
    }, scene);
    mesh.position.set(transform.x, transform.y, transform.z);
    mesh.rotation.y = transform.rotationY;
    mesh.material = materials.get(colliderKindOf(runtime.level, collider.id));
    boxes.push(mesh);
    groupOf.push(collider.occluderGroup);
  }

  const floors: Mesh[] = [];
  for (const room of runtime.level.rooms) {
    const { x0, z0, x1, z1 } = room.bounds;
    // `CreateGround` nimmt `height` als Ausdehnung in z – der Name täuscht, die Ebene liegt flach.
    const floor = CreateGround(`boden-${room.id}`, { width: x1 - x0, height: z1 - z0 }, scene);
    floor.position.set((x0 + x1) / 2, FLOOR_Y, (z0 + z1) / 2);
    floor.material = materials.get(room.cameraMode === 'diorama' ? 'floorBurrow' : 'floor');
    floors.push(floor);
  }

  return {
    boxes,
    floors,
    groupOf,
    setGroupVisibility(group: number, visibility: number): void {
      for (let i = 0; i < boxes.length; i += 1) {
        if (groupOf[i] !== group) continue;
        const mesh = boxes[i];
        if (mesh !== undefined) mesh.visibility = visibility;
      }
    },
    resetVisibility(): void {
      for (const mesh of boxes) mesh.visibility = 1;
    },
    dispose(): void {
      for (const mesh of floors) mesh.dispose();
      for (const mesh of boxes) mesh.dispose();
      floors.length = 0;
      boxes.length = 0;
      groupOf.length = 0;
    },
  };
}
