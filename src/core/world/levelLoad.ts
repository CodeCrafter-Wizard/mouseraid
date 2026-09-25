import type { Vec2 } from '../math/vec';
import { ALL_MASKS } from './colliderTypes';
import { CM_PER_UNIT } from './levelTypes';
import type {
  BoxKind, CameraMode, LevelBounds, LevelBox, LevelDef, LevelLootSpawn, LevelMouseHole, LevelNav,
  LevelNavPoint, LevelPlant, LevelRoom, LevelShelf, LevelSpawns, LevelWall,
} from './levelTypes';

/**
 * Fehler des Level-Loaders. `path` ist der FELDPFAD ("shelves[1].gapCm").
 * Entwickler-Rückkanal, keine Spiel-UI. Wurzelpfad = leerer String.
 */
export class LevelError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path === '' ? message : `${path}: ${message}`);
    this.name = 'LevelError';
    this.path = path;
  }
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LevelError(path, 'Objekt erwartet');
  }
  return value as Record<string, unknown>;
}

function asArray(source: Record<string, unknown>, key: string, path: string): readonly unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) throw new LevelError(join(path, key), 'Liste erwartet');
  return value as readonly unknown[];
}

/**
 * Eine Liste, die FEHLEN darf (dann leer). Nur so bleibt jedes M3-Level gültig, ohne dass
 * `plants`/`lootSpawns`/`nav` in jede Fixture geschrieben werden müssten. Steht das Feld da, wird
 * es voll geprüft – „optional" heißt nicht „egal".
 */
function optionalArray(source: Record<string, unknown>, key: string, path: string): readonly unknown[] {
  if (source[key] === undefined) return [];
  return asArray(source, key, path);
}

/** Liest ein Zahlenfeld und schließt NaN und ±Infinity aus – beides darf nie in den Kern. */
function num(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== 'number') throw new LevelError(join(path, key), 'Zahl erwartet');
  if (!Number.isFinite(value)) throw new LevelError(join(path, key), 'endliche Zahl erwartet');
  return value;
}

function text(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new LevelError(join(path, key), 'Zeichenkette erwartet');
  if (value.length === 0) throw new LevelError(join(path, key), 'darf nicht leer sein');
  return value;
}

function needPositive(value: number, path: string): void {
  if (!(value > 0)) throw new LevelError(path, 'muss größer als 0 sein');
}

/**
 * Eindeutigkeit über eine lineare Suche in einem Array – dieselbe Disziplin wie bei den Räumen
 * (`loadRooms`) und wie im ganzen Kern: kein `Set`, keine `Map`, nur Arrays.
 */
function needUniqueId(ids: readonly string[], id: string, path: string, message: string): void {
  for (let i = 0; i < ids.length; i += 1) {
    if (ids[i] === id) throw new LevelError(join(path, 'id'), message);
  }
}

function vec2(value: unknown, path: string): Vec2 {
  const source = asObject(value, path);
  return { x: num(source, 'x', path), z: num(source, 'z', path) };
}

function loadBounds(value: unknown, path: string): LevelBounds {
  const source = asObject(value, path);
  const x0 = num(source, 'x0', path);
  const z0 = num(source, 'z0', path);
  const x1 = num(source, 'x1', path);
  const z1 = num(source, 'z1', path);
  // Ergänzung zum Vertrag: ohne diese Prüfung enthielte ein verdrehter Raum keinen einzigen
  // Punkt, und JEDER Spawn schlüge mit „liegt in keinem Raum" fehl – ein irreführender Pfad.
  if (!(x1 > x0)) throw new LevelError(join(path, 'x1'), 'muss größer als x0 sein');
  if (!(z1 > z0)) throw new LevelError(join(path, 'z1'), 'muss größer als z0 sein');
  return { x0, z0, x1, z1 };
}

function loadCameraMode(value: unknown, path: string): CameraMode {
  if (value === 'follow' || value === 'diorama') return value;
  throw new LevelError(path, 'muss "follow" oder "diorama" sein');
}

function loadRooms(raw: readonly unknown[]): LevelRoom[] {
  if (raw.length === 0) throw new LevelError('rooms', 'mindestens ein Raum nötig');
  const rooms: LevelRoom[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `rooms[${i}]`;
    const source = asObject(raw[i], path);
    const id = text(source, 'id', path);
    for (let j = 0; j < rooms.length; j += 1) {
      if (rooms[j]?.id === id) throw new LevelError(join(path, 'id'), 'doppelte Raum-ID');
    }
    rooms.push({
      id,
      name: text(source, 'name', path),
      bounds: loadBounds(source['bounds'], join(path, 'bounds')),
      cameraMode: loadCameraMode(source['cameraMode'], join(path, 'cameraMode')),
    });
  }
  return rooms;
}

