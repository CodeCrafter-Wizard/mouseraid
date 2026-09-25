import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import type { Balance } from '../../../../src/core/data/balanceTypes';
import type { StepContext } from '../../../../src/core/sim/state';
import { CAT, MOUSE } from '../../../../src/core/world/colliderTypes';
import { generateColliders } from '../../../../src/core/world/generateColliders';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import { NAV_MAX_EDGE, buildLevelRuntime, largestNavComponent } from '../../../../src/core/world/levelRuntime';
import type { NavGraph } from '../../../../src/core/world/levelRuntime';
import { CM_PER_UNIT } from '../../../../src/core/world/levelTypes';
import type { LevelBox, LevelDef, LevelNavPoint, LevelRoom } from '../../../../src/core/world/levelTypes';
import realBalanceJson from '../../../../src/data/balance.json';
import feinkostJson from '../../../../src/data/levels/feinkost.json';
import testBalanceJson from '../../../fixtures/core/test-balance.json';

// Gemessen wird mit der EINGEFRORENEN Balance (Katze r = 1.0, yRange 0…2.5). Die echte Balance ist
// bis zum Spaß-GATE nach M14 provisorisch; an ihren Zahlen darf kein Test hängen (CLAUDE.md).
// Sie kommt trotzdem vor – aber nur für BEZIEHUNGEN, nie für eine exakte Kantenzahl.
const balance = loadBalance(testBalanceJson);
const realBalance = loadBalance(realBalanceJson);
const feinkost = loadLevel(feinkostJson);

/** Einziger Raum der Handproben, groß genug für jede Punktlage unten. */
const WIDE: LevelRoom = { id: 'r', name: 'r', bounds: { x0: -50, z0: -50, x1: 100, z1: 50 }, cameraMode: 'follow' };

/**
 * `LevelDef` von Hand – genau der Fall, den der Vertrag ausdrücklich zulässt (ein `LevelRuntime`
 * darf aus einem handgebauten Level entstehen). Das Mauseloch liegt bei (200, 200): `generateColliders`
 * erzeugt in JEDEM Level genau einen Stopfen, und der soll keine der Proben unten berühren.
 */
function probeLevel(rooms: readonly LevelRoom[], points: readonly LevelNavPoint[], boxes: readonly LevelBox[] = []): LevelDef {
  return {
    id: 'probe',
    scale: CM_PER_UNIT,
    rooms,
    walls: [],
    shelves: [],
    boxes,
    plants: [],
    lootSpawns: [],
    nav: { points },
    spawns: { mice: [{ x: 0, z: 0 }], cat: { x: 0, z: 0 } },
    mouseHole: { x: 200, z: 200, widthCm: 20, heightCm: 200, thicknessCm: 10, rot: 0 },
  };
}

/** Riegel quer zwischen zwei Punkten auf der x-Achse: Halbmaß 0.5 x 5 um den Ursprung. */
function bar(blocks: number, y0Cm: number, y1Cm: number): LevelBox {
  return { cx: 0, cz: 0, hx: 0.5, hz: 5, rot: 0, y0Cm, y1Cm, blocks, kind: 'crate' };
}

function points(...xz: readonly (readonly [number, number])[]): LevelNavPoint[] {
  const out: LevelNavPoint[] = [];
  for (let i = 0; i < xz.length; i += 1) {
    const entry = xz[i];
    if (entry === undefined) continue;
    out.push({ id: `p${i}`, x: entry[0], z: entry[1] });
  }
  return out;
}

/** Nachbarlisten als gewöhnliche Arrays – `toEqual` vergleicht `readonly` sonst nicht bequem. */
function adjacencyOf(nav: NavGraph): number[][] {
  return nav.adjacency.map((list) => [...list]);
}

function lengthsOf(nav: NavGraph): number[][] {
  return nav.lengths.map((list) => [...list]);
}

/** Jede Kante steht auf beiden Seiten; die Zahl der KANTEN ist deshalb die halbe Summe. */
function edgeCount(nav: NavGraph): number {
  let total = 0;
  for (const list of nav.adjacency) total += list.length;
  return total / 2;
}

