import type { Balance } from '../data/balanceTypes';
import { CAT } from './colliderTypes';
import type { Collider } from './colliderTypes';
import { sweepCircle } from './collision';
import { generateColliders } from './generateColliders';
import { roomAt } from './levelTypes';
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
 * Grenzen bestimmt (`roomAt`) – dieselbe Regel, mit der `playerMove` zur Laufzeit einen Raum
 * zuordnet und mit der `loadLevel` „liegt in keinem Raum" prüft. Ohne dieses Feld wäre die
 * Validator-Regel `unerreichbar` („ein Wegpunkt DESSELBEN Raums") nicht formulierbar.
 *
 * Bei einem GELADENEN Level ist `room` nie `NO_ROOM` (−1) – der Loader verlangt für jeden Wegpunkt
 * einen Raum. Bei einem von HAND gebauten `LevelDef` (der Vertrag lässt das ausdrücklich zu, und
 * genau so entstehen die roten Testfälle) schon: darauf stützt `validateLevel` die Regel `ausserhalb`.
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

/** Noch keiner Komponente zugeordnet – nur innerhalb von `labelComponents` sichtbar. */
const NO_COMPONENT = -1;

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
 * Kosten n*(n-1)/2 Sweeps: `feinkost` hat 60 Punkte, also 1 770 Paare, und der Bau kostet GEMESSEN
 * 0,05 ms im warmen Prozess (Median aus 25 Läufen; ohne Aufwärmen 0,07–0,09 ms) – beim Laden gratis,
 * auch mit dem 4–8-fachen Handy-Faktor. Verfahren und Streuung in `docs/decisions.md`, Abschnitt
 * „Nav-Graph beim Laden". Die ~0,13 µs je Einzelaufruf aus dem Faktenblatt §6 tragen diese Rechnung
 * NICHT (sie ergäben 0,23 ms): dort ist der Aufruf-Aufwand je Sweep mitgemessen, hier laufen 1 770
 * Sweeps in einer Schleife.
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
    points.push({ id: point.id, x: point.x, z: point.z, room: roomAt(level.rooms, point.x, point.z) });
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
 * Komponentennummer JE Wegpunkt, aufsteigend nach dem ersten Punkt jeder Komponente vergeben.
 * BFS über Arrays – kein `Set`, keine `Map`: dieselbe Disziplin wie im Rest des Kerns, damit die
 * Laufreihenfolge allein an den Indizes hängt.
 *
 * Diese EINE BFS ist die Grundlage von beidem: `validateLevel` braucht die Zuordnung je Punkt, weil
 * die Regel `nav-getrennt` JE RAUM prüft (R7), und `largestNavComponent` unten zählt nur noch die
 * Häufigkeiten. Vorher stand dieselbe BFS zweimal im Kern – einmal hier, einmal im Validator.
 */
export function labelComponents(nav: NavGraph): number[] {
  const label: number[] = [];
  for (let i = 0; i < nav.points.length; i += 1) label.push(NO_COMPONENT);
  const queue: number[] = [];
  let next = 0;
  for (let start = 0; start < nav.points.length; start += 1) {
    if (label[start] !== NO_COMPONENT) continue;
    label[start] = next;
    queue.length = 0;
    queue.push(start);
    // Kopf-Index statt `shift()`: `shift` ist linear, der Index macht die BFS linear in den Kanten.
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      if (node === undefined) continue;
      const neighbours = nav.adjacency[node] ?? [];
      for (let k = 0; k < neighbours.length; k += 1) {
        const target = neighbours[k];
        if (target === undefined || label[target] !== NO_COMPONENT) continue;
        label[target] = next;
        queue.push(target);
      }
    }
    next += 1;
  }
  return label;
}

/**
 * Größte Zusammenhangskomponente des Graphen, in PUNKTEN. Leerer Graph -> 0.
 * Benutzt von der Nav-Messung und den Tests (`levelRuntime.test.ts`, die L-Studie 8/10/12/16);
 * `validateLevel` ruft statt dessen `labelComponents`, weil es die Zuordnung je Punkt braucht (R7).
 */
export function largestNavComponent(nav: NavGraph): number {
  const label = labelComponents(nav);
  // Häufigkeit je Komponentennummer. Die Nummern sind 0…n-1 und lückenlos, ein Array genügt.
  const sizes: number[] = [];
  for (let i = 0; i < label.length; i += 1) {
    const component = label[i];
    if (component === undefined) continue;
    while (sizes.length <= component) sizes.push(0);
    sizes[component] = (sizes[component] ?? 0) + 1;
  }
  let best = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    const size = sizes[i] ?? 0;
    if (size > best) best = size;
  }
  return best;
}
