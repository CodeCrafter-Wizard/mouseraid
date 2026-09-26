import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_STRIDE, createSnapshot } from '../../../src/core/sim/views';
import type { RenderView, SlowView } from '../../../src/core/sim/views';
import { NO_ROOM } from '../../../src/core/world/levelTypes';
import type { CameraMode, LevelBounds, LevelDef, LevelRoom } from '../../../src/core/world/levelTypes';
import { CAT, SIGHT } from '../../../src/core/world/colliderTypes';
import type { Collider } from '../../../src/core/world/colliderTypes';
import { loadLevel } from '../../../src/core/world/levelLoad';
import { buildLevelRuntime } from '../../../src/core/world/levelRuntime';
import type { LevelRuntime } from '../../../src/core/world/levelRuntime';
import {
  BOOM_DISTANCE, BOOM_TARGET_HEIGHT, BOOM_YAW_PER_S, createBoomPose, dioramaPose, smoothFactor, stepBoom,
} from '../../../src/render/cameraBoom';
import { CAMERA_SLOT, OCCLUDER_VISIBILITY, createCameraRig } from '../../../src/render/cameraRig';
import type { LevelMeshes } from '../../../src/render/levelMeshes';
import { collider, emptyLevel, testBalance } from '../core/testWorld';
import feinkostJson from '../../../src/data/levels/feinkost.json';

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

/**
 * `calls` haelt BEIDE Aufrufarten in EINER Liste, in der Reihenfolge, in der der Rig sie ausloest.
 * `resets`/`set` bleiben als Bequemlichkeit fuer die aelteren Faelle bestehen (Task-4-Review, Major
 * 2): mit ZWEI getrennten Listen sieht kein Test, OB `resetVisibility()` vor oder nach den
 * `setGroupVisibility`-Aufrufen eines Bildes lief – nur die gemeinsame Liste zeigt die Reihenfolge.
 */
type MeshCall = ['reset'] | ['set', number, number];
interface MeshSpy { calls: MeshCall[]; resets: number; set: [number, number][]; meshes: LevelMeshes }

