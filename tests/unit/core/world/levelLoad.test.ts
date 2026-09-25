import { describe, expect, it } from 'vitest';
import { ALL_MASKS, CAT, MOUSE } from '../../../../src/core/world/colliderTypes';
import { LevelError, loadLevel } from '../../../../src/core/world/levelLoad';
import { CM_PER_UNIT } from '../../../../src/core/world/levelTypes';
import feinkostLevel from '../../../../src/data/levels/feinkost.json';
import miniLevel from '../../../fixtures/core/mini-level.json';
import { makeVariant, pathOfThrow, sub } from '../jsonVariant';
import type { Json } from '../jsonVariant';

/** Tiefe Kopie der eingefrorenen Fixture, danach EINE gezielte Verletzung. */
const variant = makeVariant(miniLevel);

function list(source: Json, key: string): Json[] {
  return source[key] as Json[];
}

function at(source: Json, key: string, index: number): Json {
  return list(source, key)[index] as Json;
}

/** Liefert den Feldpfad des geworfenen LevelError – oder scheitert, wenn nichts geworfen wurde. */
function errorPath(json: unknown): string {
  return pathOfThrow(loadLevel, json, LevelError);
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

  it('eine Kiste ohne blocks bekommt die Vorgabe ALL_MASKS und ohne kind die Bauart crate', () => {
    expect(level.boxes[0]?.blocks).toBe(ALL_MASKS);
    expect(level.boxes[0]?.kind).toBe('crate');
  });

  it('die Fixture hat keine plants und keine lootSpawns – der Loader macht daraus leere Listen', () => {
    // Genau dafür fehlen die beiden Listen in der Fixture: „optional" ist damit bewiesen und nicht
    // behauptet. `nav` steht dagegen drin (3 handgesetzte Punkte, M4).
    expect(level.plants).toEqual([]);
    expect(level.lootSpawns).toEqual([]);
    expect(level.nav.points.map((point) => point.id)).toEqual(['nav-west', 'nav-mitte', 'nav-ost']);
    expect(level.nav.points[1]).toEqual({ id: 'nav-mitte', x: 0, z: 10 });
  });

  it('Spawns und Mauseloch stehen so da, wie sie in der Fixture stehen', () => {
    expect(level.spawns.mice).toHaveLength(4);
    expect(level.spawns.mice[0]).toEqual({ x: -18, z: -13 });
    expect(level.spawns.cat).toEqual({ x: 12, z: 10 });
    // M4: das Loch trägt vier Maße und ist aus der Südwest-Ecke gerückt – dort überdeckte sein
    // Sperrkörper die Westwand. Der Golden-Hash bleibt davon unberührt (siehe Abschnittskopf).
    expect(level.mouseHole).toEqual({ x: -10, z: -14, widthCm: 20, heightCm: 200, thicknessCm: 10, rot: 0 });
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

  it('ein Spawn genau auf der unteren Raumkante (x0, z0) wird angenommen (halboffen: x0 <= x, z0 <= z)', () => {
    const level = loadLevel(variant((l) => {
      list(sub(l, 'spawns'), 'mice')[0] = { x: -20, z: -15 };
    }));
    expect(level.spawns.mice[0]).toEqual({ x: -20, z: -15 });
  });

  it('alle vier Bauarten werden angenommen', () => {
    for (const kind of ['crate', 'counter', 'vitrine', 'window'] as const) {
      const level = loadLevel(variant((l) => { at(l, 'boxes', 0)['kind'] = kind; }));
      expect(level.boxes[0]?.kind).toBe(kind);
    }
  });

  it('ein leeres nav-Objekt und leere M4-Listen sind erlaubt', () => {
    const level = loadLevel(variant((l) => {
      l['plants'] = [];
      l['lootSpawns'] = [];
      l['nav'] = {};
    }));
    expect(level.plants).toEqual([]);
    expect(level.lootSpawns).toEqual([]);
    expect(level.nav.points).toEqual([]);
  });

  it('Pflanze, Beuteplatz und Wegpunkt genau auf der unteren Raumkante werden angenommen', () => {
    const level = loadLevel(variant((l) => {
      l['plants'] = [{ id: 'p', x: -20, z: -15, radiusCm: 25, heightCm: 60 }];
      l['lootSpawns'] = [{ id: 'b', x: -20, z: -15, table: 'kaese' }];
      l['nav'] = { points: [{ id: 'n', x: -20, z: -15 }] };
    }));
    expect(level.plants[0]?.id).toBe('p');
    expect(level.lootSpawns[0]?.table).toBe('kaese');
    expect(level.nav.points[0]).toEqual({ id: 'n', x: -20, z: -15 });
  });
});

/**
 * Die echte Ladendatei kommt in T1 dazu; ihre ZAHLEN (Kollider, Wegpunkte, Kanten, Befunde) pinnen
 * T2 und T3. Hier steht nur die Zusicherung, die T1 selbst tragen muss: die Datei ist ladbar und
 * normalisiert, ohne dass eine Layout-Änderung in T3 diesen Test rot macht.
 */
describe('loadLevel – src/data/levels/feinkost.json', () => {
  const level = loadLevel(feinkostLevel);

  it('lädt ohne Fehler und hat beide Räume mit ihren Kameramodi', () => {
    expect(level.id).toBe('feinkost');
    expect(level.rooms.map((r) => r.id)).toEqual(['verkaufsraum', 'bau']);
    expect(level.rooms.map((r) => r.cameraMode)).toEqual(['follow', 'diorama']);
  });

  it('trägt alle drei M4-Listen gefüllt und vier verschiedene Bauarten', () => {
    expect(level.plants.length).toBeGreaterThan(0);
    expect(level.lootSpawns.length).toBeGreaterThan(0);
    expect(level.nav.points.length).toBeGreaterThan(0);
    const kinds = level.boxes.map((box) => box.kind);
    for (const kind of ['crate', 'counter', 'vitrine', 'window'] as const) expect(kinds).toContain(kind);
  });

  it('das Mauseloch steht in der geteilten Westwand, quer zur Wandlinie', () => {
    expect(level.mouseHole.widthCm).toBe(20);
    expect(level.mouseHole.thicknessCm).toBe(10);
    expect(level.mouseHole.heightCm).toBe(250);
    expect(level.mouseHole.rot).toBeCloseTo(Math.PI / 2, 12);
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
    {
      name: 'Maus-Spawn genau auf x1 liegt in keinem Raum (halboffen: x < x1)',
      json: variant((l) => { list(sub(l, 'spawns'), 'mice')[0] = { x: 20, z: -5 }; }),
      path: 'spawns.mice[0]',
    },
    { name: 'Katzen-Spawn fehlt', json: variant((l) => { delete sub(l, 'spawns')['cat']; }), path: 'spawns.cat' },
    { name: 'Katzen-Spawn außerhalb jedes Raums', json: variant((l) => { sub(l, 'spawns')['cat'] = { x: 0, z: -40 }; }), path: 'spawns.cat' },
    {
      name: 'Katzen-Spawn genau auf z1 liegt in keinem Raum (halboffen: z < z1)',
      json: variant((l) => { sub(l, 'spawns')['cat'] = { x: 0, z: 15 }; }),
      path: 'spawns.cat',
    },
    { name: 'mouseHole fehlt', json: variant((l) => { delete l['mouseHole']; }), path: 'mouseHole' },
    { name: 'mouseHole.x ist NaN', json: variant((l) => { sub(l, 'mouseHole')['x'] = Number.NaN; }), path: 'mouseHole.x' },
    // ── M4: Bauart, die drei neuen Listen und die vier Maße des Mauselochs ──────────────────────
    { name: 'unbekannte Kisten-Bauart', json: variant((l) => { at(l, 'boxes', 0)['kind'] = 'regal'; }), path: 'boxes[0].kind' },
    { name: 'Bauart ist keine Zeichenkette', json: variant((l) => { at(l, 'boxes', 0)['kind'] = 3; }), path: 'boxes[0].kind' },
    { name: 'plants ist keine Liste', json: variant((l) => { l['plants'] = {}; }), path: 'plants' },
    { name: 'Pflanze ist kein Objekt', json: variant((l) => { l['plants'] = [7]; }), path: 'plants[0]' },
    { name: 'Pflanze ohne id', json: variant((l) => { l['plants'] = [{ x: 0, z: 0, radiusCm: 25, heightCm: 60 }]; }), path: 'plants[0].id' },
    { name: 'Pflanze mit leerer id', json: variant((l) => { l['plants'] = [{ id: '', x: 0, z: 0, radiusCm: 25, heightCm: 60 }]; }), path: 'plants[0].id' },
    {
      name: 'zwei Pflanzen mit derselben id',
      json: variant((l) => {
        l['plants'] = [
          { id: 'busch', x: 0, z: 0, radiusCm: 25, heightCm: 60 },
          { id: 'busch', x: 4, z: 0, radiusCm: 25, heightCm: 60 },
        ];
      }),
      path: 'plants[1].id',
    },
    { name: 'Pflanze ohne Radius', json: variant((l) => { l['plants'] = [{ id: 'busch', x: 0, z: 0, radiusCm: 0, heightCm: 60 }]; }), path: 'plants[0].radiusCm' },
    { name: 'Pflanze mit negativer Höhe', json: variant((l) => { l['plants'] = [{ id: 'busch', x: 0, z: 0, radiusCm: 25, heightCm: -1 }]; }), path: 'plants[0].heightCm' },
    { name: 'Pflanze außerhalb jedes Raums', json: variant((l) => { l['plants'] = [{ id: 'busch', x: 99, z: 0, radiusCm: 25, heightCm: 60 }]; }), path: 'plants[0]' },
    {
      name: 'Pflanze genau auf z1 liegt in keinem Raum (halboffen: z < z1)',
      json: variant((l) => { l['plants'] = [{ id: 'busch', x: 0, z: 15, radiusCm: 25, heightCm: 60 }]; }),
      path: 'plants[0]',
    },
    { name: 'lootSpawns ist keine Liste', json: variant((l) => { l['lootSpawns'] = 'viele'; }), path: 'lootSpawns' },
    { name: 'Beuteplatz ohne id', json: variant((l) => { l['lootSpawns'] = [{ x: 0, z: 0, table: 'kaese' }]; }), path: 'lootSpawns[0].id' },
    {
      name: 'zwei Beuteplätze mit derselben id',
      json: variant((l) => {
        l['lootSpawns'] = [{ id: 'b', x: 0, z: 0, table: 'kaese' }, { id: 'b', x: 2, z: 0, table: 'kaese' }];
      }),
      path: 'lootSpawns[1].id',
    },
    { name: 'Beuteplatz ohne Tabelle', json: variant((l) => { l['lootSpawns'] = [{ id: 'b', x: 0, z: 0, table: '' }]; }), path: 'lootSpawns[0].table' },
    { name: 'Beuteplatz außerhalb jedes Raums', json: variant((l) => { l['lootSpawns'] = [{ id: 'b', x: 0, z: -99, table: 'kaese' }]; }), path: 'lootSpawns[0]' },
    { name: 'nav ist keine Karte', json: variant((l) => { l['nav'] = []; }), path: 'nav' },
    { name: 'nav.points ist keine Liste', json: variant((l) => { l['nav'] = { points: 3 }; }), path: 'nav.points' },
    { name: 'Wegpunkt ohne id', json: variant((l) => { l['nav'] = { points: [{ x: 0, z: 0 }] }; }), path: 'nav.points[0].id' },
    {
      name: 'zwei Wegpunkte mit derselben id',
      json: variant((l) => { l['nav'] = { points: [{ id: 'n', x: 0, z: 0 }, { id: 'n', x: 2, z: 0 }] }; }),
      path: 'nav.points[1].id',
    },
    { name: 'Wegpunkt ohne x', json: variant((l) => { l['nav'] = { points: [{ id: 'n', z: 0 }] }; }), path: 'nav.points[0].x' },
    {
      name: 'Wegpunkt außerhalb jedes Raums',
      json: variant((l) => { l['nav'] = { points: [{ id: 'n1', x: 0, z: 0 }, { id: 'n2', x: 0, z: 0 }, { id: 'n3', x: 0, z: 99 }] }; }),
      path: 'nav.points[2]',
    },
    { name: 'mouseHole.widthCm fehlt', json: variant((l) => { delete sub(l, 'mouseHole')['widthCm']; }), path: 'mouseHole.widthCm' },
    { name: 'mouseHole.widthCm ist 0', json: variant((l) => { sub(l, 'mouseHole')['widthCm'] = 0; }), path: 'mouseHole.widthCm' },
    { name: 'mouseHole.heightCm ist negativ', json: variant((l) => { sub(l, 'mouseHole')['heightCm'] = -5; }), path: 'mouseHole.heightCm' },
    { name: 'mouseHole.thicknessCm fehlt', json: variant((l) => { delete sub(l, 'mouseHole')['thicknessCm']; }), path: 'mouseHole.thicknessCm' },
    { name: 'mouseHole.rot fehlt', json: variant((l) => { delete sub(l, 'mouseHole')['rot']; }), path: 'mouseHole.rot' },
    { name: 'mouseHole.rot ist nicht endlich', json: variant((l) => { sub(l, 'mouseHole')['rot'] = Number.POSITIVE_INFINITY; }), path: 'mouseHole.rot' },
  ];

  it('das Mauseloch darf auf einer Raumgrenze liegen (Portal in der Wand – M4 legt die Regel fest)', () => {
    // Bewusst KEINE Raumprüfung fürs Mauseloch: ein Portal sitzt in einer Wand, also genau auf der
    // (halboffenen) Grenze. Diese Ausnahme gilt NUR dem Loch – Pflanzen, Beuteplätze und Wegpunkte
    // müssen in einem Raum liegen (Fälle oben).
    const hole = { x: 20, z: -14, widthCm: 20, heightCm: 200, thicknessCm: 10, rot: 0 };
    const onEdge = variant((l) => { l['mouseHole'] = { ...hole }; });
    expect(loadLevel(onEdge).mouseHole).toEqual(hole);
  });

  it.each(CASES)('$name -> LevelError auf "$path"', ({ json, path }) => {
    expect(() => loadLevel(json)).toThrow(LevelError);
    expect(errorPath(json)).toBe(path);
  });

  it('die Fehlermeldung nennt den Feldpfad', () => {
    const bad = variant((l) => { at(l, 'shelves', 1)['gapCm'] = 0; });
    expect(() => loadLevel(bad)).toThrow(/^shelves\[1\]\.gapCm: /);
  });
});
