// Task-3-Review, Minor 2: `Engines/nullEngine` (ohne `.pure`) zieht das Sammel-Modul mit und damit
// neun Registry-Erweiterungen still mit sich – genau das, was der Kopfkommentar unten NICHT
// behauptet. `.pure` hält den Aufbau frei davon, wie in `tests/node/engine-null.test.ts` seit 3a7ae82.
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene.pure';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBalance } from '../../../src/core/data/balanceLoad';
import type { Balance } from '../../../src/core/data/balanceTypes';
import { MAX_PLAYERS, createInitialState } from '../../../src/core/sim/state';
import { createSnapshot, makeSlowView, snapshotFast } from '../../../src/core/sim/views';
import type { RenderView } from '../../../src/core/sim/views';
import { loadLevel } from '../../../src/core/world/levelLoad';
import type { LevelDef } from '../../../src/core/world/levelTypes';
import { buildLevelRuntime } from '../../../src/core/world/levelRuntime';
import { applyActors } from '../../../src/render/actors';
import { GRAYBOX_KINDS } from '../../../src/render/grayboxColors';
import { FLOOR_Y, colliderCorners, colliderKindOf } from '../../../src/render/levelMeshes';
import { buildSceneRoot } from '../../../src/render/sceneRoot';
import type { SceneRoot } from '../../../src/render/sceneRoot';
import balanceFixture from '../../fixtures/core/test-balance.json';
import miniJson from '../../fixtures/core/mini-level.json';
import feinkostJson from '../../../src/data/levels/feinkost.json';

// Dieser Test läuft gegen das ECHTE Babylon, nur ohne Rasterung: `NullEngine` (aus `.pure`, s. o.)
// braucht KEIN DOM und KEINEN Nebenwirkungs-Import aus `src/render/babylonRegistry.ts` – die Module
// dieses Tasks importieren ihre Bindungen aus den registrierenden Pfaden (`Meshes/Builders/*`,
// `Materials/standardMaterial`, `Lights/*`), und das genügt.
//
// Die Ablage spiegelt den QUELLBAUM (`src/render/**` -> `tests/unit/render/**`): der Test liest
// keine Quelldatei und schreibt keine Datei, er braucht also `tests/node` nicht. Gemessen läuft er
// hier mit `tsc -p tsconfig.json` grün. (Zum Vergleich: `tests/node/engine-null.test.ts` LIEST zwei
// Quelldateien und gehört deshalb nach `tests/node`.)
//
// GEMESSENE Grenzen der NullEngine: `scene.render()` wirft ohne Kamera „No camera defined", und
// `scene.getActiveIndices()` bleibt 0 – Zeichenaufrufe und Dreiecke sind NUR im Browser messbar
// (das ist T6s Pixelprobe, nicht dieser Test).

/** Toleranz des Bounds-Vergleichs. Gemessen ist die grösste Abweichung 7,63e-7. */
const TOLERANCE = 1e-5;

interface Stage { engine: NullEngine; scene: Scene; root: SceneRoot; level: LevelDef; balance: Balance }

let stage: Stage | null = null;

/** Die eingefrorene Test-Balance – kein Test hängt an `src/data/balance.json`. */
function fixtureBalance(): Balance {
  return loadBalance(balanceFixture);
}

function build(levelJson: unknown): Stage {
  const level = loadLevel(levelJson);
  const balance = fixtureBalance();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const runtime = buildLevelRuntime(level, balance);
  const root = buildSceneRoot(scene, runtime, balance);
  stage = { engine, scene, root, level, balance };
  return stage;
}

afterEach(() => {
  if (stage === null) return;
  stage.root.dispose();
  stage.scene.dispose();
  stage.engine.dispose();
  stage = null;
});

/** Der `RenderView`, den `applyActors` liest – hier von Hand aus dem Anfangszustand gebaut. */
function viewOf(level: LevelDef, balance: Balance): RenderView {
  const state = createInitialState(level, balance, 1);
  const snapshot = snapshotFast(state, createSnapshot());
  return { prev: snapshot, curr: snapshot, alpha: 1, slow: makeSlowView(state) };
}

