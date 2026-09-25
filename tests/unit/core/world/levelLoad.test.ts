import { describe, expect, it } from 'vitest';
import { ALL_MASKS, CAT, MOUSE } from '../../../../src/core/world/colliderTypes';
import { LevelError, loadLevel } from '../../../../src/core/world/levelLoad';
import { CM_PER_UNIT } from '../../../../src/core/world/levelTypes';
import miniLevel from '../../../fixtures/core/mini-level.json';

type Json = Record<string, unknown>;

/** Tiefe Kopie der eingefrorenen Fixture, danach EINE gezielte Verletzung. */
function variant(patch: (level: Json) => void): Json {
  const copy = JSON.parse(JSON.stringify(miniLevel)) as Json;
  patch(copy);
  return copy;
}

function sub(source: Json, key: string): Json {
  return source[key] as Json;
}

function list(source: Json, key: string): Json[] {
  return source[key] as Json[];
}

function at(source: Json, key: string, index: number): Json {
  return list(source, key)[index] as Json;
}

/** Liefert den Feldpfad des geworfenen LevelError – oder scheitert, wenn nichts geworfen wurde. */
function errorPath(json: unknown): string {
  try {
    loadLevel(json);
  } catch (error) {
    if (error instanceof LevelError) return error.path;
    throw error;
  }
  throw new Error('loadLevel hat nicht geworfen');
}

describe('loadLevel – die Mini-Level-Fixture', () => {
  const level = loadLevel(miniLevel);

  it('liefert die normalisierte Form mit dem Weltmaßstab 10', () => {
    expect(level.id).toBe('mini');
    expect(level.scale).toBe(CM_PER_UNIT);
    expect(level.rooms).toHaveLength(1);
    expect(level.walls).toHaveLength(4);
    expect(level.shelves).toHaveLength(2);
    expect(level.boxes).toHaveLength(1);
  });

  it('der Raum misst 40 x 30 Einheiten und folgt der Kamera', () => {
    const room = level.rooms[0];
    expect(room?.id).toBe('verkaufsraum');
    expect(room?.cameraMode).toBe('follow');
    expect((room?.bounds.x1 ?? 0) - (room?.bounds.x0 ?? 0)).toBe(40);
    expect((room?.bounds.z1 ?? 0) - (room?.bounds.z0 ?? 0)).toBe(30);
  });

  it('eine Kiste ohne blocks bekommt die Vorgabe ALL_MASKS', () => {
    expect(level.boxes[0]?.blocks).toBe(ALL_MASKS);
  });

  it('Spawns und Mauseloch stehen so da, wie sie in der Fixture stehen', () => {
    expect(level.spawns.mice).toHaveLength(4);
    expect(level.spawns.mice[0]).toEqual({ x: -18, z: -13 });
    expect(level.spawns.cat).toEqual({ x: 12, z: 10 });
    expect(level.mouseHole).toEqual({ x: -19, z: -14 });
  });

  it('ist REIN: eine spätere Änderung an der Eingabe erreicht das Ergebnis nicht', () => {
    const raw = variant(() => undefined);
    const loaded = loadLevel(raw);
    sub(raw, 'spawns')['cat'] = { x: 0, z: 0 };
    at(raw, 'walls', 0)['heightCm'] = 1;
    expect(loaded.spawns.cat).toEqual({ x: 12, z: 10 });
    expect(loaded.walls[0]?.heightCm).toBe(200);
  });
});

