import { cos, sin } from '../math/trig';
import type { Balance } from '../data/balanceTypes';
import { CAT, MOUSE, overlapsY } from './colliderTypes';
import type { Collider, YRange } from './colliderTypes';
import { sweepCircle } from './collision';
import { labelComponents } from './levelRuntime';
import type { LevelRuntime } from './levelRuntime';
import { CM_PER_UNIT, NO_ROOM, roomAt } from './levelTypes';
import type { LevelDef } from './levelTypes';

/**
 * Level-Validator: zwölf Regeln über einem fertig gebauten `LevelRuntime`. REIN, wirft NIE, liest
 * keine Datei – leere Befundliste heißt „in Ordnung".
 *
 * Die Befundtexte sind ENTWICKLER-Rückkanal (dieselbe Ausnahme wie `LevelError`), keine Spiel-UI:
 * sie stehen in einer Testausgabe, nicht auf dem Bildschirm eines Spielers.
 *
 * WARUM kein Flood-Fill (Faktenblatt §7 empfahl einen): die Kette „Spawn/Beuteplatz/Versteck ->
 * freier Maus-Sweep zu einem Wegpunkt DESSELBEN Raums" plus „Mauseloch -> je ein Wegpunkt beider
 * angrenzenden Räume" beweist dieselbe globale Erreichbarkeit, kostet Mikrosekunden statt
 * Millisekunden und zeigt bei einem Fehler die STELLE statt einer Zellenzahl.
 */

export type LevelFindingCode =
  | 'nav-leer'
  | 'nav-getrennt'
  | 'nav-blockiert'
  | 'spawn-blockiert'
  | 'loot-blockiert'
  | 'ausserhalb'
  | 'unerreichbar'
  | 'loch-sperrt-maus'
  | 'loch-laesst-katze'
  | 'versteck-offen'
  | 'regalspalt'
  | 'ueberdeckung';

export interface LevelFinding { code: LevelFindingCode; path: string; message: string }

/**
 * Ist der Kreis an dieser Stelle frei? Ein Sweep der LÄNGE 0 – gemessen: `sweepCollider` greift bei
 * dx = dz = 0 über Fall A (Startlage im Minkowski-Körper -> blockiert) und rechnet in Fall B nichts.
 * `moveCircle` mit Delta 0 taugt NICHT: es fragt laut Vertrag bewusst gar nichts ab.
 *
 * Die Funktion wohnt hier und nicht in `collision.ts`, weil sie in M4 nur der Validator braucht;
 * M7 darf sie umziehen, sobald ein System sie ruft.
 */
export function circleFree(
  x: number, z: number, radius: number, yRange: YRange, mask: number, colliders: readonly Collider[],
): boolean {
  const point = { x, z };
  return !sweepCircle(point, point, radius, yRange, mask, colliders);
}

/** Betrag des Skalarprodukts zweier Richtungen. */
function absDot(ux: number, uz: number, ax: number, az: number): number {
  const d = ux * ax + uz * az;
  return d < 0 ? -d : d;
}

/** Trennt diese Achse die beiden Rechtecke? BERÜHRUNG trennt – deshalb `>=` und nicht `>`. */
function separatedOn(a: Collider, b: Collider, ax: number, az: number): boolean {
  const d = (b.cx - a.cx) * ax + (b.cz - a.cz) * az;
  const dist = d < 0 ? -d : d;
  const ra = a.hx * absDot(a.rc, a.rs, ax, az) + a.hz * absDot(-a.rs, a.rc, ax, az);
  const rb = b.hx * absDot(b.rc, b.rs, ax, az) + b.hz * absDot(-b.rs, b.rc, ax, az);
  return dist >= ra + rb;
}

/**
 * Überdecken sich zwei gedrehte Rechtecke im Grundriss? SAT über die VIER Achsen der beiden
 * Rechtecke; die Höhenbänder spielen hier KEINE Rolle (darum kümmert sich der Aufrufer).
 *
 * Ein reiner Umkreis-Vorfilter wäre zu grob: gemessen meldet er auf dem als sauber bekannten
 * Mini-Level 22 bzw. 14 Paare, der exakte Test 4 und 4 – und mit der Wand-Ausnahme 0 und 0.
 */
export function obbOverlap(a: Collider, b: Collider): boolean {
  if (separatedOn(a, b, a.rc, a.rs)) return false;
  if (separatedOn(a, b, -a.rs, a.rc)) return false;
  if (separatedOn(a, b, b.rc, b.rs)) return false;
  if (separatedOn(a, b, -b.rs, b.rc)) return false;
  return true;
}

