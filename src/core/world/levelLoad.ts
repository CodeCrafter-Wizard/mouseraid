import type { Vec2 } from '../math/vec';
import { ALL_MASKS } from './colliderTypes';
import { CM_PER_UNIT } from './levelTypes';
import type { CameraMode, LevelBounds, LevelBox, LevelDef, LevelRoom, LevelShelf, LevelSpawns, LevelWall } from './levelTypes';

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
    boxes.push({ cx, cz, hx, hz, rot, y0Cm, y1Cm, blocks: loadBlocks(source, path) });
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
 * (fehlendes `box.blocks` wird zu ALL_MASKS). REIN und liest keine Datei – der Aufrufer
 * reicht die Ausgabe von `JSON.parse` herein (D12). „Nav-Graph zusammenhängend" gehört zu M4.
 * Spawns (Mäuse, Katze) UND das Mauseloch müssen in einem Raum liegen (`insideAnyRoom`,
 * halboffene Grenzen) – ohne Raum gäbe es später weder eine Raum-Maske noch eine Kamera dafür.
 */
export function loadLevel(json: unknown): LevelDef {
  const root = asObject(json, '');
  const id = text(root, 'id', '');
  const scale = num(root, 'scale', '');
  if (scale !== CM_PER_UNIT) throw new LevelError('scale', `muss ${CM_PER_UNIT} sein`);
  const rooms = loadRooms(asArray(root, 'rooms', ''));
  const mouseHole = vec2(root['mouseHole'], 'mouseHole');
  if (!insideAnyRoom(mouseHole, rooms)) throw new LevelError('mouseHole', 'liegt in keinem Raum');
  return {
    id,
    scale,
    rooms,
    walls: loadWalls(asArray(root, 'walls', '')),
    shelves: loadShelves(asArray(root, 'shelves', '')),
    boxes: loadBoxes(asArray(root, 'boxes', '')),
    spawns: loadSpawns(root['spawns'], rooms),
    mouseHole,
  };
}
