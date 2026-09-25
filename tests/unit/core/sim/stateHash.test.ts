import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { NaNError } from '../../../../src/core/math/hash';
import { hashState } from '../../../../src/core/sim/hash';
import { NOISE_RING, NO_ROOM, createInitialState } from '../../../../src/core/sim/state';
import type { CatState, PlayerIntent, WorldState } from '../../../../src/core/sim/state';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import balanceJson from '../../../fixtures/core/test-balance.json';
import levelJson from '../../../fixtures/core/mini-level.json';
import { at } from '../testWorld';

const level = loadLevel(levelJson);
const balance = loadBalance(balanceJson);

/**
 * Generischer Blattfinder für Minor 3 (Task-4-Review): läuft JEDEN Zustand ab und sammelt jedes
 * primitive Feld mit dem Pfad, den `hash.ts` selbst dafür schreiben würde (`players[0].pos.x`,
 * `cat.awareness[2]`, `noise[63].loudness`, …). Seit dem Abschluss-Review (determinism m-2) sammelt
 * er auch `boolean`- und `string`-Blätter: die gehen durch `hashBool`/`hashStr`/`hashEnum` statt
 * durch `hashF64` und lösen deshalb keinen `NaNError` aus – ein neues Feld dieser Art wäre sonst
 * vom Übersetzer nur in `cloneState` erzwungen worden, nicht in `hashState`, und kein Test hätte es
 * gemerkt. Dieser Test darf `Object.keys` benutzen (CLAUDE.md: nur `src/core` ist eingeschränkt) –
 * `hash.ts` selbst tut das nie.
 */
type LeafKind = 'number' | 'boolean' | 'string';
interface Leaf { path: string; segments: readonly (string | number)[]; kind: LeafKind }

function collectLeaves(
  node: unknown, path: string, segments: readonly (string | number)[], leaves: Leaf[],
): void {
  if (typeof node === 'number') { leaves.push({ path, segments, kind: 'number' }); return; }
  if (typeof node === 'boolean') { leaves.push({ path, segments, kind: 'boolean' }); return; }
  if (typeof node === 'string') { leaves.push({ path, segments, kind: 'string' }); return; }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      collectLeaves(node[i], `${path}[${i}]`, [...segments, i], leaves);
    }
    return;
  }
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      collectLeaves(obj[key], childPath, [...segments, key], leaves);
    }
  }
  // null und undefined: kein Blatt für diesen Test.
}