/** Wirkt der Kollider auf einen Bewegten mit diesem Höhenband und dieser Maske? */
function affects(collider: Collider, yRange: YRange, mask: number): boolean {
  return (collider.blocks & mask) !== 0 && overlapsY(yRange, collider);
}

/**
 * Feldpfad der QUELLE eines Kolliders. Er hängt allein an der vertraglich festgelegten Reihenfolge
 * Wände -> Regale (je 5) -> Kisten -> Pflanzen -> Mauseloch-Stopfen; ein Einschub an anderer Stelle
 * verschiebt nicht nur diese Pfade, sondern jeden Golden-Hash.
 */
function sourcePath(level: LevelDef, id: number): string {
  const walls = level.walls.length;
  if (id < walls) return `walls[${id}]`;
  let rest = id - walls;
  const shelfColliders = level.shelves.length * 5;
  if (rest < shelfColliders) return `shelves[${Math.floor(rest / 5)}]`;
  rest -= shelfColliders;
  if (rest < level.boxes.length) return `boxes[${rest}]`;
  rest -= level.boxes.length;
  if (rest < level.plants.length) return `plants[${rest}]`;
  return 'mouseHole';
}

/** Gibt es einen freien Maus-Sweep von (x, z) zu einem Wegpunkt des Raums `room`? */
function reachesNav(
  runtime: LevelRuntime, balance: Balance, x: number, z: number, room: number,
): boolean {
  const from = { x, z };
  for (const point of runtime.nav.points) {
    if (point.room !== room) continue;
    if (!sweepCircle(from, point, balance.mouse.radius, balance.mouse.yRange, MOUSE, runtime.colliders)) return true;
  }
  return false;
}

/**
 * Prüft ein Level gegen zwölf Regeln. Die Reihenfolge der Befunde ist die REGEL-Reihenfolge, und
 * innerhalb einer Regel die Definitionsreihenfolge der Quelle – so kann ein Test
 * `expect(codes).toEqual([...])` schreiben.
 *
 * `ausserhalb` ist im Loader schon erfüllt; die Regel bleibt, weil ein `LevelRuntime` auch aus einem
 * VON HAND gebauten `LevelDef` entstehen kann – genau so entstehen die roten Fälle der Tests.
 */