function loadWalls(raw: readonly unknown[]): LevelWall[] {
  const walls: LevelWall[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `walls[${i}]`;
    const source = asObject(raw[i], path);
    const x0 = num(source, 'x0', path);
    const z0 = num(source, 'z0', path);
    const x1 = num(source, 'x1', path);
    const z1 = num(source, 'z1', path);
    const heightCm = num(source, 'heightCm', path);
    needPositive(heightCm, join(path, 'heightCm'));
    const thicknessCm = num(source, 'thicknessCm', path);
    needPositive(thicknessCm, join(path, 'thicknessCm'));
    // Ergänzung zum Vertrag: `generateColliders` macht aus der Länge das Halbmaß hx.
    // Eine Wand ohne Länge ergäbe hx = 0 und damit einen Kollider, den `Collider` verbietet.
    const dx = x1 - x0;
    const dz = z1 - z0;
    if (!(dx * dx + dz * dz > 0)) throw new LevelError(path, 'Wand ohne Länge');
    walls.push({ x0, z0, x1, z1, heightCm, thicknessCm });
  }
  return walls;
}

function loadShelves(raw: readonly unknown[]): LevelShelf[] {
  const shelves: LevelShelf[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `shelves[${i}]`;
    const source = asObject(raw[i], path);
    const cx = num(source, 'cx', path);
    const cz = num(source, 'cz', path);
    const hx = num(source, 'hx', path);
    needPositive(hx, join(path, 'hx'));
    const hz = num(source, 'hz', path);
    needPositive(hz, join(path, 'hz'));
    const rot = num(source, 'rot', path);
    const gapCm = num(source, 'gapCm', path);
    needPositive(gapCm, join(path, 'gapCm'));
    const topCm = num(source, 'topCm', path);
    if (!(topCm > gapCm)) throw new LevelError(join(path, 'topCm'), 'muss größer als gapCm sein');
    const legHalfCm = num(source, 'legHalfCm', path);
    needPositive(legHalfCm, join(path, 'legHalfCm'));
    // Ergänzung zum Vertrag: die vier Beine sitzen um legHalf eingerückt in den Ecken.
    // Ab 2*legHalf > hx bzw. > hz überlappen die gegenüberliegenden Beine einander –
    // aus vier Beinen würde ein Klotz, und die Maus käme nirgends mehr durch.
    const legHalf = legHalfCm / CM_PER_UNIT;
    if (legHalf * 2 > hx || legHalf * 2 > hz) {
      throw new LevelError(join(path, 'legHalfCm'), 'Beine überlappen sich: 2*legHalf passt nicht in hx/hz');
    }
    shelves.push({ cx, cz, hx, hz, rot, gapCm, topCm, legHalfCm });
  }
  return shelves;
}

function loadBlocks(source: Record<string, unknown>, path: string): number {
  const value = source['blocks'];
  if (value === undefined) return ALL_MASKS;
  const blocks = num(source, 'blocks', path);
  if (!Number.isInteger(blocks) || blocks < 0) throw new LevelError(join(path, 'blocks'), 'ganze Zahl >= 0 erwartet');
  if ((blocks & ~ALL_MASKS) !== 0) throw new LevelError(join(path, 'blocks'), 'unbekanntes Maskenbit');
  return blocks;
}

/** Fehlende Bauart ist `crate` – so bleibt jede M3-Kiste ohne `kind` gültig. */
function loadBoxKind(source: Record<string, unknown>, path: string): BoxKind {
  const value = source['kind'];
  if (value === undefined) return 'crate';
  if (value === 'crate' || value === 'counter' || value === 'vitrine' || value === 'window') return value;
  throw new LevelError(join(path, 'kind'), 'muss "crate", "counter", "vitrine" oder "window" sein');
}

