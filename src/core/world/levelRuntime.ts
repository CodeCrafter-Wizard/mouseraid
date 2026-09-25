import type { Balance } from '../data/balanceTypes';
import { CAT } from './colliderTypes';
import type { Collider } from './colliderTypes';
import { sweepCircle } from './collision';
import { generateColliders } from './generateColliders';
import type { LevelDef } from './levelTypes';

/**
 * Längste erlaubte Nav-Kante in EINHEITEN. Gemessen an `feinkost` (60 Punkte, gebaut gegen die
 * eingefrorene `test-balance.json`): L = 8 -> 55 Kanten, größte Komponente im `verkaufsraum` 26/54;
 * L = 10 -> 79 / 54; L = 12 -> 91 / 54; L = 16 -> 139 / 54.
 *
 * Ab L = 10 liegt jeder Raum in EINER Komponente. Gewählt ist trotzdem 12: die 12 Einheiten tragen
 * gegenüber 10 nur 12 Kanten mehr (+15 %), geben aber jeder Gasse eine zweite Verbindung – eine
 * verschobene Regalreihe zerfällt damit nicht sofort in zwei Komponenten. Bei L = 16 wächst der
 * Graph um die Hälfte, ohne eine Komponente zu gewinnen, und die Kantenzahl fängt an, je Balance zu
 * schwanken (138 gegen 139).
 */
export const NAV_MAX_EDGE = 12;

/**
 * Ein Wegpunkt MIT aufgelöstem Raum. `room` ist der Index in `level.rooms`, aus den HALBOFFENEN
 * Grenzen bestimmt – dieselbe Regel, mit der `playerMove` zur Laufzeit einen Raum zuordnet und
 * mit der `loadLevel` „liegt in keinem Raum" prüft. Ohne dieses Feld wäre die Validator-Regel
 * `unerreichbar` („ein Wegpunkt DESSELBEN Raums") nicht formulierbar.
 */
export interface NavPoint { id: string; x: number; z: number; room: number }

export interface NavGraph {
  points: readonly NavPoint[];
  /** Je Punkt die Nachbar-INDIZES, AUFSTEIGEND sortiert (Gleichstands-Tiebreak des A* aus M7). */
  adjacency: readonly (readonly number[])[];
  /** `lengths[i][k]` ist die vorgerechnete Länge der Kante `adjacency[i][k]`. */
  lengths: readonly (readonly number[])[];
}

export interface LevelRuntime { level: LevelDef; colliders: readonly Collider[]; nav: NavGraph }

/**
 * Kein Raum gefunden. Bewusst NICHT `NO_ROOM` aus `src/core/sim/state.ts` importiert: `src/core/world`
 * kennt die Simulation nicht (nur umgekehrt), und ein Import in diese Richtung zöge `sim/state` in jedes
 * Bundle, das nur den Nav-Graphen braucht. Der WERT ist derselbe – wer ihn dort ändert, ändert ihn hier mit.
 */
const NO_ROOM = -1;

/** Index des Raums, in dem der Punkt liegt, sonst NO_ROOM. Grenzen halboffen: [x0,x1) × [z0,z1). */
function roomAt(level: LevelDef, x: number, z: number): number {
  for (let i = 0; i < level.rooms.length; i += 1) {
    const bounds = level.rooms[i]?.bounds;
    if (bounds === undefined) continue;
    if (x >= bounds.x0 && x < bounds.x1 && z >= bounds.z0 && z < bounds.z1) return i;
  }
  return NO_ROOM;
}