describe('graybox-bounds: Mesh-Weltbounds gegen die Kollider-Ecken', () => {
  for (const [name, json] of [['feinkost', feinkostJson], ['mini-level', miniJson]] as const) {
    it(`${name}: jeder Kasten deckt seine gedrehte OBB`, () => {
      const { scene, root, level } = build(json);
      const runtime = buildLevelRuntime(level, fixtureBalance());
      const corners = new Float64Array(8);
      let worst = 0;
      for (let i = 0; i < runtime.colliders.length; i += 1) {
        const collider = runtime.colliders[i];
        const mesh = root.meshes.boxes[i];
        expect(collider).toBeDefined();
        expect(mesh).toBeDefined();
        if (collider === undefined || mesh === undefined) continue;
        colliderCorners(collider, corners);
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;
        for (let k = 0; k < 4; k += 1) {
          const cornerX = corners[2 * k] ?? 0;
          const cornerZ = corners[2 * k + 1] ?? 0;
          if (cornerX < minX) minX = cornerX;
          if (cornerX > maxX) maxX = cornerX;
          if (cornerZ < minZ) minZ = cornerZ;
          if (cornerZ > maxZ) maxZ = cornerZ;
        }
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        const deltas = [
          box.minimumWorld.x - minX, box.maximumWorld.x - maxX,
          box.minimumWorld.z - minZ, box.maximumWorld.z - maxZ,
          box.minimumWorld.y - collider.y0, box.maximumWorld.y - collider.y1,
        ];
        for (const delta of deltas) {
          const size = Math.abs(delta);
          if (size > worst) worst = size;
        }
        // ECKE FÜR ECKE durch die Weltmatrix – nur das sieht das VORZEICHEN der Drehung: die
        // achsenparallele Hülle eines mittig gedrehten Kastens ist unter rot -> -rot invariant
        // (Task-3-Review, MAJOR), die min/max-Prüfung oben kann `rotationY = -collider.rot` also
        // NICHT von `+collider.rot` unterscheiden. Die vier lokalen Ecken stehen in derselben
        // Reihenfolge wie `colliderCorners` (-hx,-hz), (+hx,-hz), (+hx,+hz), (-hx,+hz), also Ecke k
        // gegen Ecke k statt gegen ein Min/Max-Paar.
        const wm = mesh.getWorldMatrix();
        const locals: readonly [number, number][] = [
          [-collider.hx, -collider.hz], [collider.hx, -collider.hz],
          [collider.hx, collider.hz], [-collider.hx, collider.hz],
        ];
        for (let k = 0; k < 4; k += 1) {
          const local = locals[k];
          if (local === undefined) continue;
          const point = Vector3.TransformCoordinates(new Vector3(local[0], 0, local[1]), wm);
          worst = Math.max(worst, Math.abs(point.x - (corners[2 * k] ?? 0)),
            Math.abs(point.z - (corners[2 * k + 1] ?? 0)));
        }
      }
      expect(runtime.colliders.length).toBeGreaterThan(0);
      expect(worst).toBeLessThan(TOLERANCE);
      // Die Szene trägt genau die Meshes dieses Tasks – kein verwaister Kasten, kein zweiter Boden.
      expect(scene.meshes).toHaveLength(root.meshCount());
    });
  }

  it('feinkost: Zahl und Zuordnung der Meshes stimmen strukturell', () => {
    const { root, level } = build(feinkostJson);
    expect(root.meshes.boxes).toHaveLength(buildLevelRuntime(level, fixtureBalance()).colliders.length);
    expect(root.meshes.floors).toHaveLength(level.rooms.length);
    expect(root.actors.players).toHaveLength(MAX_PLAYERS);
    // Abschlussreview MIN-8: `boxes.length + floors.length + MAX_PLAYERS + 1` war Zeichen fuer
    // Zeichen `sceneRoot.ts:68` – abgeschrieben, nicht bewiesen, und die magische `+ 1` (die Katze)
    // wanderte unbenannt in den Test. Gerechnet wird gegen die DOKUMENTIERTEN Summanden von
    // `feinkost` (docs/decisions.md, M5: 39 Kaesten + 2 Boeden + 5 Kapseln = 46). Die 39 sind
    // ohnehin gepinnt (`levelRuntime.test.ts:213`, `validateLevel.test.ts:360`: 9 Waende +
    // 4 Regale a 5 + 4 Kisten + 5 Pflanzen + 1 Stopfen).
    const FEINKOST_BOXES = 39;
    const FEINKOST_FLOORS = 2;
    /** Vier Maus-Kapseln und die Katze. */
    const CAPSULES = MAX_PLAYERS + 1;
    expect(root.meshes.boxes).toHaveLength(FEINKOST_BOXES);
    expect(root.meshes.floors).toHaveLength(FEINKOST_FLOORS);
    expect(root.meshCount()).toBe(FEINKOST_BOXES + FEINKOST_FLOORS + CAPSULES);
    expect(root.meshCount()).toBe(46);
    // `groupOf` liegt parallel zu den Kästen – der Okkluder-Weg aus T4 hängt daran.
    expect(root.meshes.groupOf).toHaveLength(root.meshes.boxes.length);
  });

  it('feinkost: ein Material je GEBRAUCHTER Art, nicht je Eintrag der Tafel', () => {
    const { root, level } = build(feinkostJson);
    const runtime = buildLevelRuntime(level, fixtureBalance());
    const used: string[] = ['mouse', 'cat', 'floor'];
    for (const room of level.rooms) {
      const kind = room.cameraMode === 'diorama' ? 'floorBurrow' : 'floor';
      if (!used.includes(kind)) used.push(kind);
    }
    for (const collider of runtime.colliders) {
      const kind = colliderKindOf(level, collider.id);
      if (!used.includes(kind)) used.push(kind);
    }
    expect(root.materials.count()).toBe(used.length);
    // 'mouseWeak' steht in der Tafel, wird in M5 aber nie geschaltet – also nie angelegt.
    expect(root.materials.count()).toBeLessThan(GRAYBOX_KINDS.length);
  });

  it('feinkost: der Bau bekommt den HELLEREN Boden, der Laden den normalen', () => {
    const { root, level } = build(feinkostJson);
    const burrow = level.rooms.findIndex((room) => room.cameraMode === 'diorama');
    const shop = level.rooms.findIndex((room) => room.cameraMode === 'follow');
    expect(burrow).toBeGreaterThanOrEqual(0);
    expect(shop).toBeGreaterThanOrEqual(0);
    expect(root.meshes.floors[burrow]?.material).toBe(root.materials.get('floorBurrow'));
    expect(root.meshes.floors[shop]?.material).toBe(root.materials.get('floor'));
    expect(root.meshes.floors[burrow]?.material).not.toBe(root.meshes.floors[shop]?.material);
  });

  it('feinkost: die Böden liegen auf FLOOR_Y und decken ihren Raum', () => {
    const { root, level } = build(feinkostJson);
    for (let i = 0; i < level.rooms.length; i += 1) {
      const room = level.rooms[i];
      const floor = root.meshes.floors[i];
      if (room === undefined || floor === undefined) continue;
      floor.computeWorldMatrix(true);
      const box = floor.getBoundingInfo().boundingBox;
      expect(box.minimumWorld.x).toBeCloseTo(room.bounds.x0, 9);
      expect(box.maximumWorld.x).toBeCloseTo(room.bounds.x1, 9);
      expect(box.minimumWorld.z).toBeCloseTo(room.bounds.z0, 9);
      expect(box.maximumWorld.z).toBeCloseTo(room.bounds.z1, 9);
      expect(floor.position.y).toBe(FLOOR_Y);
      expect(FLOOR_Y).toBeLessThan(0);
    }
  });

  it('die Sichtbarkeit lässt sich je Okkluder-Gruppe schalten und zurücknehmen', () => {
    const { root } = build(feinkostJson);
    const group = root.meshes.groupOf[0] ?? 0;
    expect(group).toBeGreaterThan(0);
    root.meshes.setGroupVisibility(group, 0.35);
    for (let i = 0; i < root.meshes.boxes.length; i += 1) {
      const expected = root.meshes.groupOf[i] === group ? 0.35 : 1;
      expect(root.meshes.boxes[i]?.visibility).toBe(expected);
    }
    root.meshes.resetVisibility();
    for (const mesh of root.meshes.boxes) expect(mesh.visibility).toBe(1);
  });
});

