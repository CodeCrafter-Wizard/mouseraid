import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_STRIDE, createSnapshot } from '../../../src/core/sim/views';
import type { RenderView, SlowView } from '../../../src/core/sim/views';
import { NO_ROOM } from '../../../src/core/world/levelTypes';
import type { CameraMode, LevelBounds, LevelDef, LevelRoom } from '../../../src/core/world/levelTypes';
import { CAT, SIGHT } from '../../../src/core/world/colliderTypes';
import type { Collider } from '../../../src/core/world/colliderTypes';
import type { LevelRuntime } from '../../../src/core/world/levelRuntime';
import { BOOM_DISTANCE, BOOM_TARGET_HEIGHT, createBoomPose, dioramaPose } from '../../../src/render/cameraBoom';
import { CAMERA_SLOT, OCCLUDER_VISIBILITY, createCameraRig } from '../../../src/render/cameraRig';
import type { LevelMeshes } from '../../../src/render/levelMeshes';
import { collider, emptyLevel } from '../core/testWorld';

/**
 * Der Rig wird gegen ZWEI Attrappen geprüft: eine Kamera mit genau den beiden Feldern, die er
 * anfasst (`position` und `setTarget`), und eine `LevelMeshes`-Attrappe, die ihre Aufrufe mitschreibt.
 * Eine echte `TargetCamera` bräuchte Engine und Szene – die stehen im E2E-Tor (T6), nicht hier. Die
 * Attrappe wird über `as unknown as TargetCamera` eingehängt; das ist der Preis dafür, dass dieser
 * Test ohne Grafik läuft, und er ist genau eine Zeile lang.
 */
interface CameraSpy { position: Vector3; targets: Vector3[]; camera: TargetCamera }

function cameraSpy(): CameraSpy {
  const position = new Vector3(0, 0, 0);
  const targets: Vector3[] = [];
  const stub = {
    position,
    setTarget(target: Vector3): void { targets.push(target.clone()); },
  };
  return { position, targets, camera: stub as unknown as TargetCamera };
}

interface MeshSpy { resets: number; set: [number, number][]; meshes: LevelMeshes }

function meshSpy(): MeshSpy {
  const spy: MeshSpy = {
    resets: 0,
    set: [],
    meshes: {
      boxes: [], floors: [], groupOf: [],
      setGroupVisibility(group: number, visibility: number): void { spy.set.push([group, visibility]); },
      resetVisibility(): void { spy.resets += 1; },
      dispose(): void { /* nichts zu geben */ },
    },
  };
  return spy;
}

function room(id: string, bounds: LevelBounds, cameraMode: CameraMode): LevelRoom {
  return { id, name: id, bounds, cameraMode };
}

function runtimeOf(rooms: readonly LevelRoom[], colliders: readonly Collider[]): LevelRuntime {
  const level: LevelDef = emptyLevel({ id: 'rig', rooms });
  return { level, colliders, nav: { points: [], adjacency: [], lengths: [] } };
}

/** Eine langsame Sicht von Hand – nur `players[CAMERA_SLOT].room` liest der Rig daraus. */
function slowView(rooms: readonly number[]): SlowView {
  const players = rooms.map((room, slot) => ({
    slot, active: true, weakened: false, caught: false, room, loudness: 0,
  }));
  return {
    tick: 1, phase: 'night', phaseTick: 0, dayCount: 1,
    skipVotes: [false, false, false, false], players, catState: 'sleeping', awareness: [0, 0, 0, 0],
  };
}

/** Eine Sicht, in der Platz 0 bei (x, z) mit `facing` steht – prev und curr gleich, alpha 1. */
function viewAt(x: number, z: number, facing: number, slow: SlowView): RenderView {
  const prev = createSnapshot();
  const curr = createSnapshot();
  const base = CAMERA_SLOT * SNAPSHOT_STRIDE;
  for (const snapshot of [prev, curr]) {
    snapshot.tick = 1;
    snapshot.values[base] = x;
    snapshot.values[base + 1] = z;
    snapshot.values[base + 2] = facing;
    snapshot.visible[CAMERA_SLOT] = 1;
  }
  return { prev, curr, alpha: 1, slow };
}

const BAU: LevelBounds = { x0: -64, z0: -8, x1: -40, z1: 8 };