function roomsOf(nav: NavGraph): number[] {
  return nav.points.map((point) => point.room);
}

describe('buildLevelRuntime – eine Kante braucht BEIDE Bedingungen', () => {
  it('nah genug und frei: die Kante entsteht', () => {
    const nav = buildLevelRuntime(probeLevel([WIDE], points([-3, 0], [3, 0])), balance).nav;
    expect(adjacencyOf(nav)).toEqual([[1], [0]]);
    expect(lengthsOf(nav)).toEqual([[6], [6]]);
  });

  it('zu weit (20 > NAV_MAX_EDGE): keine Kante, obwohl der Weg frei ist', () => {
    const nav = buildLevelRuntime(probeLevel([WIDE], points([-10, 0], [10, 0])), balance).nav;
    expect(adjacencyOf(nav)).toEqual([[], []]);
    expect(edgeCount(nav)).toBe(0);
  });

  it('nah genug, aber ein CAT-Riegel dazwischen: keine Kante', () => {
    const level = probeLevel([WIDE], points([-3, 0], [3, 0]), [bar(CAT, 0, 100)]);
    expect(adjacencyOf(buildLevelRuntime(level, balance).nav)).toEqual([[], []]);
  });

  it('derselbe Riegel, der nur die MAUS aufhält: die Kante entsteht wieder', () => {
    // Der Sweep fragt mit der Maske CAT – ein Kollider ohne CAT-Bit ist für den Graphen unsichtbar.
    const level = probeLevel([WIDE], points([-3, 0], [3, 0]), [bar(MOUSE, 0, 100)]);
    expect(adjacencyOf(buildLevelRuntime(level, balance).nav)).toEqual([[1], [0]]);
  });

  it('derselbe CAT-Riegel ÜBER dem Höhenband der Katze: die Kante entsteht wieder', () => {
    // Katze 0…2.5 Einheiten, Riegel 30…40 – kein überlappendes Band, also keine Wirkung.
    const level = probeLevel([WIDE], points([-3, 0], [3, 0]), [bar(CAT, 300, 400)]);
    expect(adjacencyOf(buildLevelRuntime(level, balance).nav)).toEqual([[1], [0]]);
  });

  it('maxEdge 0 und ein maxEdge von NaN liefern keine Kanten', () => {
    // Die Abstandsprüfung steht bewusst VERNEINT (`!(dist2 <= maxEdge2)`): mit der direkten Form
    // ließe ein NaN-maxEdge JEDES Paar durch, statt keines.
    const level = probeLevel([WIDE], points([-3, 0], [3, 0]));
    expect(edgeCount(buildLevelRuntime(level, balance, 0).nav)).toBe(0);
    expect(edgeCount(buildLevelRuntime(level, balance, Number.NaN).nav)).toBe(0);
  });
});