describe('graybox-bounds: Figuren', () => {
  it('stehen auf dem Boden und tragen die geklemmte Kapselhöhe', () => {
    const { root, balance } = build(feinkostJson);
    // Fixture-Balance: Maus radius 0,5 / height 0,8 -> geklemmt auf 1,01; Katze 1,0 / 2,5 -> 2,5.
    // Sechs Stellen und nicht neun: Babylon hält die Eckpunkte als float32, gemessen weicht die
    // Unterkante der Kapsel um 4,77e-9 von 0 ab. Dasselbe float32 ist der Grund für TOLERANCE oben.
    const mouseHeight = Math.max(balance.mouse.height, 2 * balance.mouse.radius + 0.01);
    for (const mesh of root.actors.players) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      expect(box.minimumWorld.y).toBeCloseTo(0, 6);
      expect(box.maximumWorld.y).toBeCloseTo(mouseHeight, 6);
    }
    root.actors.cat.computeWorldMatrix(true);
    expect(root.actors.cat.getBoundingInfo().boundingBox.maximumWorld.y)
      .toBeCloseTo(Math.max(balance.cat.height, 2 * balance.cat.radius + 0.01), 6);
  });

  it('applyActors setzt die Spawns; die Katze ist immer sichtbar', () => {
    const { root, level, balance } = build(feinkostJson);
    applyActors(root.actors, viewOf(level, balance));
    const spawn = level.spawns.mice[0];
    expect(spawn).toBeDefined();
    const first = root.actors.players[0];
    expect(first?.isEnabled(false)).toBe(true);
    expect(first?.position.x).toBeCloseTo(spawn?.x ?? 0, 12);
    expect(first?.position.z).toBeCloseTo(spawn?.z ?? 0, 12);
    expect(root.actors.cat.isEnabled(false)).toBe(true);
    expect(root.actors.cat.position.x).toBeCloseTo(level.spawns.cat.x, 12);
  });

  it('applyActors verbirgt einen stillen und einen gefangenen Platz', () => {
    // GEMESSEN: `feinkost` hat vier Maus-Spawns, also sind zu Tick 0 ALLE VIER Plätze aktiv – der
    // verborgene Fall muss von Hand gestellt werden. Genau deshalb liess sich im Prototyp die
    // Einfrier-Falle von `freezeActiveMeshes` nicht auslösen (Entscheidung 22).
    //
    // `prev` und `curr` sind bewusst VERSCHIEDENE Schnappschüsse (Task-3-Review, Minor 6): `prev`
    // wird VOR dem Verstecken gezogen, zeigt also alle vier Plätze sichtbar; erst `curr` trägt die
    // versteckten Plätze. Mit demselben Schnappschuss für beide fällt ein Tausch auf
    // `prev.visible[index]` in `applyOne` nicht auf – der Test bliebe grün.
    const { root, level, balance } = build(feinkostJson);
    const state = createInitialState(level, balance, 1);
    const still = state.players[1];
    const caught = state.players[2];
    expect(still).toBeDefined();
    expect(caught).toBeDefined();
    if (still === undefined || caught === undefined) return;
    const prev = snapshotFast(state, createSnapshot());
    still.active = false;
    caught.caught = true;
    const curr = snapshotFast(state, createSnapshot());
    applyActors(root.actors, { prev, curr, alpha: 1, slow: makeSlowView(state) });
    expect(root.actors.players[0]?.isEnabled(false)).toBe(true);
    expect(root.actors.players[1]?.isEnabled(false)).toBe(false);
    expect(root.actors.players[2]?.isEnabled(false)).toBe(false);
    expect(root.actors.players[3]?.isEnabled(false)).toBe(true);
    expect(root.actors.cat.isEnabled(false)).toBe(true);
  });

  it('applyActors interpoliert zwischen den beiden Schnappschüssen', () => {
    const { root, level, balance } = build(feinkostJson);
    const state = createInitialState(level, balance, 1);
    const prev = snapshotFast(state, createSnapshot());
    const first = state.players[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    first.pos.x += 4;
    first.facing = Math.PI - 0.1;
    const curr = snapshotFast(state, createSnapshot());
    const slow = makeSlowView(state);
    const spawnX = level.spawns.mice[0]?.x ?? 0;

    applyActors(root.actors, { prev, curr, alpha: 0.5, slow });
    expect(root.actors.players[0]?.position.x).toBeCloseTo(spawnX + 2, 12);
    applyActors(root.actors, { prev, curr, alpha: 1, slow });
    expect(root.actors.players[0]?.position.x).toBeCloseTo(spawnX + 4, 12);
    // Gierwinkel mit UMGEKEHRTEM Vorzeichen – dasselbe wie bei den Kästen.
    expect(root.actors.players[0]?.rotation.y).toBeCloseTo(-(Math.PI - 0.1), 12);
  });
});

describe('graybox-bounds: die gemessenen Grenzen der NullEngine', () => {
  it('scene.render() wirft ohne Kamera und getActiveIndices bleibt 0', () => {
    const { scene } = build(miniJson);
    expect(scene.getActiveIndices()).toBe(0);
    expect(() => scene.render()).toThrow(/No camera defined/);
  });
});