function loadBoxes(raw: readonly unknown[]): LevelBox[] {
  const boxes: LevelBox[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `boxes[${i}]`;
    const source = asObject(raw[i], path);
    const cx = num(source, 'cx', path);
    const cz = num(source, 'cz', path);
    const hx = num(source, 'hx', path);
    needPositive(hx, join(path, 'hx'));
    const hz = num(source, 'hz', path);
    needPositive(hz, join(path, 'hz'));
    const rot = num(source, 'rot', path);
    const y0Cm = num(source, 'y0Cm', path);
    const y1Cm = num(source, 'y1Cm', path);
    if (!(y1Cm > y0Cm)) throw new LevelError(join(path, 'y1Cm'), 'muss größer als y0Cm sein');
    boxes.push({ cx, cz, hx, hz, rot, y0Cm, y1Cm, blocks: loadBlocks(source, path), kind: loadBoxKind(source, path) });
  }
  return boxes;
}

/**
 * Ergänzung zum Vertrag: Raumgrenzen sind HALBOFFEN, `[x0, x1) × [z0, z1)` – dieselbe Regel,
 * mit der T5 (`playerMove`, Ruling R11) zur Laufzeit den Raum eines Punkts bestimmt. Eine
 * geschlossene Prüfung (`<=`) würde einen Spawn genau auf `x1`/`z1` hier annehmen, obwohl er
 * zur Laufzeit in KEINEM Raum läge – ein vom Loader abgesegneter Spawn, der sofort NO_ROOM
 * meldet.
 */
function insideAnyRoom(point: Vec2, rooms: readonly LevelRoom[]): boolean {
  for (let i = 0; i < rooms.length; i += 1) {
    const bounds = rooms[i]?.bounds;
    if (bounds === undefined) continue;
    if (point.x >= bounds.x0 && point.x < bounds.x1 && point.z >= bounds.z0 && point.z < bounds.z1) return true;
  }
  return false;
}

/**
 * Pflanzen, Beuteplätze und Wegpunkte teilen drei Regeln: eine nicht leere, eindeutige ID, endliche
 * Koordinaten und „liegt in einem Raum" nach derselben HALBOFFENEN Regel wie die Spawns. Das
 * MAUSELOCH bleibt davon ausgenommen – es sitzt per Bauart auf der Grenze.
 */
function loadPlants(raw: readonly unknown[], rooms: readonly LevelRoom[]): LevelPlant[] {
  const plants: LevelPlant[] = [];
  const ids: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `plants[${i}]`;
    const source = asObject(raw[i], path);
    const id = text(source, 'id', path);
    needUniqueId(ids, id, path, 'doppelte Pflanzen-ID');
    const x = num(source, 'x', path);
    const z = num(source, 'z', path);
    const radiusCm = num(source, 'radiusCm', path);
    needPositive(radiusCm, join(path, 'radiusCm'));
    const heightCm = num(source, 'heightCm', path);
    needPositive(heightCm, join(path, 'heightCm'));
    if (!insideAnyRoom({ x, z }, rooms)) throw new LevelError(path, 'liegt in keinem Raum');
    ids.push(id);
    plants.push({ id, x, z, radiusCm, heightCm });
  }
  return plants;
}

function loadLootSpawns(raw: readonly unknown[], rooms: readonly LevelRoom[]): LevelLootSpawn[] {
  const spawns: LevelLootSpawn[] = [];
  const ids: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `lootSpawns[${i}]`;
    const source = asObject(raw[i], path);
    const id = text(source, 'id', path);
    needUniqueId(ids, id, path, 'doppelte Beuteplatz-ID');
    const x = num(source, 'x', path);
    const z = num(source, 'z', path);
    // `table` ist die ID einer Loot-Tabelle (M14). Geprüft wird in M4 NUR, dass sie nicht leer ist:
    // ein Verweis auf eine noch nicht existierende Tabelle ist hier ausdrücklich kein Fehler.
    const table = text(source, 'table', path);
    if (!insideAnyRoom({ x, z }, rooms)) throw new LevelError(path, 'liegt in keinem Raum');
    ids.push(id);
    spawns.push({ id, x, z, table });
  }
  return spawns;
}

function loadNav(value: unknown, rooms: readonly LevelRoom[]): LevelNav {
  if (value === undefined) return { points: [] };
  const source = asObject(value, 'nav');
  const raw = optionalArray(source, 'points', 'nav');
  const points: LevelNavPoint[] = [];
  const ids: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `nav.points[${i}]`;
    const point = asObject(raw[i], path);
    const id = text(point, 'id', path);
    needUniqueId(ids, id, path, 'doppelte Wegpunkt-ID');
    const x = num(point, 'x', path);
    const z = num(point, 'z', path);
    // Jeder Wegpunkt MUSS in einem Raum liegen – nur deshalb darf `NavPoint.room` (T2) nie -1 sein,
    // und nur deshalb ist die Erreichbarkeitsregel „ein Wegpunkt DESSELBEN Raums" (T3) formulierbar.
    if (!insideAnyRoom({ x, z }, rooms)) throw new LevelError(path, 'liegt in keinem Raum');
    ids.push(id);
    points.push({ id, x, z });
  }
  return { points };
}