describe('cameraRig', () => {
  it('faellt bei NO_ROOM auf follow zurueck – so steht Platz 0 zu Tick 0 da', () => {
    const rig = createCameraRig(cameraSpy().camera, runtimeOf([room('bau', BAU, 'diorama')], []), meshSpy().meshes);
    rig.update(viewAt(-60, -4, 0, slowView([NO_ROOM])), 16);
    expect(rig.pose().mode).toBe('follow');
    expect(rig.pose().distance).toBe(BOOM_DISTANCE);
  });

  it('faellt auch ohne Eintrag fuer den Platz auf follow zurueck', () => {
    const rig = createCameraRig(cameraSpy().camera, runtimeOf([room('bau', BAU, 'diorama')], []), meshSpy().meshes);
    rig.update(viewAt(0, 0, 0, slowView([])), 16);
    expect(rig.pose().mode).toBe('follow');
  });

  it('nimmt im Diorama-Raum die reine Pose, setzt alles zurueck und meldet 0 Okkluder', () => {
    const meshes = meshSpy();
    const camera = cameraSpy();
    const rig = createCameraRig(camera.camera, runtimeOf([room('bau', BAU, 'diorama')], []), meshes.meshes);
    rig.update(viewAt(-60, -4, 0, slowView([0])), 16);
    const erwartet = dioramaPose(BAU, createBoomPose());
    expect(rig.pose().mode).toBe('diorama');
    expect(rig.pose().x).toBe(erwartet.x);
    expect(rig.pose().y).toBe(erwartet.y);
    expect(rig.pose().z).toBe(erwartet.z);
    expect(rig.occluderCount()).toBe(0);
    expect(meshes.resets).toBe(1);
    expect(meshes.set).toEqual([]);
    expect(camera.position.z).toBe(erwartet.z);
  });

  it('schaltet im follow-Raum genau die Okkluder-Gruppen halbdurchsichtig – nach einem Reset', () => {
    const meshes = meshSpy();
    // Eine Topfpflanze 4 Einheiten oestlich der Maus: bei facing PI steht die Kamera bei +x, die
    // Pflanze also dazwischen. Sie blockt AUSDRUECKLICH keine Kamera (sonst klemmte der Boom an
    // jedem Busch), aber den Blick – und damit ist sie der Fall, fuer den es die Halbdurchsichtigkeit
    // ueberhaupt gibt. Ein KAMERA-Sperrer waere nie ein Okkluder: der Boom klemmt davor.
    const pflanze = collider(0, 4, 0, { hx: 2.5, hz: 2.5, y1: 6, blocks: CAT | SIGHT });
    const rig = createCameraRig(
      cameraSpy().camera,
      runtimeOf([room('laden', { x0: -20, z0: -20, x1: 20, z1: 20 }, 'follow')], [pflanze]),
      meshes.meshes,
    );
    rig.update(viewAt(0, 0, Math.PI, slowView([0])), 16);
    expect(rig.pose().mode).toBe('follow');
    expect(rig.pose().distance).toBe(BOOM_DISTANCE);
    expect(rig.occluderCount()).toBe(1);
    expect(meshes.resets).toBe(1);
    expect(meshes.set).toEqual([[pflanze.occluderGroup, OCCLUDER_VISIBILITY]]);
  });

  it('setzt eine Gruppe im naechsten Bild wieder auf voll sichtbar zurueck', () => {
    const meshes = meshSpy();
    const pflanze = collider(0, 4, 0, { hx: 2.5, hz: 2.5, y1: 6, blocks: CAT | SIGHT });
    const rig = createCameraRig(
      cameraSpy().camera,
      runtimeOf([room('laden', { x0: -20, z0: -20, x1: 20, z1: 20 }, 'follow')], [pflanze]),
      meshes.meshes,
    );
    rig.update(viewAt(0, 0, Math.PI, slowView([0])), 16);
    expect(meshes.set.length).toBe(1);
    // Jetzt schaut die Maus nach Osten: die Kamera steht bei -x, die Pflanze liegt nicht mehr im Weg.
    rig.snap();
    rig.update(viewAt(0, 0, 0, slowView([0])), 16);
    expect(rig.occluderCount()).toBe(0);
    expect(meshes.resets).toBe(2);
    expect(meshes.set.length).toBe(1);
  });

  it('setzt im ersten Bild ohne Glaettung und danach mit', () => {
    const wand = collider(0, 4, 0, { hx: 0.5, hz: 8, y1: 12 });
    const rig = createCameraRig(
      cameraSpy().camera,
      runtimeOf([room('laden', { x0: -20, z0: -20, x1: 20, z1: 20 }, 'follow')], [wand]),
      meshSpy().meshes,
    );
    const view = viewAt(0, 0, Math.PI, slowView([0]));
    rig.update(view, 16);
    // Die Klemmung sitzt sofort: die zugewandte Flaeche liegt 3,5 Einheiten weit weg.
    const ersteKlemmung = rig.pose().distance;
    expect(ersteKlemmung).toBeLessThan(BOOM_DISTANCE);
    // Ohne Wand zieht der Abstand nur nach – er springt NICHT auf BOOM_DISTANCE.
    const frei = createCameraRig(
      cameraSpy().camera,
      runtimeOf([room('laden', { x0: -20, z0: -20, x1: 20, z1: 20 }, 'follow')], []),
      meshSpy().meshes,
    );
    frei.update(view, 16);
    expect(frei.pose().distance).toBe(BOOM_DISTANCE);
    // `snap()` macht den naechsten Schritt wieder hart.
    rig.snap();
    rig.update(viewAt(0, 0, 0, slowView([0])), 16);
    expect(rig.pose().yaw).toBe(0);
  });

  it('schreibt Lage UND Blickpunkt in die Kamera', () => {
    const camera = cameraSpy();
    const rig = createCameraRig(
      camera.camera,
      runtimeOf([room('laden', { x0: -20, z0: -20, x1: 20, z1: 20 }, 'follow')], []),
      meshSpy().meshes,
    );
    rig.update(viewAt(3, -2, 0, slowView([0])), 16);
    const pose = rig.pose();
    expect(camera.position.x).toBe(pose.x);
    expect(camera.position.y).toBe(pose.y);
    expect(camera.position.z).toBe(pose.z);
    expect(camera.targets.length).toBe(1);
    expect(camera.targets[0]?.x).toBe(3);
    expect(camera.targets[0]?.y).toBe(BOOM_TARGET_HEIGHT);
    expect(camera.targets[0]?.z).toBe(-2);
    expect(pose.targetY).toBe(BOOM_TARGET_HEIGHT);
  });
});
