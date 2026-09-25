import { TICK_RATE } from '../sim/tick';
import { CM_PER_UNIT } from '../world/levelTypes';
import type { Balance, CatBalance, MouseBalance } from './balanceTypes';

/**
 * Fehler des Balance-Loaders. `path` ist der FELDPFAD ("mouse.loudness.walk"), damit der
 * Aufrufer nicht die ganze Datei durchsuchen muss. Entwickler-Rückkanal, keine Spiel-UI.
 * Der Wurzelpfad ist der leere String – dann steht in `message` nur der Grund.
 */
export class BalanceError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path === '' ? message : `${path}: ${message}`);
    this.name = 'BalanceError';
    this.path = path;
  }
}

/** Feldpfad zusammensetzen; auf der Wurzel bleibt der Schlüssel allein stehen. */
function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BalanceError(path, 'Objekt erwartet');
  }
  return value as Record<string, unknown>;
}

/** Liest ein Zahlenfeld und schließt NaN und ±Infinity aus – beides darf nie in den Kern. */
function num(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== 'number') throw new BalanceError(join(path, key), 'Zahl erwartet');
  if (!Number.isFinite(value)) throw new BalanceError(join(path, key), 'endliche Zahl erwartet');
  return value;
}

function needPositive(value: number, path: string): void {
  if (!(value > 0)) throw new BalanceError(path, 'muss größer als 0 sein');
}

function needRatio(value: number, path: string): void {
  if (!(value >= 0 && value <= 1)) throw new BalanceError(path, 'muss zwischen 0 und 1 liegen');
}

/** Sekunden -> Ticks. Ein halber Tick wäre nicht darstellbar, deshalb muss es aufgehen. */
function toTicks(seconds: number, path: string, tickRate: number): number {
  needPositive(seconds, path);
  const ticks = seconds * tickRate;
  if (!Number.isInteger(ticks)) throw new BalanceError(path, 'muss ein ganzzahliges Vielfaches eines Ticks ergeben');
  return ticks;
}

function loadMouse(source: Record<string, unknown>, tickRate: number): MouseBalance {
  const radiusCm = num(source, 'radiusCm', 'mouse');
  needPositive(radiusCm, 'mouse.radiusCm');
  const heightCm = num(source, 'heightCm', 'mouse');
  needPositive(heightCm, 'mouse.heightCm');
  const walkCmPerS = num(source, 'walkCmPerS', 'mouse');
  needPositive(walkCmPerS, 'mouse.walkCmPerS');
  const sprintMul = num(source, 'sprintMul', 'mouse');
  if (!(sprintMul >= 1)) throw new BalanceError('mouse.sprintMul', 'muss mindestens 1 sein');
  const accelCmPerS2 = num(source, 'accelCmPerS2', 'mouse');
  needPositive(accelCmPerS2, 'mouse.accelCmPerS2');
  const frictionPerTick = num(source, 'frictionPerTick', 'mouse');
  if (!(frictionPerTick > 0 && frictionPerTick <= 1)) {
    throw new BalanceError('mouse.frictionPerTick', 'muss größer als 0 und höchstens 1 sein');
  }
  const sneakBelowRatio = num(source, 'sneakBelowRatio', 'mouse');
  needRatio(sneakBelowRatio, 'mouse.sneakBelowRatio');
  const weakenedMul = num(source, 'weakenedMul', 'mouse');
  needRatio(weakenedMul, 'mouse.weakenedMul');
  const deadZone = num(source, 'deadZone', 'mouse');
  needRatio(deadZone, 'mouse.deadZone');
  const sprintRingMag = num(source, 'sprintRingMag', 'mouse');
  needRatio(sprintRingMag, 'mouse.sprintRingMag');
  if (!(deadZone < sprintRingMag)) {
    throw new BalanceError('mouse.deadZone', 'muss kleiner als sprintRingMag sein');
  }
  const loudness = asObject(source['loudness'], 'mouse.loudness');
  const loudSneak = num(loudness, 'sneak', 'mouse.loudness');
  needRatio(loudSneak, 'mouse.loudness.sneak');
  const loudWalk = num(loudness, 'walk', 'mouse.loudness');
  needRatio(loudWalk, 'mouse.loudness.walk');
  const loudSprint = num(loudness, 'sprint', 'mouse.loudness');
  needRatio(loudSprint, 'mouse.loudness.sprint');

  // Die fünf Umrechnungen sind Teil des Vertrags und werden von Tests gepinnt:
  //   Länge[u]        = cm      / CM_PER_UNIT
  //   Tempo[u/Tick]   = cm/s    / (CM_PER_UNIT * tickRate)        -> 60 cm/s ergibt 0.2
  //   Beschl.[u/T²]   = cm/s²   / (CM_PER_UNIT * tickRate²)
  //   sneakSpeed      = walkSpeed * sneakBelowRatio
  //   sprintSpeed     = walkSpeed * sprintMul
  const radius = radiusCm / CM_PER_UNIT;
  const height = heightCm / CM_PER_UNIT;
  const walkSpeed = walkCmPerS / (CM_PER_UNIT * tickRate);
  return {
    radius,
    height,
    // Der Körper steht auf dem Boden: y0 = 0. Ob die Maus unter ein Regal passt, entscheidet
    // erst die Abfrage aus diesem Band gegen `shelf.gapCm` – die Balance kennt kein Regal.
    yRange: { y0: 0, y1: height },
    sneakSpeed: walkSpeed * sneakBelowRatio,
    walkSpeed,
    sprintSpeed: walkSpeed * sprintMul,
    accel: accelCmPerS2 / (CM_PER_UNIT * tickRate * tickRate),
    friction: frictionPerTick,
    weakenedMul,
    deadZone,
    sprintRingMag,
    loudSneak,
    loudWalk,
    loudSprint,
  };
}

function loadCat(source: Record<string, unknown>): CatBalance {
  const radiusCm = num(source, 'radiusCm', 'cat');
  needPositive(radiusCm, 'cat.radiusCm');
  const heightCm = num(source, 'heightCm', 'cat');
  needPositive(heightCm, 'cat.heightCm');
  const height = heightCm / CM_PER_UNIT;
  return { radius: radiusCm / CM_PER_UNIT, height, yRange: { y0: 0, y1: height } };
}

/**
 * Prüft Form, Endlichkeit und Bereiche und rechnet EINMAL in Tick-Einheiten um.
 * Nimmt `unknown` entgegen und importiert nie eine JSON-Datei (D12): die Komposition
 * (`import balance from '../data/balance.json'`) passiert außerhalb des Kerns.
 */
export function loadBalance(json: unknown): Balance {
  const root = asObject(json, '');
  const tickRate = num(root, 'tickRate', '');
  if (tickRate !== TICK_RATE) throw new BalanceError('tickRate', `muss ${TICK_RATE} sein`);
  const dayTicks = toTicks(num(root, 'dayLengthS', ''), 'dayLengthS', tickRate);
  const nightTicks = toTicks(num(root, 'nightLengthS', ''), 'nightLengthS', tickRate);
  const noiseEventMinLoudness = num(root, 'noiseEventMinLoudness', '');
  needRatio(noiseEventMinLoudness, 'noiseEventMinLoudness');
  return {
    tickRate,
    dayTicks,
    nightTicks,
    noiseEventMinLoudness,
    mouse: loadMouse(asObject(root['mouse'], 'mouse'), tickRate),
    cat: loadCat(asObject(root['cat'], 'cat')),
  };
}