export function validateLevel(runtime: LevelRuntime, balance: Balance): LevelFinding[] {
  const out: LevelFinding[] = [];
  const level = runtime.level;
  const colliders = runtime.colliders;
  const nav = runtime.nav;
  const mouse = balance.mouse;
  const cat = balance.cat;
  const add = (code: LevelFindingCode, path: string, message: string): void => {
    out.push({ code, path, message });
  };

  // 1 – nav-leer
  if (nav.points.length === 0) {
    add('nav-leer', 'nav.points', 'Das Level hat keine Wegpunkte; jedes Level braucht welche.');
  }

  // 2 – nav-getrennt (JE RAUM, nicht global: die Katze passt nicht durchs Mauseloch, also kann es
  //     zwischen Verkaufsraum und Bau nie eine Kante geben).
  const component = labelComponents(nav);
  for (let r = 0; r < level.rooms.length; r += 1) {
    let first: number | undefined;
    let split = false;
    for (let i = 0; i < nav.points.length; i += 1) {
      if (nav.points[i]?.room !== r) continue;
      const label = component[i];
      if (label === undefined) continue;
      if (first === undefined) first = label;
      else if (label !== first) split = true;
    }
    if (split) {
      add('nav-getrennt', `rooms[${r}]`,
        `Raum "${level.rooms[r]?.id ?? ''}": die Wegpunkte liegen in mehr als einer Komponente.`);
    }
  }

  // 3 – nav-blockiert (die Kanten sind per Konstruktion frei, die Punkte selbst nicht)
  for (let i = 0; i < nav.points.length; i += 1) {
    const point = nav.points[i];
    if (point === undefined) continue;
    if (!circleFree(point.x, point.z, cat.radius, cat.yRange, CAT, colliders)) {
      add('nav-blockiert', `nav.points[${i}]`, `Wegpunkt "${point.id}" ist für die Katze nicht frei.`);
    }
  }

  // 4 – spawn-blockiert
  for (let i = 0; i < level.spawns.mice.length; i += 1) {
    const spawn = level.spawns.mice[i];
    if (spawn === undefined) continue;
    if (!circleFree(spawn.x, spawn.z, mouse.radius, mouse.yRange, MOUSE, colliders)) {
      add('spawn-blockiert', `spawns.mice[${i}]`, 'Maus-Spawn ist für die Maus nicht frei.');
    }
  }
  if (!circleFree(level.spawns.cat.x, level.spawns.cat.z, cat.radius, cat.yRange, CAT, colliders)) {
    add('spawn-blockiert', 'spawns.cat', 'Katzen-Spawn ist für die Katze nicht frei.');
  }

  // 5 – loot-blockiert
  for (let i = 0; i < level.lootSpawns.length; i += 1) {
    const loot = level.lootSpawns[i];
    if (loot === undefined) continue;
    if (!circleFree(loot.x, loot.z, mouse.radius, mouse.yRange, MOUSE, colliders)) {
      add('loot-blockiert', `lootSpawns[${i}]`, `Beuteplatz "${loot.id}" ist für die Maus nicht frei.`);
    }
  }

  // 6 – ausserhalb (Pflanze, Beuteplatz, Wegpunkt)
  for (let i = 0; i < level.plants.length; i += 1) {
    const plant = level.plants[i];
    if (plant === undefined) continue;
    if (roomAt(level.rooms, plant.x, plant.z) === NO_ROOM) {
      add('ausserhalb', `plants[${i}]`, `Pflanze "${plant.id}" liegt in keinem Raum.`);
    }
  }
  for (let i = 0; i < level.lootSpawns.length; i += 1) {
    const loot = level.lootSpawns[i];
    if (loot === undefined) continue;
    if (roomAt(level.rooms, loot.x, loot.z) === NO_ROOM) {
      add('ausserhalb', `lootSpawns[${i}]`, `Beuteplatz "${loot.id}" liegt in keinem Raum.`);
    }
  }
  for (let i = 0; i < nav.points.length; i += 1) {
    const point = nav.points[i];
    if (point === undefined || point.room !== NO_ROOM) continue;
    add('ausserhalb', `nav.points[${i}]`, `Wegpunkt "${point.id}" liegt in keinem Raum.`);
  }

  // 7 – unerreichbar (Maus-Spawn, Beuteplatz, Versteck)
  for (let i = 0; i < level.spawns.mice.length; i += 1) {
    const spawn = level.spawns.mice[i];
    if (spawn === undefined) continue;
    const room = roomAt(level.rooms, spawn.x, spawn.z);
    if (room === NO_ROOM || reachesNav(runtime, balance, spawn.x, spawn.z, room)) continue;
    add('unerreichbar', `spawns.mice[${i}]`,
      'Maus-Spawn erreicht keinen Wegpunkt desselben Raums mit einem freien Maus-Sweep.');
  }
  for (let i = 0; i < level.lootSpawns.length; i += 1) {
    const loot = level.lootSpawns[i];
    if (loot === undefined) continue;
    const room = roomAt(level.rooms, loot.x, loot.z);
    if (room === NO_ROOM || reachesNav(runtime, balance, loot.x, loot.z, room)) continue;
    add('unerreichbar', `lootSpawns[${i}]`,
      `Beuteplatz "${loot.id}" erreicht keinen Wegpunkt desselben Raums mit einem freien Maus-Sweep.`);
  }
  for (let i = 0; i < level.plants.length; i += 1) {
    const plant = level.plants[i];
    if (plant === undefined) continue;
    const room = roomAt(level.rooms, plant.x, plant.z);
    if (room === NO_ROOM || reachesNav(runtime, balance, plant.x, plant.z, room)) continue;
    add('unerreichbar', `plants[${i}]`,
      `Versteck "${plant.id}" erreicht keinen Wegpunkt desselben Raums mit einem freien Maus-Sweep.`);
  }

  // 8/9 – das Mauseloch. Geprüft wird der STOPFEN, nicht die lichte Weite: ein Sweep der Länge 0
  //       am Loch muss für die Maus frei und für die Katze blockiert sein – geometrisch statt als
  //       Zahlenvergleich (Q5), denn nur so stimmt die Probe für JEDE Balance. GEMESSENE Grenze
  //       (U3): der Stopfen deckt das Loch in jeder Weite ab, `widthCm` 2 und `widthCm` 120 bleiben
  //       deshalb befundfrei, und die Wandlücke NEBEN dem Stopfen prüft niemand (`ueberdeckung`
  //       fängt nur den Stopfen IN einer Wand). Dass die Maus wirklich durch die Wand kommt,
  //       verantwortet bis M16 (Portal) der Level-Autor.
  const hole = level.mouseHole;
  if (!circleFree(hole.x, hole.z, mouse.radius, mouse.yRange, MOUSE, colliders)) {
    add('loch-sperrt-maus', 'mouseHole', 'Die Maus kommt nicht durch das Mauseloch.');
  } else {
    // Die beiden angrenzenden Räume ergeben sich aus den Punkten `hole +- Normale(rot) * (halbe
    // Dicke + Mausradius)`. Der Sweep startet trotzdem AM LOCH: der Stopfen hält die Maus nicht auf.
    const reach = hole.thicknessCm / 2 / CM_PER_UNIT + mouse.radius;
    const nx = -sin(hole.rot) * reach;
    const nz = cos(hole.rot) * reach;
    // `undefined` heißt „noch keinen Raum gesehen". Ein zweiter Zahlenwert dafür wäre eine zweite
    // Bedeutung von „kein Raum" neben NO_ROOM – beim Lesen die häufigste Verwechslung.
    let previousRoom: number | undefined;
    for (const side of [1, -1]) {
      const room = roomAt(level.rooms, hole.x + nx * side, hole.z + nz * side);
      if (room === NO_ROOM || room === previousRoom) continue;
      previousRoom = room;
      if (reachesNav(runtime, balance, hole.x, hole.z, room)) continue;
      add('loch-sperrt-maus', 'mouseHole',
        `Vom Mauseloch führt kein freier Maus-Sweep zu einem Wegpunkt des Raums "${level.rooms[room]?.id ?? ''}".`);
    }
  }
  if (circleFree(hole.x, hole.z, cat.radius, cat.yRange, CAT, colliders)) {
    add('loch-laesst-katze', 'mouseHole', 'Die Katze kommt durch das Mauseloch.');
  }

  // 10 – versteck-offen
  for (let i = 0; i < level.plants.length; i += 1) {
    const plant = level.plants[i];
    if (plant === undefined) continue;
    if (!circleFree(plant.x, plant.z, mouse.radius, mouse.yRange, MOUSE, colliders)) {
      add('versteck-offen', `plants[${i}]`, `Versteck "${plant.id}": die Maus kommt nicht hinein.`);
    } else if (circleFree(plant.x, plant.z, cat.radius, cat.yRange, CAT, colliders)) {
      add('versteck-offen', `plants[${i}]`, `Versteck "${plant.id}": die Katze kommt hinein.`);
    }
  }

  // 11 – regalspalt (aus Level UND Balance)
  for (let i = 0; i < level.shelves.length; i += 1) {
    const shelf = level.shelves[i];
    if (shelf === undefined) continue;
    const gap = shelf.gapCm / CM_PER_UNIT;
    if (mouse.yRange.y1 < gap && gap < cat.yRange.y1) continue;
    add('regalspalt', `shelves[${i}].gapCm`,
      `Der Spalt ${gap} muss über ${mouse.yRange.y1} (Maus) und unter ${cat.yRange.y1} (Katze) liegen.`);
  }

  // 12 – ueberdeckung, JE BEWEGTEN-ART. Ohne diese Einschränkung meldete schon das als sauber
  //      bekannte Mini-Level acht falsche Befunde: jedes Regalbein gegen den Baldachin desselben
  //      Regals – zwei Kollider, die nie DENSELBEN Bewegten aufhalten.
  const wallCount = level.walls.length;
  for (let i = 0; i < colliders.length; i += 1) {
    const a = colliders[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < colliders.length; j += 1) {
      const b = colliders[j];
      if (b === undefined) continue;
      // AUSNAHME: zwei Wände dürfen sich überdecken – das sind die Raumecken. Erkannt an der `id`
      // (nicht an der Array-Stelle): die `id` IST die Erzeugungsreihenfolge, und die Wände stehen
      // vorn. Damit bleibt die Regel auch über einer von Hand zusammengestellten Kolliderliste heil.
      if (a.id < wallCount && b.id < wallCount) continue;
      const bothMouse = affects(a, mouse.yRange, MOUSE) && affects(b, mouse.yRange, MOUSE);
      const bothCat = affects(a, cat.yRange, CAT) && affects(b, cat.yRange, CAT);
      if (!bothMouse && !bothCat) continue;
      if (!obbOverlap(a, b)) continue;
      add('ueberdeckung', `${sourcePath(level, a.id)}~${sourcePath(level, b.id)}`,
        'Zwei für denselben Bewegten wirksame Kollider überdecken sich im Grundriss.');
    }
  }

  return out;
}