function meshSpy(): MeshSpy {
  const spy: MeshSpy = {
    calls: [],
    resets: 0,
    set: [],
    meshes: {
      boxes: [], floors: [], groupOf: [],
      setGroupVisibility(group: number, visibility: number): void {
        spy.set.push([group, visibility]);
        spy.calls.push(['set', group, visibility]);
      },
      resetVisibility(): void {
        spy.resets += 1;
        spy.calls.push(['reset']);
      },
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
    // Task-4-Review, Major 2: ERST der Reset, DANN das Setzen dieses Bildes – sonst bliebe ein
    // Kasten aus dem Vorbild durchsichtig. Die getrennten Zaehler oben koennen das nicht sehen (ein
    // Reset NACH der Schleife liefe mit ihnen unbemerkt durch); nur die gemeinsame Aufrufliste zeigt
    // die Reihenfolge.
    expect(meshes.calls).toEqual([['reset'], ['set', pflanze.occluderGroup, OCCLUDER_VISIBILITY]]);
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

  it('gibt `initial` nach dem ersten Bild ab – der zweite Schritt zieht nach, er springt nicht', () => {
    // Task-4-Review, Minor 1: der bisherige Fall ruft zwischen zwei `update`-Aufrufen IMMER `snap()`
    // auf und sieht deshalb nie den nachziehenden Zweig. Mutant "initial bleibt immer true" (der Rig
    // schnappt jedes Bild) muss HIER fallen.
    const rig = createCameraRig(
      cameraSpy().camera,
      runtimeOf([room('laden', { x0: -20, z0: -20, x1: 20, z1: 20 }, 'follow')], []),
      meshSpy().meshes,
    );
    rig.update(viewAt(0, 0, 0, slowView([0])), 16);
    expect(rig.pose().yaw).toBe(0);
    // KEIN `snap()` dazwischen: das zweite Bild muss nachziehen statt zu springen.
    rig.update(viewAt(0, 0, 1, slowView([0])), 16);
    const factor = smoothFactor(BOOM_YAW_PER_S, 16);
    expect(rig.pose().yaw).toBeCloseTo(factor, 12);
    expect(rig.pose().yaw).toBeGreaterThan(0);
    expect(rig.pose().yaw).toBeLessThan(1);
  });
});

describe('cameraRig: Moduswechsel diorama -> follow', () => {
  /**
   * Task-4-Review, Major 1: `pose.mode` traegt beim Verlassen des Baus noch 'diorama', und `initial`
   * ist laengst `false` – der `else`-Zweig zieht die Diorama-Distanz (~30 u) deshalb ueber knapp eine
   * halbe Sekunde auf ihr Ziel nach, statt sofort zu schnappen. Gepruft wird das am ECHTEN
   * `feinkost`-Level (keine erfundenen Raumgrenzen): Platz 0 steht auf dem Maus-Spawn IM Bau, das
   * naechste Bild loest den Raum auf den Laden auf, OHNE dass irgendwer `snap()` ruft – genau der
   * Weg, auf dem `slow.players[…].room` den Modus zur Laufzeit umschaltet.
   */
  it('schnappt beim Verlassen des Baus – der erste Verfolger-Rahmen fliegt nicht durch die Suedwand', () => {
    const balance = testBalance();
    const level = loadLevel(feinkostJson);
    const runtime = buildLevelRuntime(level, balance);
    const bau = level.rooms.findIndex((r) => r.cameraMode === 'diorama');
    const laden = level.rooms.findIndex((r) => r.cameraMode === 'follow');
    expect(bau).toBeGreaterThanOrEqual(0);
    expect(laden).toBeGreaterThanOrEqual(0);
    const spawn = level.spawns.mice[0];
    expect(spawn).toBeDefined();
    if (spawn === undefined) return;

    const rig = createCameraRig(cameraSpy().camera, runtime, meshSpy().meshes);
    // Bild 1: Platz 0 steht auf dem Spawn im Bau – der Rig nimmt die Diorama-Pose (distance ~30 u).
    rig.update(viewAt(spawn.x, spawn.z, 0, slowView([bau])), 16);
    expect(rig.pose().mode).toBe('diorama');
    expect(rig.pose().distance).toBeGreaterThan(20);

    // Bild 2, OHNE snap(): der Raum loest sich auf den Laden auf. Die liegen gebliebene
    // Diorama-Distanz darf NICHT nachziehen – der erste Verfolger-Rahmen muss sofort geklemmt sein.
    rig.update(viewAt(spawn.x, spawn.z, 0, slowView([laden])), 16);
    expect(rig.pose().mode).toBe('follow');
    expect(rig.pose().distance).toBeLessThanOrEqual(BOOM_DISTANCE);

    // Sollwert: GENAU das Ergebnis eines frischen, ungeglaetteten Schritts (initial = true) an
    // derselben Stelle – keine abgeschriebene Zahl, sondern dieselbe reine Funktion, die der Rig
    // selbst aufruft. Ohne den Fix liegt die Kamera weit daneben (vom Review gemessen: y ~ 11,65 /
    // z ~ 18,26 – ausserhalb jeder Raumgeometrie, durch die Suedwand des Baus).
    const erwartet = stepBoom(createBoomPose(), spawn.x, spawn.z, 0, 16, runtime.colliders, true);
    expect(rig.pose().x).toBeCloseTo(erwartet.x, 9);
    expect(rig.pose().y).toBeCloseTo(erwartet.y, 9);
    expect(rig.pose().z).toBeCloseTo(erwartet.z, 9);
    // Der Arm reicht hoechstens BOOM_DISTANCE Einheiten vom Blickpunkt weg – der 22 u weite Ausflug
    // aus dem Review ist damit unmoeglich.
    expect(Math.abs(rig.pose().z - spawn.z)).toBeLessThanOrEqual(BOOM_DISTANCE);
    expect(rig.pose().y).toBeLessThan(BOOM_TARGET_HEIGHT + BOOM_DISTANCE);
  });
});
