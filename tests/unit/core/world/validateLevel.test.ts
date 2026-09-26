import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import type { Balance } from '../../../../src/core/data/balanceTypes';
import { ALL_MASKS, CAT, MOUSE } from '../../../../src/core/world/colliderTypes';
import type { Collider } from '../../../../src/core/world/colliderTypes';
import { sweepCircle } from '../../../../src/core/world/collision';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import { buildLevelRuntime } from '../../../../src/core/world/levelRuntime';
import type { LevelRuntime } from '../../../../src/core/world/levelRuntime';
import type { LevelDef } from '../../../../src/core/world/levelTypes';
import { circleFree, obbOverlap, validateLevel } from '../../../../src/core/world/validateLevel';
import type { LevelFinding } from '../../../../src/core/world/validateLevel';
import feinkostJson from '../../../../src/data/levels/feinkost.json';
import realBalanceJson from '../../../../src/data/balance.json';
import miniLevelJson from '../../../fixtures/core/mini-level.json';
import testBalanceJson from '../../../fixtures/core/test-balance.json';
import { collider } from '../testWorld';

const testBalance = loadBalance(testBalanceJson);
const realBalance = loadBalance(realBalanceJson);

/**
 * BÜHNE der roten Fälle: ein VON HAND gebautes `LevelDef`, das durch alle zwölf Regeln geht.
 * Jede Variante dreht genau eine Schraube – deshalb muss die Bühne selbst leer bleiben.
 *
 * Grundriss (1 Einheit = 10 cm), ein Raum 40x40 um den Ursprung:
 *   4 Waende auf den Raumkanten (Innenflaechen bei +-19,5)
 *   1 Regal   (10, 10), Baldachin x 6..14, z 8..12, Spalt 12 cm
 *   1 Kiste   (-10, 10), x -12..-8,  z 8..12
 *   1 Pflanze (-10, -10), umschreibendes Quadrat x -12,5..-7,5, z -12,5..-7,5
 *   1 Mauseloch (0, 0) MITTEN im Raum: der Stopfen deckt x -1..1, z -0,5..0,5
 *   3 Wegpunkte (0, 5), (0, -5), (10, 0) – die beiden ersten sind durch den Stopfen getrennt und
 *     haengen nur ueber (10, 0) zusammen; genau das prueft `nav-getrennt` mit.
 */
function baseLevel(): LevelDef {
  return {
    id: 'pruefstand',
    scale: 10,
    rooms: [{ id: 'saal', name: 'Saal', bounds: { x0: -20, z0: -20, x1: 20, z1: 20 }, cameraMode: 'follow' }],
    walls: [
      { x0: -20, z0: -20, x1: 20, z1: -20, heightCm: 200, thicknessCm: 10 },
      { x0: 20, z0: -20, x1: 20, z1: 20, heightCm: 200, thicknessCm: 10 },
      { x0: 20, z0: 20, x1: -20, z1: 20, heightCm: 200, thicknessCm: 10 },
      { x0: -20, z0: 20, x1: -20, z1: -20, heightCm: 200, thicknessCm: 10 },
    ],
    shelves: [{ cx: 10, cz: 10, hx: 4, hz: 2, rot: 0, gapCm: 12, topCm: 180, legHalfCm: 3 }],
    boxes: [{ cx: -10, cz: 10, hx: 2, hz: 2, rot: 0, y0Cm: 0, y1Cm: 100, blocks: 15, kind: 'crate' }],
    plants: [{ id: 'busch', x: -10, z: -10, radiusCm: 25, heightCm: 60 }],
    lootSpawns: [{ id: 'kruemel', x: 5, z: -5, table: 'tisch' }],
    nav: { points: [{ id: 'n1', x: 0, z: 5 }, { id: 'n2', x: 0, z: -5 }, { id: 'n3', x: 10, z: 0 }] },
    spawns: { mice: [{ x: -15, z: -15 }], cat: { x: 15, z: -15 } },
    mouseHole: { x: 0, z: 0, widthCm: 20, heightCm: 200, thicknessCm: 10, rot: 0 },
  };
}

/** Befunde der Bühne mit EINER Änderung. */
function findingsFor(patch: Partial<LevelDef>, balance: Balance = testBalance): LevelFinding[] {
  const level: LevelDef = { ...baseLevel(), ...patch };
  return validateLevel(buildLevelRuntime(level, balance), balance);
}