/**
 * Kollider und Nav-Graph in EINEM Schritt – das Ergebnis ist statisch je Level und gehört deshalb
 * weder in den `WorldState` (er würde geklont und gehasht) noch in den `StepContext` (kein System
 * liest den Graphen vor M7).
 *
 * Eine Kante entsteht für jedes Punktpaar, dessen Abstand höchstens `maxEdge` ist UND dessen
 * Katzen-Sweep frei ist (`sweepCircle` mit `balance.cat.radius` und `balance.cat.yRange` gegen die
 * CAT-blockenden Kollider). Beide Bedingungen zusammen: ein für die Katze zu enger Durchgang erzeugt
 * keine Kante, und genau daran erkennt `validateLevel` ihn (Regel `nav-getrennt`).
 *
 * Kosten n*(n-1)/2 Sweeps, gemessen ~0,13 µs je Sweep (Faktenblatt §6): 60 Punkte sind 1 770 Paare
 * und kosten im Mittel ein Zehntel einer Millisekunde – beim Laden gratis, auch mit dem 4–8-fachen
 * Handy-Faktor.
 *
 * Die innere Schleife läuft AUFSTEIGEND über `j`, und jede Kante wird sofort auf beiden Seiten
 * eingetragen. Damit sind die Nachbarlisten per KONSTRUKTION aufsteigend: `adjacency[j]` bekommt
 * alle Nachbarn `i < j` in den früheren Außenschritten (aufsteigend), danach alle `k > j` im
 * eigenen Außenschritt (ebenfalls aufsteigend). Es wird nie sortiert.
 *
 * `maxEdge` ist ein vorbelegter Parameter und keine feste Konstante, damit ein Test die Wahl
 * `NAV_MAX_EDGE` zeigen kann, statt sie zu behaupten.
 */
export function buildLevelRuntime(level: LevelDef, balance: Balance, maxEdge: number = NAV_MAX_EDGE): LevelRuntime {
  const colliders = generateColliders(level);
  const points: NavPoint[] = [];
  for (const point of level.nav.points) {
    points.push({ id: point.id, x: point.x, z: point.z, room: roomAt(level, point.x, point.z) });
  }

  const adjacency: number[][] = [];
  const lengths: number[][] = [];
  for (let i = 0; i < points.length; i += 1) {
    adjacency.push([]);
    lengths.push([]);
  }

  const maxEdge2 = maxEdge * maxEdge;
  const radius = balance.cat.radius;
  const yRange = balance.cat.yRange;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    if (a === undefined) continue;
    const adjA = adjacency[i];
    const lenA = lengths[i];
    if (adjA === undefined || lenA === undefined) continue;
    for (let j = i + 1; j < points.length; j += 1) {
      const b = points[j];
      if (b === undefined) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist2 = dx * dx + dz * dz;
      // Bewusst die VERNEINTE Form: mit einem nicht endlichen `maxEdge` ist `dist2 <= maxEdge2`
      // falsch, und der Zweig überspringt das Paar. Die direkte Form (`dist2 > maxEdge2`) wäre bei
      // NaN ebenfalls falsch – und ließe damit JEDES Paar durch.
      if (!(dist2 <= maxEdge2)) continue;
      if (sweepCircle(a, b, radius, yRange, CAT, colliders)) continue;
      const adjB = adjacency[j];
      const lenB = lengths[j];
      if (adjB === undefined || lenB === undefined) continue;
      const length = Math.sqrt(dist2);
      adjA.push(j);
      lenA.push(length);
      adjB.push(i);
      lenB.push(length);
    }
  }

  return { level, colliders, nav: { points, adjacency, lengths } };
}

/**
 * Größte Zusammenhangskomponente des Graphen, in PUNKTEN. Leerer Graph -> 0.
 * BFS über Arrays – kein `Set`, keine `Map`: dieselbe Disziplin wie im Rest des Kerns, damit die
 * Laufreihenfolge allein an den Indizes hängt. Benutzt von `validateLevel` UND vom Nav-Test.
 */
export function largestNavComponent(nav: NavGraph): number {
  const count = nav.points.length;
  const seen: boolean[] = [];
  for (let i = 0; i < count; i += 1) seen.push(false);
  const queue: number[] = [];
  let best = 0;
  for (let start = 0; start < count; start += 1) {
    if (seen[start] === true) continue;
    seen[start] = true;
    queue.length = 0;
    queue.push(start);
    let size = 0;
    // Kopf-Index statt `shift()`: `shift` ist linear, der Index macht die BFS linear in den Kanten.
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      if (node === undefined) continue;
      size += 1;
      const neighbours = nav.adjacency[node];
      if (neighbours === undefined) continue;
      for (let k = 0; k < neighbours.length; k += 1) {
        const next = neighbours[k];
        if (next === undefined || seen[next] === true) continue;
        seen[next] = true;
        queue.push(next);
      }
    }
    if (size > best) best = size;
  }
  return best;
}
