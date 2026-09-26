import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SNAPSHOT_STRIDE } from '../core/sim/views';
import type { RenderView } from '../core/sim/views';
import type { LevelRuntime } from '../core/world/levelRuntime';
import { NO_ROOM } from '../core/world/levelTypes';
import { lerp, lerpAngle } from './actors';
import { createBoomPose, dioramaPose, occluderGroups, stepBoom } from './cameraBoom';
import type { BoomPose } from './cameraBoom';
import type { LevelMeshes } from './levelMeshes';

/**
 * Die Babylon-Seite der Kamera: sie wählt den Modus, ruft die reinen Funktionen aus `cameraBoom.ts`
 * und schreibt das Ergebnis in eine von Hand gefahrene `TargetCamera`. Hier steht keine Geometrie –
 * wer eine Zahl ändern will, ändert sie in `cameraBoom.ts`.
 */

/** Ein Okkluder wird durchscheinend, nicht unsichtbar: seine Kante bleibt lesbar. */
export const OCCLUDER_VISIBILITY = 0.35;
/** M5 hat genau einen Spieler an der Tastatur; M9 gibt dem Rig seinen Platz von außen. */
export const CAMERA_SLOT = 0;

export interface CameraRig {
  update(view: RenderView, dtMs: number): void;
  /** Der nächste `update` setzt ohne Glättung – nach `teleport`, `resume` und dem ersten Bild. */
  snap(): void;
  pose(): Readonly<BoomPose>;
  occluderCount(): number;
}

export function createCameraRig(camera: TargetCamera, runtime: LevelRuntime, meshes: LevelMeshes): CameraRig {
  const pose = createBoomPose();
  const groups: number[] = [];
  /**
   * EIN Vektor für alle Bilder. Gemessen an `targetCamera.pure.js:260`: `setTarget` LIEST das
   * Argument (Blickmatrix, Brennweite) und hält keine Referenz darauf – ein neuer `Vector3` je Bild
   * wäre also reine Müllerzeugung.
   */
  const target = new Vector3(0, 0, 0);
  let initial = true;

  return {
    update(view: RenderView, dtMs: number): void {
      // Die Figurenlage kommt AUS DER SICHT, nie aus dem `WorldState`: die Kamera muss zwischen zwei
      // Ticks genau dort stehen, wo auch das Mesh steht.
      const base = CAMERA_SLOT * SNAPSHOT_STRIDE;
      const alpha = view.alpha;
      const x = lerp(view.prev.values[base] ?? 0, view.curr.values[base] ?? 0, alpha);
      const z = lerp(view.prev.values[base + 1] ?? 0, view.curr.values[base + 1] ?? 0, alpha);
      const facing = lerpAngle(view.prev.values[base + 2] ?? 0, view.curr.values[base + 2] ?? 0, alpha);

      // Der Raum steht in der LANGSAMEN Sicht. Zu Tick 0 ist er NO_ROOM (-1) – `playerMove` löst ihn
      // je Tick neu auf –, und `rooms[-1]` ist `undefined`: der Rückfall auf `follow` ist deshalb
      // ausgeschrieben und kein Zufall.
      const slow = view.slow.players[CAMERA_SLOT];
      const roomIndex = slow === undefined ? NO_ROOM : slow.room;
      const room = runtime.level.rooms[roomIndex];
      if (room !== undefined && room.cameraMode === 'diorama') {
        dioramaPose(room.bounds, pose);
        meshes.resetVisibility();
        groups.length = 0;
      } else {
        stepBoom(pose, x, z, facing, dtMs, runtime.colliders, initial);
        occluderGroups(pose, runtime.colliders, groups);
        // ERST alles zurücksetzen, DANN die Gruppen dieses Bildes setzen – sonst bliebe ein Kasten
        // aus dem Vorbild durchsichtig.
        meshes.resetVisibility();
        for (let i = 0; i < groups.length; i += 1) {
          const group = groups[i];
          if (group === undefined) continue;
          meshes.setGroupVisibility(group, OCCLUDER_VISIBILITY);
        }
      }

      camera.position.set(pose.x, pose.y, pose.z);
      target.set(pose.targetX, pose.targetY, pose.targetZ);
      camera.setTarget(target);
      initial = false;
    },
    snap(): void {
      initial = true;
    },
    pose(): Readonly<BoomPose> {
      return pose;
    },
    occluderCount(): number {
      return groups.length;
    },
  };
}