function codesOf(findings: readonly LevelFinding[]): string[] {
  return findings.map((finding) => finding.code);
}

function pathsOf(findings: readonly LevelFinding[]): string[] {
  return findings.map((finding) => finding.path);
}

/** Achsenparalleler Kollider für die reinen `obbOverlap`-Fälle. */
function aabb(id: number, cx: number, cz: number, hx: number, hz: number): Collider {
  return collider(id, cx, cz, { hx, hz, y1: 10, blocks: ALL_MASKS });
}

/** Gedrehter Kollider; `rc`/`rs` rechnet die gemeinsame Fabrik wie `generateColliders` vor. */
function turned(id: number, cx: number, cz: number, hx: number, hz: number, rot: number): Collider {
  return collider(id, cx, cz, { hx, hz, y1: 10, rot, blocks: ALL_MASKS });
}

describe('validateLevel – die Bühne der roten Fälle ist selbst sauber', () => {
  it('liefert mit beiden Balancen eine leere Befundliste', () => {
    expect(findingsFor({}, testBalance)).toEqual([]);
    expect(findingsFor({}, realBalance)).toEqual([]);
  });

  it('die vier Raumecken sind ECHTE Wand-Ueberdeckungen – die Ausnahme arbeitet also', () => {
    const runtime = buildLevelRuntime(baseLevel(), testBalance);
    const walls = runtime.colliders.slice(0, 4);
    let pairs = 0;
    for (let i = 0; i < walls.length; i += 1) {
      for (let j = i + 1; j < walls.length; j += 1) {
        const a = walls[i];
        const b = walls[j];
        if (a !== undefined && b !== undefined && obbOverlap(a, b)) pairs += 1;
      }
    }
    expect(pairs).toBe(4);
  });
});