describe('buildLevelRuntime – Nachbarn, Längen, Raum', () => {
  // Fünf Punkte auf der x-Achse, ABSICHTLICH in verwürfelter Reihenfolge (0, 30, 10, 20, 5):
  // eine nach Raumlage sortierte Nachbarliste sähe hier anders aus als eine nach INDEX sortierte.
  const scrambled = probeLevel([WIDE], points([0, 0], [30, 0], [10, 0], [20, 0], [5, 0]));

  it('die Nachbarn stehen aufsteigend nach Index – ohne Sortierschritt', () => {
    const nav = buildLevelRuntime(scrambled, balance).nav;
    expect(adjacencyOf(nav)).toEqual([[2, 4], [3], [0, 3, 4], [1, 2], [0, 2]]);
    for (const list of nav.adjacency) {
      for (let k = 1; k < list.length; k += 1) expect(list[k - 1]).toBeLessThan(list[k] ?? -1);
    }
  });

  it('lengths steht Feld für Feld zu adjacency – nicht nach Länge sortiert', () => {
    const nav = buildLevelRuntime(scrambled, balance).nav;
    expect(lengthsOf(nav)).toEqual([[10, 5], [10], [10, 10, 5], [10, 10], [5, 5]]);
    for (let i = 0; i < nav.points.length; i += 1) {
      const a = nav.points[i];
      const list = nav.adjacency[i] ?? [];
      const lens = nav.lengths[i] ?? [];
      expect(lens).toHaveLength(list.length);
      for (let k = 0; k < list.length; k += 1) {
        const b = nav.points[list[k] ?? -1];
        if (a === undefined || b === undefined) throw new Error('Punkt fehlt');
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        expect(lens[k]).toBeCloseTo(Math.sqrt(dx * dx + dz * dz), 12);
      }
    }
  });

  it('room kommt aus den HALBOFFENEN Grenzen: x1/z1 gehören nicht mehr dazu', () => {
    const left: LevelRoom = { id: 'links', name: 'links', bounds: { x0: -10, z0: -10, x1: 0, z1: 10 }, cameraMode: 'follow' };
    const right: LevelRoom = { id: 'rechts', name: 'rechts', bounds: { x0: 0, z0: -10, x1: 10, z1: 10 }, cameraMode: 'diorama' };
    const nav = buildLevelRuntime(
      probeLevel([left, right], points([-5, 0], [0, 0], [5, 0], [10, 0], [5, 10], [-10, -10])),
      balance,
    ).nav;
    // p1 liegt auf x = 0: für den linken Raum ist das x1 (draußen), für den rechten x0 (drinnen).
    // p3 liegt auf x1 des rechten Raums, p4 auf dessen z1 – beide in KEINEM Raum, also -1.
    // p5 sitzt auf x0/z0 des linken Raums und gehört dazu.
    expect(roomsOf(nav)).toEqual([0, 1, 1, -1, -1, 0]);
  });

  it('ein leerer Graph hat leere Listen und keine Kanten', () => {
    const nav = buildLevelRuntime(probeLevel([WIDE], []), balance).nav;
    expect(nav.points).toEqual([]);
    expect(nav.adjacency).toEqual([]);
    expect(nav.lengths).toEqual([]);
    expect(largestNavComponent(nav)).toBe(0);
  });
});

describe('largestNavComponent', () => {
  it('zählt die größte Insel, nicht alle Punkte', () => {
    // Insel A: 3 Punkte (0/4/8), Insel B: 2 Punkte (60/64) – 52 Einheiten dazwischen.
    const nav = buildLevelRuntime(probeLevel([WIDE], points([0, 0], [4, 0], [8, 0], [60, 0], [64, 0])), balance).nav;
    expect(adjacencyOf(nav)).toEqual([[1, 2], [0, 2], [0, 1], [4], [3]]);
    expect(edgeCount(nav)).toBe(4);
    expect(largestNavComponent(nav)).toBe(3);
  });

  it('ein einzelner Punkt ohne Kante ist eine Komponente der Größe 1', () => {
    const nav = buildLevelRuntime(probeLevel([WIDE], points([0, 0])), balance).nav;
    expect(largestNavComponent(nav)).toBe(1);
  });

  it('0 Punkte ergeben 0', () => {
    expect(largestNavComponent({ points: [], adjacency: [], lengths: [] })).toBe(0);
  });
});