describe('loadLevel – erlaubte Sonderfälle', () => {
  it('leere Wand-, Regal- und Kistenlisten sind erlaubt (rooms nicht)', () => {
    const level = loadLevel(variant((l) => {
      l['walls'] = [];
      l['shelves'] = [];
      l['boxes'] = [];
    }));
    expect(level.walls).toHaveLength(0);
    expect(level.shelves).toHaveLength(0);
    expect(level.boxes).toHaveLength(0);
  });

  it('eine ausdrückliche blocks-Maske bleibt erhalten, auch die 0', () => {
    const both = loadLevel(variant((l) => { at(l, 'boxes', 0)['blocks'] = MOUSE | CAT; }));
    expect(both.boxes[0]?.blocks).toBe(3);
    const none = loadLevel(variant((l) => { at(l, 'boxes', 0)['blocks'] = 0; }));
    expect(none.boxes[0]?.blocks).toBe(0);
  });

  it('der Kameramodus diorama wird angenommen', () => {
    const level = loadLevel(variant((l) => { at(l, 'rooms', 0)['cameraMode'] = 'diorama'; }));
    expect(level.rooms[0]?.cameraMode).toBe('diorama');
  });
});

describe('loadLevel – jede Wurf-Bedingung mit ihrem Feldpfad', () => {
  const CASES: readonly { readonly name: string; readonly json: unknown; readonly path: string }[] = [
    { name: 'null statt Objekt', json: null, path: '' },
    { name: 'Liste statt Objekt', json: [], path: '' },
    { name: 'id fehlt', json: variant((l) => { delete l['id']; }), path: 'id' },
    { name: 'id ist leer', json: variant((l) => { l['id'] = ''; }), path: 'id' },
    { name: 'scale ist nicht 10', json: variant((l) => { l['scale'] = 1; }), path: 'scale' },
    { name: 'rooms ist keine Liste', json: variant((l) => { l['rooms'] = {}; }), path: 'rooms' },
    { name: 'rooms ist leer', json: variant((l) => { l['rooms'] = []; }), path: 'rooms' },
    {
      name: 'zwei Räume mit derselben ID',
      json: variant((l) => { list(l, 'rooms').push(JSON.parse(JSON.stringify(at(l, 'rooms', 0))) as Json); }),
      path: 'rooms[1].id',
    },
    { name: 'Raum ohne Namen', json: variant((l) => { delete at(l, 'rooms', 0)['name']; }), path: 'rooms[0].name' },
    { name: 'unbekannter Kameramodus', json: variant((l) => { at(l, 'rooms', 0)['cameraMode'] = 'orbit'; }), path: 'rooms[0].cameraMode' },
    { name: 'bounds.x1 liegt nicht hinter x0', json: variant((l) => { sub(at(l, 'rooms', 0), 'bounds')['x1'] = -20; }), path: 'rooms[0].bounds.x1' },
    { name: 'bounds.z1 liegt nicht hinter z0', json: variant((l) => { sub(at(l, 'rooms', 0), 'bounds')['z1'] = -99; }), path: 'rooms[0].bounds.z1' },
    { name: 'bounds.z0 ist null', json: variant((l) => { sub(at(l, 'rooms', 0), 'bounds')['z0'] = null; }), path: 'rooms[0].bounds.z0' },
    { name: 'walls ist keine Liste', json: variant((l) => { l['walls'] = 4; }), path: 'walls' },
    { name: 'Wand mit x0 = NaN', json: variant((l) => { at(l, 'walls', 0)['x0'] = Number.NaN; }), path: 'walls[0].x0' },
    { name: 'Wand ohne Höhe', json: variant((l) => { at(l, 'walls', 0)['heightCm'] = 0; }), path: 'walls[0].heightCm' },
    { name: 'Wand ohne Dicke', json: variant((l) => { at(l, 'walls', 1)['thicknessCm'] = 0; }), path: 'walls[1].thicknessCm' },
    {
      name: 'Wand ohne Länge',
      json: variant((l) => { const wall = at(l, 'walls', 2); wall['x1'] = wall['x0']; wall['z1'] = wall['z0']; }),
      path: 'walls[2]',
    },
    { name: 'Regal ohne Grundfläche in x', json: variant((l) => { at(l, 'shelves', 0)['hx'] = 0; }), path: 'shelves[0].hx' },
    { name: 'Regal mit negativem hz', json: variant((l) => { at(l, 'shelves', 1)['hz'] = -1; }), path: 'shelves[1].hz' },
    { name: 'Regal mit rot = Infinity', json: variant((l) => { at(l, 'shelves', 0)['rot'] = Number.POSITIVE_INFINITY; }), path: 'shelves[0].rot' },
    { name: 'Regal ohne Spalt', json: variant((l) => { at(l, 'shelves', 1)['gapCm'] = 0; }), path: 'shelves[1].gapCm' },
    { name: 'Regal-Oberkante unter dem Spalt', json: variant((l) => { at(l, 'shelves', 0)['topCm'] = 20; }), path: 'shelves[0].topCm' },
    { name: 'Regalbein ohne Maß', json: variant((l) => { at(l, 'shelves', 0)['legHalfCm'] = 0; }), path: 'shelves[0].legHalfCm' },
    { name: 'Regalbeine überlappen sich', json: variant((l) => { at(l, 'shelves', 0)['legHalfCm'] = 20; }), path: 'shelves[0].legHalfCm' },
    { name: 'Kiste ist keine Karte', json: variant((l) => { list(l, 'boxes')[0] = 7 as unknown as Json; }), path: 'boxes[0]' },
    { name: 'Kiste ohne Grundfläche in x', json: variant((l) => { at(l, 'boxes', 0)['hx'] = 0; }), path: 'boxes[0].hx' },
    { name: 'Kiste ohne Höhe', json: variant((l) => { at(l, 'boxes', 0)['y1Cm'] = 0; }), path: 'boxes[0].y1Cm' },
    { name: 'Kiste mit unbekanntem Maskenbit', json: variant((l) => { at(l, 'boxes', 0)['blocks'] = 16; }), path: 'boxes[0].blocks' },
    { name: 'Kiste mit gebrochener Maske', json: variant((l) => { at(l, 'boxes', 0)['blocks'] = 1.5; }), path: 'boxes[0].blocks' },
    { name: 'Kiste mit Masken-Text', json: variant((l) => { at(l, 'boxes', 0)['blocks'] = 'alle'; }), path: 'boxes[0].blocks' },
    { name: 'spawns fehlt', json: variant((l) => { delete l['spawns']; }), path: 'spawns' },
    { name: 'spawns.mice ist keine Liste', json: variant((l) => { sub(l, 'spawns')['mice'] = {}; }), path: 'spawns.mice' },
    { name: 'spawns.mice ist leer', json: variant((l) => { sub(l, 'spawns')['mice'] = []; }), path: 'spawns.mice' },
    { name: 'Maus-Spawn ohne z', json: variant((l) => { delete (list(sub(l, 'spawns'), 'mice')[0] as Json)['z']; }), path: 'spawns.mice[0].z' },
    { name: 'Maus-Spawn außerhalb jedes Raums', json: variant((l) => { list(sub(l, 'spawns'), 'mice')[2] = { x: 999, z: 0 }; }), path: 'spawns.mice[2]' },
    { name: 'Katzen-Spawn fehlt', json: variant((l) => { delete sub(l, 'spawns')['cat']; }), path: 'spawns.cat' },
    { name: 'Katzen-Spawn außerhalb jedes Raums', json: variant((l) => { sub(l, 'spawns')['cat'] = { x: 0, z: -40 }; }), path: 'spawns.cat' },
    { name: 'mouseHole fehlt', json: variant((l) => { delete l['mouseHole']; }), path: 'mouseHole' },
    { name: 'mouseHole.x ist NaN', json: variant((l) => { sub(l, 'mouseHole')['x'] = Number.NaN; }), path: 'mouseHole.x' },
  ];

  it.each(CASES)('$name -> LevelError auf "$path"', ({ json, path }) => {
    expect(() => loadLevel(json)).toThrow(LevelError);
    expect(errorPath(json)).toBe(path);
  });

  it('die Fehlermeldung nennt den Feldpfad', () => {
    const bad = variant((l) => { at(l, 'shelves', 1)['gapCm'] = 0; });
    expect(() => loadLevel(bad)).toThrow(/^shelves\[1\]\.gapCm: /);
  });
});