describe('validateLevel – jede Regel einmal gezielt rot', () => {
  it('nav-leer: ohne Wegpunkte faellt auch jede Erreichbarkeit', () => {
    const findings = findingsFor({ nav: { points: [] } });
    expect(codesOf(findings)).toEqual([
      'nav-leer', 'unerreichbar', 'unerreichbar', 'unerreichbar', 'loch-sperrt-maus',
    ]);
    expect(pathsOf(findings)).toEqual([
      'nav.points', 'spawns.mice[0]', 'lootSpawns[0]', 'plants[0]', 'mouseHole',
    ]);
    // Zweiter Zweig von `loch-sperrt-maus`: nicht „kommt nicht durch", sondern „kein Wegpunkt".
    expect(findings[4]?.message).toContain('Wegpunkt');
    expect(findings[4]?.message).toContain('saal');
  });

  it('nav-getrennt: ein vierter, zu weit entfernter Wegpunkt zerfaellt den Raum', () => {
    const level = baseLevel();
    const findings = findingsFor({
      nav: { points: [...level.nav.points, { id: 'insel', x: -16, z: 16 }] },
    });
    expect(codesOf(findings)).toEqual(['nav-getrennt']);
    expect(pathsOf(findings)).toEqual(['rooms[0]']);
  });

  it('nav-blockiert: ein Wegpunkt in der Kiste ist fuer die Katze gesperrt – und damit immer isoliert', () => {
    const level = baseLevel();
    const findings = findingsFor({
      nav: { points: [...level.nav.points, { id: 'inKiste', x: -10, z: 10 }] },
    });
    // Ein katzenblockierter Punkt kann per Konstruktion keine Kante haben (jeder Sweep dorthin
    // steckt am Ziel fest), er ist also IMMER auch eine eigene Komponente. Beide Befunde gehoeren
    // zusammen; die Reihenfolge ist die Regelreihenfolge.
    expect(codesOf(findings)).toEqual(['nav-getrennt', 'nav-blockiert']);
    expect(pathsOf(findings)).toEqual(['rooms[0]', 'nav.points[3]']);
  });

  it('spawn-blockiert: der Katzen-Spawn in der Kiste ist der saubere Einzelfall', () => {
    const findings = findingsFor({ spawns: { mice: [{ x: -15, z: -15 }], cat: { x: -10, z: 10 } } });
    expect(codesOf(findings)).toEqual(['spawn-blockiert']);
    expect(pathsOf(findings)).toEqual(['spawns.cat']);
  });

  it('spawn-blockiert: ein Maus-Spawn in der Kiste ist zwangslaeufig auch unerreichbar', () => {
    const findings = findingsFor({ spawns: { mice: [{ x: -10, z: 10 }], cat: { x: 15, z: -15 } } });
    // Wer in einem mausblockierenden Koerper steckt, kommt auch mit keinem Sweep heraus:
    // `sweepCircle` meldet die Startlage (Fall A) als blockiert.
    expect(codesOf(findings)).toEqual(['spawn-blockiert', 'unerreichbar']);
    expect(pathsOf(findings)).toEqual(['spawns.mice[0]', 'spawns.mice[0]']);
  });

  it('loot-blockiert: ein Beuteplatz in der Kiste', () => {
    const findings = findingsFor({ lootSpawns: [{ id: 'kruemel', x: -10, z: 10, table: 'tisch' }] });
    expect(codesOf(findings)).toEqual(['loot-blockiert', 'unerreichbar']);
    expect(pathsOf(findings)).toEqual(['lootSpawns[0]', 'lootSpawns[0]']);
  });

  it('ausserhalb: Pflanze, Beuteplatz und Wegpunkt ausserhalb jedes Raums – in DIESER Reihenfolge', () => {
    const level = baseLevel();
    const findings = findingsFor({
      plants: [{ id: 'busch', x: 100, z: 0, radiusCm: 25, heightCm: 60 }],
      lootSpawns: [{ id: 'kruemel', x: 100, z: 10, table: 'tisch' }],
      nav: { points: [...level.nav.points, { id: 'weit', x: 100, z: 20 }] },
    });
    expect(codesOf(findings)).toEqual(['ausserhalb', 'ausserhalb', 'ausserhalb']);
    expect(pathsOf(findings)).toEqual(['plants[0]', 'lootSpawns[0]', 'nav.points[3]']);
  });

  it('unerreichbar: ein zweiter Raum ohne Wegpunkte haelt seinen Beuteplatz gefangen', () => {
    const level = baseLevel();
    const findings = findingsFor({
      rooms: [...level.rooms, { id: 'keller', name: 'Keller', bounds: { x0: 40, z0: 40, x1: 60, z1: 60 }, cameraMode: 'diorama' }],
      lootSpawns: [{ id: 'kruemel', x: 50, z: 50, table: 'tisch' }],
    });
    expect(codesOf(findings)).toEqual(['unerreichbar']);
    expect(pathsOf(findings)).toEqual(['lootSpawns[0]']);
  });

  it('loch-sperrt-maus: ein Stopfen IN der Wand statt in einer Luecke sperrt und ueberdeckt zugleich', () => {
    const findings = findingsFor({ mouseHole: { x: 0, z: -20, widthCm: 20, heightCm: 200, thicknessCm: 10, rot: 0 } });
    expect(codesOf(findings)).toEqual(['loch-sperrt-maus', 'ueberdeckung']);
    expect(pathsOf(findings)).toEqual(['mouseHole', 'walls[0]~mouseHole']);
    expect(findings[0]?.message).toContain('kommt nicht durch');
  });

  it('loch-laesst-katze: ohne den Stopfen steht das Loch der Katze offen', () => {
    const runtime = buildLevelRuntime(baseLevel(), testBalance);
    // Der Stopfen ist per Vertrag der LETZTE Kollider; ohne ihn ist das Loch fuer die Katze frei.
    const ohneStopfen: LevelRuntime = { ...runtime, colliders: runtime.colliders.slice(0, -1) };
    const findings = validateLevel(ohneStopfen, testBalance);
    expect(codesOf(findings)).toEqual(['loch-laesst-katze']);
    expect(pathsOf(findings)).toEqual(['mouseHole']);
  });

  it('versteck-offen: ohne den Pflanzen-Kollider kommt die Katze ins Versteck', () => {
    const runtime = buildLevelRuntime(baseLevel(), testBalance);
    // Reihenfolge: 4 Waende, 5 Regal, 1 Kiste, 1 Pflanze, 1 Stopfen -> die Pflanze ist id 10.
    const ohnePflanze: LevelRuntime = {
      ...runtime,
      colliders: runtime.colliders.filter((collider) => collider.id !== 10),
    };
    const findings = validateLevel(ohnePflanze, testBalance);
    expect(codesOf(findings)).toEqual(['versteck-offen']);
    expect(findings[0]?.message).toContain('Katze kommt hinein');
  });

  it('versteck-offen: eine Pflanze IN der Kiste laesst die Maus nicht hinein', () => {
    const findings = findingsFor({ plants: [{ id: 'busch', x: -10, z: 10, radiusCm: 25, heightCm: 60 }] });
    // Drei Befunde, und alle drei stimmen: die Maus steckt fest (also auch unerreichbar), das
    // Versteck ist verbaut, und Kiste (MOUSE|CAT|SIGHT|CAMERA) und Pflanze (CAT|SIGHT) halten
    // BEIDE die Katze auf – das ist eine echte Ueberdeckung. Die Reihenfolge ist die Regelfolge.
    expect(codesOf(findings)).toEqual(['unerreichbar', 'versteck-offen', 'ueberdeckung']);
    expect(pathsOf(findings)).toEqual(['plants[0]', 'plants[0]', 'boxes[0]~plants[0]']);
    expect(findings[1]?.message).toContain('Maus kommt nicht hinein');
  });

  it('regalspalt: zu niedrig und zu hoch, beides gegen die Test-Balance (Maus 0,8 / Katze 2,5)', () => {
    const zuNiedrig = findingsFor({ shelves: [{ cx: 10, cz: 10, hx: 4, hz: 2, rot: 0, gapCm: 4, topCm: 180, legHalfCm: 3 }] });
    expect(codesOf(zuNiedrig)).toEqual(['regalspalt']);
    expect(pathsOf(zuNiedrig)).toEqual(['shelves[0].gapCm']);
    const zuHoch = findingsFor({ shelves: [{ cx: 10, cz: 10, hx: 4, hz: 2, rot: 0, gapCm: 40, topCm: 180, legHalfCm: 3 }] });
    expect(codesOf(zuHoch)).toEqual(['regalspalt']);
  });

  it('ueberdeckung: eine Kiste IN der Westwand – die Ausnahme gilt nur fuer Wand gegen Wand', () => {
    const findings = findingsFor({
      boxes: [{ cx: -19, cz: 0, hx: 2, hz: 2, rot: 0, y0Cm: 0, y1Cm: 100, blocks: ALL_MASKS, kind: 'crate' }],
    });
    expect(codesOf(findings)).toEqual(['ueberdeckung']);
    expect(pathsOf(findings)).toEqual(['walls[3]~boxes[0]']);
  });

  it('ueberdeckung: die Wand-Ausnahme und der Pfad haengen an der `id`, nicht an der Array-Stelle', () => {
    // Ein Regal auf (19, 10) legt seinen Baldachin IN die Ostwand (id 1). Aus der Kolliderliste wird
    // zusaetzlich die Suedwand (id 0) entfernt: die Ostwand steht dann auf Array-Stelle 0, der
    // Baldachin auf 7 – der Pfad nennt trotzdem `walls[1]`, weil `sourcePath` die id liest.
    const level: LevelDef = { ...baseLevel(), shelves: [{ cx: 19, cz: 10, hx: 4, hz: 2, rot: 0, gapCm: 12, topCm: 180, legHalfCm: 3 }] };
    const runtime = buildLevelRuntime(level, testBalance);
    const ohneSuedwand: LevelRuntime = {
      ...runtime,
      colliders: runtime.colliders.filter((entry) => entry.id !== 0),
    };
    const findings = validateLevel(ohneSuedwand, testBalance);
    expect(codesOf(findings)).toEqual(['ueberdeckung']);
    expect(pathsOf(findings)).toEqual(['walls[1]~shelves[0]']);

    // Und die AUSNAHME selbst haengt ebenso an der id: dieselbe Liste mit den vier Waenden am ENDE
    // (Array-Stellen 8–11, alle jenseits von `level.walls.length`) meldet weiterhin GENAU EINEN
    // Befund. Schriebe die Regel `i < wallCount && j < wallCount` – also die Laufindizes –, kaemen
    // die vier Raumecken dazu (GEMESSEN: 5 statt 1 Befund). Nur die REIHENFOLGE im Pfad dreht sich
    // mit der Liste, die Namen darin kommen weiter aus den IDs.
    const wallCount = level.walls.length;
    const verdreht: LevelRuntime = {
      ...runtime,
      colliders: [
        ...runtime.colliders.filter((entry) => entry.id >= wallCount),
        ...runtime.colliders.filter((entry) => entry.id < wallCount),
      ],
    };
    expect(pathsOf(validateLevel(verdreht, testBalance))).toEqual(['shelves[0]~walls[1]']);
  });

  it('ueberdeckung: eine HOHE Kiste ueber dem Baldachin betrifft niemanden', () => {
    // Abweichung 10 sagt „wirksam = Maskenbit UND Hoehenband-Ueberlappung". Diese Kiste sitzt bei
    // y 5…8 Einheiten, der Baldachin bei 1,2…18 – sie ueberlappen sich also in der Hoehe. Aber die
    // Katze reicht nur bis 2,5 und die Maus bis 0,8: fuer BEIDE Bewegten-Arten ist die Kiste
    // unwirksam, und damit gibt es kein Paar. Ohne `overlapsY` in `affects` meldet derselbe Fall
    // `ueberdeckung` (gemessen) – das ist die Mutation, die dieser Fall toetet.
    const findings = findingsFor({
      boxes: [
        { cx: -10, cz: 10, hx: 2, hz: 2, rot: 0, y0Cm: 0, y1Cm: 100, blocks: ALL_MASKS, kind: 'crate' },
        { cx: 10, cz: 10, hx: 1, hz: 1, rot: 0, y0Cm: 50, y1Cm: 80, blocks: ALL_MASKS, kind: 'crate' },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('circleFree ist ein Sweep der Laenge 0', () => {
  const runtime = buildLevelRuntime(baseLevel(), testBalance);

  it('liefert fuer jede Probe genau die Umkehrung von sweepCircle(a, a, …)', () => {
    const probes = [
      { x: 0, z: 0 }, { x: -10, z: 10 }, { x: -10, z: -10 }, { x: 10, z: 10 },
      { x: -19.6, z: 0 }, { x: 0, z: 12 }, { x: 6.3, z: 8.3 },
    ];
    for (const probe of probes) {
      for (const [mask, yRange] of [[MOUSE, testBalance.mouse.yRange], [CAT, testBalance.cat.yRange]] as const) {
        const radius = mask === MOUSE ? testBalance.mouse.radius : testBalance.cat.radius;
        const swept = sweepCircle(probe, probe, radius, yRange, mask, runtime.colliders);
        expect(circleFree(probe.x, probe.z, radius, yRange, mask, runtime.colliders), `${probe.x}/${probe.z}/${mask}`).toBe(!swept);
      }
    }
  });

  it('trennt Maus und Katze am Mauseloch – genau das ist die Regel loch-*', () => {
    const hole = baseLevel().mouseHole;
    const mouse = testBalance.mouse;
    const cat = testBalance.cat;
    expect(circleFree(hole.x, hole.z, mouse.radius, mouse.yRange, MOUSE, runtime.colliders)).toBe(true);
    expect(circleFree(hole.x, hole.z, cat.radius, cat.yRange, CAT, runtime.colliders)).toBe(false);
  });
});

describe('obbOverlap – Beruehrung, Ueberdeckung, Drehung', () => {
  it('Beruehrung zaehlt NICHT als Ueberdeckung', () => {
    expect(obbOverlap(aabb(0, 0, 0, 1, 1), aabb(1, 2, 0, 1, 1))).toBe(false);
    expect(obbOverlap(aabb(0, 0, 0, 1, 1), aabb(1, 0, 2, 1, 1))).toBe(false);
    expect(obbOverlap(aabb(0, 0, 0, 1, 1), aabb(1, 2, 2, 1, 1))).toBe(false);
  });

  it('eine Ueberdeckung wird erkannt, ein Abstand nicht', () => {
    expect(obbOverlap(aabb(0, 0, 0, 1, 1), aabb(1, 1.9, 0, 1, 1))).toBe(true);
    expect(obbOverlap(aabb(0, 0, 0, 1, 1), aabb(1, 2.1, 0, 1, 1))).toBe(false);
    expect(obbOverlap(aabb(0, 0, 0, 5, 5), aabb(1, 0, 0, 1, 1))).toBe(true);
  });

  it('ist symmetrisch', () => {
    const a = turned(0, 0, 0, 3, 1, 0.4);
    const b = aabb(1, 2.5, 1, 1, 1);
    expect(obbOverlap(a, b)).toBe(obbOverlap(b, a));
  });

  it('gedreht: der Umkreis-Vorfilter waere hier falsch, der SAT nicht', () => {
    // Zwei um 45 Grad gegeneinander gedrehte Quadrate, Mitten 2,7 auseinander: die UMKREISE
    // (Radius sqrt(2) = 1,414 je Quadrat, Summe 2,83) schneiden sich, die Rechtecke nicht.
    const a = aabb(0, 0, 0, 1, 1);
    const b = turned(1, 2.7, 0, 1, 1, Math.PI / 4);
    expect(obbOverlap(a, b)).toBe(false);
    // Naeher herangeschoben treffen sie sich dann doch.
    expect(obbOverlap(a, turned(1, 2.3, 0, 1, 1, Math.PI / 4))).toBe(true);
  });

  it('gedreht: eine Ecke stuelpt sich in eine lange, schraege Platte', () => {
    const platte = turned(0, 0, 0, 6, 0.5, Math.PI / 6);
    expect(obbOverlap(platte, aabb(1, 4, 2.4, 0.6, 0.6))).toBe(true);
    expect(obbOverlap(platte, aabb(1, 4, 4, 0.6, 0.6))).toBe(false);
  });
});

describe('validateLevel gegen die echten Level', () => {
  const feinkost = loadLevel(feinkostJson);
  const mini = loadLevel(miniLevelJson);

  it('feinkost ist mit BEIDEN Balancen ohne Befund', () => {
    expect(validateLevel(buildLevelRuntime(feinkost, testBalance), testBalance)).toEqual([]);
    expect(validateLevel(buildLevelRuntime(feinkost, realBalance), realBalance)).toEqual([]);
  });

  it('mini-level ist mit BEIDEN Balancen ohne Befund', () => {
    expect(validateLevel(buildLevelRuntime(mini, testBalance), testBalance)).toEqual([]);
    expect(validateLevel(buildLevelRuntime(mini, realBalance), realBalance)).toEqual([]);
  });

  it('die Kennzahlen der beiden Level sind gepinnt', () => {
    // Gebaut wird hier mit der EINGEFRORENEN Balance, obwohl das Level das echte ist: die Kanten
    // haengen am Katzenradius, und jede Zahl in src/data/balance.json ist bis zum Spass-GATE
    // provisorisch. Mit der Fixture kann ein Reglerdreh in M6 diesen Fall nicht rot machen –
    // rot wird er nur, wenn sich das LAYOUT aendert, und genau das soll er zeigen.
    const feinkostRuntime = buildLevelRuntime(feinkost, testBalance);
    // 9 Waende + 4 Regale a 5 + 4 Kisten + 5 Pflanzen + 1 Stopfen = 39 (balanceunabhaengig).
    expect(feinkostRuntime.colliders).toHaveLength(39);
    expect(feinkostRuntime.nav.points).toHaveLength(60);
    expect(feinkostRuntime.nav.adjacency.reduce((sum, list) => sum + list.length, 0) / 2).toBe(91);
    // 54 Punkte im Verkaufsraum, 6 im Bau – die Katze kommt nie in den Bau, deshalb gilt
    // „zusammenhaengend" JE RAUM und nicht global.
    expect(feinkostRuntime.nav.points.filter((point) => point.room === 1)).toHaveLength(6);
    // Mit der echten Balance nur eine SCHWELLE, keine Zahl.
    expect(buildLevelRuntime(feinkost, realBalance).nav.adjacency.some((list) => list.length > 0)).toBe(true);

    const miniRuntime = buildLevelRuntime(mini, testBalance);
    // 4 Waende + 2 Regale a 5 + 1 Kiste + 1 Stopfen = 16; der Stopfen ist id 15.
    expect(miniRuntime.colliders).toHaveLength(16);
    expect(miniRuntime.colliders[15]?.blocks).toBe(10);
    expect(miniRuntime.colliders[15]?.hx).toBe(1);
    expect(miniRuntime.colliders[15]?.hz).toBe(0.5);
    expect(miniRuntime.nav.points).toHaveLength(3);
    expect(miniRuntime.nav.adjacency.reduce((sum, list) => sum + list.length, 0) / 2).toBe(2);
  });
});