/**
 * Das Mauseloch mit seinen vier Maßen. Die beiden Maßnamen `heightCm`/`thicknessCm` sind wörtlich
 * die der Wand, damit der Autor sie aus dem Wandsegment abschreibt; dass das Ergebnis stimmt,
 * beweist der Validator (T3). `rot` ist der Gierwinkel der WANDLINIE – ausgeschrieben, nie gesucht.
 */
function loadMouseHole(value: unknown): LevelMouseHole {
  const source = asObject(value, 'mouseHole');
  const x = num(source, 'x', 'mouseHole');
  const z = num(source, 'z', 'mouseHole');
  const widthCm = num(source, 'widthCm', 'mouseHole');
  needPositive(widthCm, 'mouseHole.widthCm');
  const heightCm = num(source, 'heightCm', 'mouseHole');
  needPositive(heightCm, 'mouseHole.heightCm');
  const thicknessCm = num(source, 'thicknessCm', 'mouseHole');
  needPositive(thicknessCm, 'mouseHole.thicknessCm');
  // `num` schließt NaN und ±Infinity bereits aus – ein nicht endliches `rot` ergäbe rc/rs = NaN
  // und damit einen Sperrkörper, den keine Abfrage je trifft.
  const rot = num(source, 'rot', 'mouseHole');
  return { x, z, widthCm, heightCm, thicknessCm, rot };
}

function loadSpawns(value: unknown, rooms: readonly LevelRoom[]): LevelSpawns {
  const source = asObject(value, 'spawns');
  const raw = asArray(source, 'mice', 'spawns');
  if (raw.length === 0) throw new LevelError('spawns.mice', 'mindestens ein Maus-Spawn nötig');
  const mice: Vec2[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const path = `spawns.mice[${i}]`;
    const point = vec2(raw[i], path);
    if (!insideAnyRoom(point, rooms)) throw new LevelError(path, 'liegt in keinem Raum');
    mice.push(point);
  }
  const cat = vec2(source['cat'], 'spawns.cat');
  if (!insideAnyRoom(cat, rooms)) throw new LevelError('spawns.cat', 'liegt in keinem Raum');
  return { mice, cat };
}

/**
 * Prüft Form, Endlichkeit, Bereiche und Verweise und liefert die NORMALISIERTE Form
 * (fehlendes `box.blocks` wird zu ALL_MASKS, fehlendes `box.kind` zu 'crate', fehlende
 * `plants`/`lootSpawns`/`nav` werden leer). REIN und liest keine Datei – der Aufrufer
 * reicht die Ausgabe von `JSON.parse` herein (D12). „Nav-Graph zusammenhängend" prüft der
 * Validator (T3), nicht der Loader.
 * Spawns (Mäuse, Katze), Pflanzen, Beuteplätze und Wegpunkte müssen in einem Raum liegen
 * (`insideAnyRoom`, halboffene Grenzen) – ohne Raum gäbe es später weder eine Raum-Maske noch eine
 * Kamera dafür. Das Mauseloch wird bewusst NICHT gegen die Räume geprüft: ein Portal sitzt in einer
 * Wand, also auf der Grenze (M4-Festlegung, siehe docs/decisions.md).
 */
export function loadLevel(json: unknown): LevelDef {
  const root = asObject(json, '');
  const id = text(root, 'id', '');
  const scale = num(root, 'scale', '');
  if (scale !== CM_PER_UNIT) throw new LevelError('scale', `muss ${CM_PER_UNIT} sein`);
  const rooms = loadRooms(asArray(root, 'rooms', ''));
  return {
    id,
    scale,
    rooms,
    walls: loadWalls(asArray(root, 'walls', '')),
    shelves: loadShelves(asArray(root, 'shelves', '')),
    boxes: loadBoxes(asArray(root, 'boxes', '')),
    plants: loadPlants(optionalArray(root, 'plants', ''), rooms),
    lootSpawns: loadLootSpawns(optionalArray(root, 'lootSpawns', ''), rooms),
    nav: loadNav(root['nav'], rooms),
    spawns: loadSpawns(root['spawns'], rooms),
    mouseHole: loadMouseHole(root['mouseHole']),
  };
}