describe('buildLevelRuntime – feinkost', () => {
  const runtime = buildLevelRuntime(feinkost, balance);

  it('liefert Level, Kollider und Graph in einem Stück', () => {
    expect(runtime.level).toBe(feinkost);
    expect(runtime.colliders).toEqual(generateColliders(feinkost));
    expect(runtime.colliders).toHaveLength(39);
    expect(runtime.nav.points).toHaveLength(60);
  });

  it('jeder Wegpunkt hat einen Raum – 54 im Verkaufsraum, 6 im Bau', () => {
    let shop = 0;
    let burrow = 0;
    for (const point of runtime.nav.points) {
      expect(point.room).toBeGreaterThanOrEqual(0);
      if (point.room === 0) shop += 1;
      if (point.room === 1) burrow += 1;
    }
    expect([shop, burrow]).toEqual([54, 6]);
  });

  it('die Kantenlänge L entscheidet über den Zusammenhang (8 / 10 / 12 / 16)', () => {
    const table: [number, number, number][] = [];
    for (const maxEdge of [8, 10, 12, 16]) {
      const nav = buildLevelRuntime(feinkost, balance, maxEdge).nav;
      table.push([maxEdge, edgeCount(nav), largestNavComponent(nav)]);
    }
    // Ab L = 10 liegt der Verkaufsraum in EINER Komponente; gewählt ist trotzdem 12 (siehe die
    // Begründung am Export NAV_MAX_EDGE). Die 6 Punkte des Baus bleiben immer getrennt – die Katze
    // passt nicht durchs Mauseloch, also gibt es dorthin nie eine Kante. Genau deshalb prüft der
    // Validator (T3) den Zusammenhang JE RAUM und nicht global.
    expect(table).toEqual([
      [8, 55, 26],
      [10, 79, 54],
      [12, 91, 54],
      [16, 139, 54],
    ]);
  });

  it('ohne drittes Argument gilt NAV_MAX_EDGE = 12', () => {
    expect(NAV_MAX_EDGE).toBe(12);
    expect(edgeCount(runtime.nav)).toBe(91);
    expect(adjacencyOf(buildLevelRuntime(feinkost, balance, NAV_MAX_EDGE).nav)).toEqual(adjacencyOf(runtime.nav));
  });

  it('mit der ECHTEN Balance bleibt die Beziehung erhalten – ohne dass eine Zahl daran hängt', () => {
    // Keine exakte Kantenzahl gegen `src/data/balance.json`: deren Werte sind provisorisch.
    // Gepinnt wird nur, was für JEDE Balance gilt: ein größeres L nimmt keine Kante weg.
    let previous = -1;
    for (const maxEdge of [8, 10, 12, 16]) {
      const edges = edgeCount(buildLevelRuntime(feinkost, realBalance, maxEdge).nav);
      expect(edges).toBeGreaterThanOrEqual(previous);
      previous = edges;
    }
    expect(buildLevelRuntime(feinkost, realBalance).nav.points).toHaveLength(60);
  });

  it('ist deterministisch: zwei Läufe liefern dieselben Arrays', () => {
    const again = buildLevelRuntime(feinkost, balance);
    expect(again.nav.points).toEqual(runtime.nav.points);
    expect(adjacencyOf(again.nav)).toEqual(adjacencyOf(runtime.nav));
    expect(lengthsOf(again.nav)).toEqual(lengthsOf(runtime.nav));
    expect(again.colliders).toEqual(runtime.colliders);
  });

  it('StepContext bleibt dreifeldrig – der Graph gehört NICHT hinein', () => {
    // D7: der Nav-Graph ist statisch je Level. Im Zustand würde er geklont und gehasht, im
    // StepContext bräuchte ihn vor M7 kein System. Diese Zeile bricht, sobald jemand ihn anhängt.
    const ctx: StepContext = { balance, level: feinkost, colliders: runtime.colliders };
    expect(Object.keys(ctx)).toEqual(['balance', 'level', 'colliders']);
  });
});

describe('buildLevelRuntime – die Balance wirkt nur über Radius und Höhenband', () => {
  it('eine dickere Katze verliert die Kante durch eine Lücke', () => {
    // Zwei Riegel lassen eine Gasse von 2 Einheiten frei. Eine Katze mit r = 1.0 kommt nicht mehr
    // hindurch; mit r = 0.4 schon. Der Riegel-Kasten ist derselbe, nur die Balance wechselt.
    const gap: readonly LevelBox[] = [
      { cx: 0, cz: 4, hx: 0.5, hz: 3, rot: 0, y0Cm: 0, y1Cm: 100, blocks: CAT, kind: 'crate' },
      { cx: 0, cz: -4, hx: 0.5, hz: 3, rot: 0, y0Cm: 0, y1Cm: 100, blocks: CAT, kind: 'crate' },
    ];
    const level = probeLevel([WIDE], points([-3, 0], [3, 0]), gap);
    const slim: Balance = { ...balance, cat: { radius: 0.4, height: 2.5, yRange: { y0: 0, y1: 2.5 } } };
    expect(adjacencyOf(buildLevelRuntime(level, balance).nav)).toEqual([[], []]);
    expect(adjacencyOf(buildLevelRuntime(level, slim).nav)).toEqual([[1], [0]]);
  });
});