/** Liest GENAU das Blatt, das `collectLeaves` an diesem Pfad gefunden hat. */
function readAtPath(root: WorldState, segments: readonly (string | number)[]): unknown {
  let node: unknown = root;
  for (const seg of segments) {
    node = typeof seg === 'number' ? (node as unknown[])[seg] : (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** Setzt GENAU das Blatt, das `collectLeaves` an diesem Pfad gefunden hat, auf `value`. */
function setAtPath(root: WorldState, segments: readonly (string | number)[],
  value: number | boolean | string): void {
  let node: unknown = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    if (seg === undefined) throw new Error('Pfadsegment fehlt');
    node = typeof seg === 'number' ? (node as unknown[])[seg] : (node as Record<string, unknown>)[seg];
  }
  const last = segments[segments.length - 1];
  if (last === undefined) throw new Error('leerer Pfad');
  if (typeof last === 'number') (node as unknown[])[last] = value;
  else (node as Record<string, unknown>)[last] = value;
}

/**
 * Als Hex vergleichen – wie `tests/node/golden.test.ts`: der Fehlerbericht zeigt dann den Hash und
 * nicht eine nackte Dezimalzahl, die niemand einer Fixture zuordnen kann.
 */
function hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Dieselbe Erinnerung wie der `HINT` in `golden.test.ts`, hier für die Zähl-Zusicherung: die Zahl
 * ist kein Selbstzweck, sie zwingt zum Mitziehen von `hash.ts`.
 */
const TABELLEN_HINT = [
  'Die MUTATIONEN-Tabelle hat eine andere Laenge als erwartet. Wer ein WorldState-Feld hinzufuegt',
  'oder entfernt, zieht DREI Stellen mit: src/core/sim/hash.ts (Hash-Lauf), diese Tabelle und diese',
  'Zahl. Ein neues Feld verschiebt ausserdem jeden Golden-Hash -> `npm run core:rebaseline` und',
  'eine Zeile `Rebaseline: <Grund>` in docs/decisions.md.',
].join('\n');

/** Dieselbe Erinnerung wie der `HINT` in `golden.test.ts` – hier für die gepinnten Hash-Werte. */
const REBASELINE_HINT = [
  'Kodierungsvektor abgewichen. Ursachen: PHASES/CAT_STATES umsortiert, ein Feld im Hash-Lauf',
  'hinzugekommen oder umgestellt, oder die Bytefolge geaendert (FNV, Laengenpraefix).',
  'Das ist eine ABSICHTLICHE Rebaseline wie beim Golden-Test: neue Werte nur MIT Grund im Commit,',
  'plus eine Zeile `Rebaseline: <Grund>` in docs/decisions.md. Nie stillschweigend ersetzen.',
].join('\n');

function fresh(): WorldState {
  const state = createInitialState(level, balance, 'hash');
  // Ein paar Felder vom Anfangswert wegbewegen, damit die Mutationen unten etwas verändern, das
  // vorher nicht schon null war.
  state.loot = [{ id: 1, kind: 2, pos: { x: 3, z: 4 }, carriedBy: -1 }];
  at(state.noise, 7).tick = 5;
  at(state.noise, 7).loudness = 0.5;
  return state;
}

const BASIS = hashState(fresh());

describe('hashState – Form und Stabilität', () => {
  it('liefert eine vorzeichenlose 32-Bit-Zahl', () => {
    expect(Number.isInteger(BASIS)).toBe(true);
    expect(BASIS).toBeGreaterThanOrEqual(0);
    expect(BASIS).toBeLessThanOrEqual(4294967295);
  });

  it('ist rein: zweimal derselbe Zustand, zweimal derselbe Wert', () => {
    const state = fresh();
    expect(hashState(state)).toBe(hashState(state));
  });

  it('ist über zwei unabhängige Läufe stabil', () => {
    expect(hashState(fresh())).toBe(hashState(fresh()));
    expect(hashState(fresh())).toBe(BASIS);
  });

  it('unterscheidet zwei Saaten', () => {
    const a = createInitialState(level, balance, 'saat-a');
    const b = createInitialState(level, balance, 'saat-b');
    expect(hashState(a)).not.toBe(hashState(b));
  });
});

describe('hashState – jede einzelne Feldänderung ändern den Wert', () => {
  const MUTATIONEN: readonly { name: string; mutate: (s: WorldState) => void }[] = [
    { name: 'version', mutate: (s) => { s.version = 2; } },
    { name: 'tick', mutate: (s) => { s.tick = 1; } },
    { name: 'rng.a', mutate: (s) => { s.rng.a = s.rng.a + 1; } },
    { name: 'rng.b', mutate: (s) => { s.rng.b = s.rng.b + 1; } },
    { name: 'rng.c', mutate: (s) => { s.rng.c = s.rng.c + 1; } },
    { name: 'rng.d', mutate: (s) => { s.rng.d = s.rng.d + 1; } },
    { name: 'clock.phase', mutate: (s) => { s.clock.phase = 'day'; } },
    { name: 'clock.phaseTick', mutate: (s) => { s.clock.phaseTick = 1; } },
    { name: 'clock.dayCount', mutate: (s) => { s.clock.dayCount = 2; } },
    { name: 'clock.skipVotes[0]', mutate: (s) => { s.clock.skipVotes[0] = true; } },
    { name: 'clock.skipVotes[3]', mutate: (s) => { s.clock.skipVotes[3] = true; } },
    { name: 'players[0].slot', mutate: (s) => { at(s.players, 0).slot = 9; } },
    { name: 'players[0].active', mutate: (s) => { at(s.players, 0).active = false; } },
    { name: 'players[0].pos.x', mutate: (s) => { at(s.players, 0).pos.x += 1; } },
    { name: 'players[0].pos.z', mutate: (s) => { at(s.players, 0).pos.z += 1; } },
    { name: 'players[0].vel.x', mutate: (s) => { at(s.players, 0).vel.x = 0.5; } },
    { name: 'players[0].vel.z', mutate: (s) => { at(s.players, 0).vel.z = 0.5; } },
    { name: 'players[0].facing', mutate: (s) => { at(s.players, 0).facing = 1; } },
    { name: 'players[0].room', mutate: (s) => { at(s.players, 0).room = 0; } },
    { name: 'players[0].weakened', mutate: (s) => { at(s.players, 0).weakened = true; } },
    { name: 'players[0].caught', mutate: (s) => { at(s.players, 0).caught = true; } },
    { name: 'players[0].prevButtons', mutate: (s) => { at(s.players, 0).prevButtons = 1; } },
    { name: 'players[0].sprinting', mutate: (s) => { at(s.players, 0).sprinting = true; } },
    { name: 'players[0].loudness', mutate: (s) => { at(s.players, 0).loudness = 0.25; } },
    { name: 'players[0].intent.moveX', mutate: (s) => { at(s.players, 0).intent.moveX = 1; } },
    { name: 'players[0].intent.moveZ', mutate: (s) => { at(s.players, 0).intent.moveZ = 1; } },
    { name: 'players[0].intent.mag', mutate: (s) => { at(s.players, 0).intent.mag = 1; } },
    { name: 'players[0].intent.sprint', mutate: (s) => { at(s.players, 0).intent.sprint = true; } },
    { name: 'players[0].intent.interact', mutate: (s) => { at(s.players, 0).intent.interact = true; } },
    { name: 'players[3].pos.x (letzter Platz)', mutate: (s) => { at(s.players, 3).pos.x += 1; } },
    { name: 'players (ein Platz weniger)', mutate: (s) => { s.players.pop(); } },
    { name: 'cat.pos.x', mutate: (s) => { s.cat.pos.x += 1; } },
    { name: 'cat.pos.z', mutate: (s) => { s.cat.pos.z += 1; } },
    { name: 'cat.facing', mutate: (s) => { s.cat.facing = 1; } },
    { name: 'cat.state', mutate: (s) => { s.cat.state = 'patrol'; } },
    { name: 'cat.stateTick', mutate: (s) => { s.cat.stateTick = 1; } },
    { name: 'cat.awareness[2]', mutate: (s) => { s.cat.awareness[2] = 0.5; } },
    { name: 'cat.awareness (ein Eintrag weniger)', mutate: (s) => { s.cat.awareness.pop(); } },
    { name: 'cat.targetSlot', mutate: (s) => { s.cat.targetSlot = 0; } },
    { name: 'rooms[0].id', mutate: (s) => { at(s.rooms, 0).id = 'anders'; } },
    { name: 'rooms[0].playerMask', mutate: (s) => { at(s.rooms, 0).playerMask = 1; } },
    { name: 'rooms (einer mehr)', mutate: (s) => { s.rooms.push({ id: 'neu', playerMask: 0 }); } },
    { name: 'loot[0].id', mutate: (s) => { at(s.loot, 0).id = 2; } },
    { name: 'loot[0].kind', mutate: (s) => { at(s.loot, 0).kind = 3; } },
    { name: 'loot[0].pos.x', mutate: (s) => { at(s.loot, 0).pos.x += 1; } },
    { name: 'loot[0].pos.z', mutate: (s) => { at(s.loot, 0).pos.z += 1; } },
    { name: 'loot[0].carriedBy', mutate: (s) => { at(s.loot, 0).carriedBy = 0; } },
    { name: 'loot (leer)', mutate: (s) => { s.loot = []; } },
    { name: 'noise[7].tick', mutate: (s) => { at(s.noise, 7).tick = 6; } },
    { name: 'noise[7].slot', mutate: (s) => { at(s.noise, 7).slot = 1; } },
    { name: 'noise[7].x', mutate: (s) => { at(s.noise, 7).x = 1; } },
    { name: 'noise[7].z', mutate: (s) => { at(s.noise, 7).z = 1; } },
    { name: 'noise[7].loudness', mutate: (s) => { at(s.noise, 7).loudness = 0.75; } },
    { name: 'noise[63] (letzte Probe)', mutate: (s) => { at(s.noise, NOISE_RING - 1).tick = 0; } },
    { name: 'noise (eine Probe weniger)', mutate: (s) => { s.noise.pop(); } },
    { name: 'noiseHead', mutate: (s) => { s.noiseHead = 1; } },
    { name: 'noiseCount', mutate: (s) => { s.noiseCount = 1; } },
    { name: 'ein ULP in einer Position', mutate: (s) => {
      const p = at(s.players, 0);
      p.pos.x = p.pos.x * (1 + Number.EPSILON);   // benachbarter double, nicht eine andere Zahl
    } },
  ];

  it.each(MUTATIONEN)('$name ändert den Hash', ({ mutate }) => {
    const state = fresh();
    mutate(state);
    expect(hashState(state)).not.toBe(BASIS);
  });

  it('die Tabelle deckt alle Felder ab, die im Zustand stehen', () => {
    // EXAKTE Zahl statt `>=` (Minor 5, Task-4-Review): `>=` schützt nicht vor dem Vergessen – ein
    // neues WorldState-Feld, das weder hier noch in hash.ts landet, bliebe grün. Wer der
    // MUTATIONEN-Tabelle ein WorldState-Feld hinzufügt (oder wegnimmt), muss diese Zahl mitziehen;
    // der generische Blatt-Test unten ("deckt jedes Zahlenfeld ab") fängt ein VERGESSENES Feld
    // zusätzlich automatisch ab, weil er den Zustand zur Laufzeit abläuft statt eine Liste zu tippen.
    expect(MUTATIONEN.length, TABELLEN_HINT).toBe(58);
  });

  it('unterscheidet vertauschte Feldwerte – die Laufordnung ist Teil des Vertrags', () => {
    const a = fresh();
    at(a.players, 0).pos.x = 1;
    at(a.players, 0).pos.z = 2;
    const b = fresh();
    at(b.players, 0).pos.x = 2;
    at(b.players, 0).pos.z = 1;
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('unterscheidet zwei Plätze mit vertauschten Werten', () => {
    const a = fresh();
    at(a.players, 0).loudness = 0.3;
    const b = fresh();
    at(b.players, 1).loudness = 0.3;
    expect(hashState(a)).not.toBe(hashState(b));
  });
});

describe('hashState – Sonderfälle der Zahlen', () => {
  it('hasht -0 wie +0 – sonst hinge der Wert am Vorzeichen einer Null', () => {
    const plus = fresh();
    at(plus.players, 0).pos.x = 0;
    at(plus.players, 0).vel.z = 0;
    const minus = fresh();
    at(minus.players, 0).pos.x = -0;
    at(minus.players, 0).vel.z = -0;
    // Gegenprobe, dass die Werte wirklich verschieden sind:
    expect(Object.is(at(minus.players, 0).pos.x, -0)).toBe(true);
    expect(hashState(minus)).toBe(hashState(plus));
  });

  // Minor 3 (Task-4-Review): die getippte Liste prüfte nur 11 von 398 Pfaden – ein falsch
  // geschriebener Pfad an einer der übrigen Stellen fiel keinem Test auf (Mutant überlebte).
  // Hier läuft der Zustand generisch ab (`collectNumericLeaves`), jedes gefundene Zahlenfeld wird
  // auf einer FRISCHEN Kopie einzeln auf NaN gesetzt, und der gemeldete Pfad wird gegen genau den
  // Pfad geprüft, den der Walker für dasselbe Feld gebildet hat – das deckt automatisch auch ein
  // künftig hinzugefügtes Feld ab, ohne dass jemand die Liste nachpflegen muss.
  const ALLE_BLAETTER = ((): Leaf[] => {
    const leaves: Leaf[] = [];
    collectLeaves(fresh(), '', [], leaves);
    return leaves;
  })();
  const NUMERISCHE_BLAETTER = ALLE_BLAETTER.filter((leaf) => leaf.kind === 'number');
  const ANDERE_BLAETTER = ALLE_BLAETTER.filter((leaf) => leaf.kind !== 'number');

  it('findet mehr als die getippten 11 Zahlenblätter (Wächter gegen einen kaputten Walker)', () => {
    expect(NUMERISCHE_BLAETTER.length).toBeGreaterThan(390);
    expect(ANDERE_BLAETTER.length).toBeGreaterThan(20);
  });

  // EIN Fall mit Schleife statt `it.each` über ~400 Blätter: gleiche Aussage, aber die Zählung von
  // `npm test` bleibt lesbar. Bei einem Fehler nennt die Meldung das erste falsche Blatt.
  it('wirft NaNError mit dem exakten Feldpfad – für jedes Zahlenblatt des Zustands', () => {
    const falsch: string[] = [];
    for (const { path, segments } of NUMERISCHE_BLAETTER) {
      const state = fresh();
      setAtPath(state, segments, Number.NaN);
      let gefangen: unknown = null;
      try {
        hashState(state);
      } catch (error) {
        gefangen = error;
      }
      if (!(gefangen instanceof NaNError) || gefangen.path !== path) {
        falsch.push(`${path} -> ${gefangen instanceof NaNError ? gefangen.path : 'kein NaNError'}`);
      }
    }
    expect(falsch, `Blätter mit falschem/fehlendem NaN-Pfad (${falsch.length}/${NUMERISCHE_BLAETTER.length})`).toEqual([]);
  });

  // determinism m-2 (Abschluss-Review): `boolean`- und `string`-Felder können keinen `NaNError`
  // auslösen, der Test darüber erreicht sie also nicht. Ein neues Feld dieser Art erzwingt der
  // Übersetzer nur in `cloneState` (das Objektliteral muss `WorldState` erfüllen), NICHT in
  // `hashState` – ohne diesen Test bliebe es dort unbemerkt liegen und ein Spielstand könnte ab M17
  // still driften. Wieder EIN Fall mit Schleife statt `it.each`, damit die Zählung lesbar bleibt.
  it('jedes boolean- und string-Blatt geht wirklich in den Hash ein', () => {
    const unbemerkt: string[] = [];
    for (const { path, segments, kind } of ANDERE_BLAETTER) {
      const state = fresh();
      const vorher = readAtPath(state, segments);
      setAtPath(state, segments, kind === 'boolean' ? !(vorher as boolean) : `${String(vorher)}-anders`);
      let neu: number;
      try {
        neu = hashState(state);
      } catch (error) {
        // Aufzählungsfelder (`clock.phase`, `cat.state`) werfen bei einem unbekannten Wert einen
        // RangeError MIT ihrem Feldpfad – auch das beweist, dass `hashState` das Feld liest. Dass
        // die REIHENFOLGE der Aufzählung zählt, pinnt der Kodierungsvektor weiter unten.
        if (error instanceof RangeError && error.message.startsWith(`${path}: `)) continue;
        throw error;
      }
      if (neu === BASIS) unbemerkt.push(`${path} (${kind})`);
    }
    expect(unbemerkt, `Blätter ohne Wirkung auf den Hash (${unbemerkt.length}/${ANDERE_BLAETTER.length})`).toEqual([]);
  });
});

/**
 * Minor 2 (Task-4-Review): die bisherigen Tests prüfen nur, DASS sich der Hash ändert, nie WELCHEN
 * Wert er hat – fünf Mutanten (vertauschte `PHASES`/`CAT_STATES`, Text statt Index, vertauschte
 * Hash-Reihenfolge, ein fehlendes Längenpräfix) überlebten alle 164 T4-Tests. Dieser Block friert
 * `hashState` gegen einen NICHT-trivialen, von Hand gebauten Zustand ein: Tag-Phase mit
 * `phaseTick`/`dayCount` ungleich 0, ein unregelmäßiges `skipVotes`-Muster, verschiedene
 * `cat.awareness`-Werte je Platz, ein gesetzter `targetSlot`, zwei Loot-Einträge, sechs
 * beschriebene Lärmproben mit fortgeschrittenem `noiseHead`/`noiseCount` und vier Spieler mit
 * unterschiedlichem `intent`/`prevButtons`/`sprinting`/`weakened`/`room` – und das für JEDEN der
 * sieben `CAT_STATES`-Werte einzeln, weil nur ein Katzenzustand ungleich dem ersten (`sleeping`)
 * die Reihenfolge der Liste wirklich prüft.
 *
 * WARNUNG: diese sieben Zahlen ändern sich, sobald `PHASES`/`CAT_STATES` umsortiert werden, ein
 * Feld im Hash-Lauf hinzukommt/die Reihenfolge wechselt, oder sich die Kodierung ändert (FNV-Werte,
 * Bytefolge). Eine solche Änderung ist eine ABSICHTLICHE Rebaseline (wie ein Golden-Test) – die
 * neuen Werte gehören dann zusammen mit dem Grund in den Commit, nicht stillschweigend ersetzt.
 */
describe('hashState – Kodierungsvektor (Minor 2, Task-4-Review)', () => {
  const ALLE_KATZENZUSTAENDE: readonly CatState[] =
    ['sleeping', 'patrol', 'alert', 'chase', 'lurk', 'search', 'return'];

  function buildVectorState(catState: CatState): WorldState {
    const state = createInitialState(level, balance, 'vektor');

    state.clock.phase = 'day';
    state.clock.phaseTick = 17;
    state.clock.dayCount = 3;
    state.clock.skipVotes = [true, false, false, true];

    const intents: readonly PlayerIntent[] = [
      { moveX: 0.6, moveZ: 0.8, mag: 1, sprint: true, interact: false },
      { moveX: -0.5, moveZ: 0.2, mag: 0.7, sprint: false, interact: true },
      { moveX: 0, moveZ: -1, mag: 0.4, sprint: false, interact: false },
      { moveX: 0.3, moveZ: -0.3, mag: 0.2, sprint: true, interact: true },
    ];
    const rooms = [0, NO_ROOM, 0, NO_ROOM];
    const prevButtons = [1, 2, 0, 3];
    const sprinting = [true, false, true, false];
    const weakened = [false, true, false, true];
    const loudness = [0.9, 0.1, 0.5, 0.75];
    const facing = [0.1, -1.2, 2.5, -0.4];
    const vel = [{ x: 0.2, z: 0.1 }, { x: -0.1, z: 0.05 }, { x: 0, z: 0 }, { x: 0.15, z: -0.15 }];

    for (let i = 0; i < state.players.length; i += 1) {
      const p = at(state.players, i);
      const intent = at(intents, i);
      p.intent = { moveX: intent.moveX, moveZ: intent.moveZ, mag: intent.mag, sprint: intent.sprint, interact: intent.interact };
      p.room = at(rooms, i);
      p.prevButtons = at(prevButtons, i);
      p.sprinting = at(sprinting, i);
      p.weakened = at(weakened, i);
      p.loudness = at(loudness, i);
      p.facing = at(facing, i);
      p.vel.x = at(vel, i).x;
      p.vel.z = at(vel, i).z;
    }

    state.cat.state = catState;
    state.cat.awareness = [0.1, 0.2, 0.3, 0.4];
    state.cat.targetSlot = 2;

    state.loot = [
      { id: 1, kind: 2, pos: { x: 3, z: 4 }, carriedBy: -1 },
      { id: 5, kind: 1, pos: { x: -2, z: 6 }, carriedBy: 0 },
    ];

    for (let i = 0; i < 6; i += 1) {
      const sample = at(state.noise, i);
      sample.tick = i;
      sample.slot = i % 4;
      sample.x = i * 0.5;
      sample.z = -i * 0.3;
      sample.loudness = 0.1 * i + 0.05;
    }
    state.noiseHead = 6;
    state.noiseCount = 6;

    return state;
  }

  // Einmal gemessen (siehe task-4-5-fix-report.md) und als Literal eingefroren – wie ein
  // Golden-Hash. Ändert sich einer dieser Werte unerwartet, ist das der Kodierungsvektor, der
  // greift: eine Rebaseline gehört dann bewusst und dokumentiert in den Commit, nicht "einfach grün".
  const ERWARTETE_HASHES: Readonly<Record<CatState, number>> = {
    sleeping: 0x3fcb7f66,
    patrol: 0x118775a1,
    alert: 0x1bad962c,
    chase: 0xd495e78f,
    lurk: 0x3cf5a3da,
    search: 0xbde548b5,
    return: 0x66ea37e0,
  };

  it.each(ALLE_KATZENZUSTAENDE.map((catState) => ({ catState })))(
    'pinnt hashState für cat.state = $catState',
    ({ catState }) => {
      expect(hex(hashState(buildVectorState(catState))), REBASELINE_HINT).toBe(hex(ERWARTETE_HASHES[catState]));
    },
  );
});
