import { describe, expect, it } from 'vitest';
import { BUTTON_SPRINT } from '../../../src/core/sim/input';
import { NO_ROOM } from '../../../src/core/sim/state';
import { TICK_MS } from '../../../src/core/sim/tick';
import type { RenderView } from '../../../src/core/sim/views';
import { createKeyboard } from '../../../src/input/keyboard';
import type { FixedLoopClock, FrameStats } from '../../../src/modes/fixedLoop';
import { EVENT_BUFFER_MAX } from '../../../src/modes/session';
import type { SoloSession } from '../../../src/modes/session';
import { createSoloSession } from '../../../src/modes/soloSession';
import type { SoloSessionOptions } from '../../../src/modes/soloSession';
import balanceFixture from '../../fixtures/core/test-balance.json';
import golden from '../../fixtures/core/golden.json';
import levelFixture from '../../fixtures/core/mini-level.json';

/**
 * Kein DOM, keine echte Uhr, kein rAF – die Sitzung bekommt beides injiziert. Geprueft wird gegen
 * die EINGEFRORENEN Fixtures (`mini-level.json`, `test-balance.json`), nie gegen `src/data/**`: deren
 * Zahlen sind bis zum Spass-GATE nach M14 provisorisch.
 */
interface Harness {
  session: SoloSession;
  scheduled: (() => void)[];
  cancelled: number[];
  /** Je Bild ein Eintrag: der `alpha`, mit dem `render` gerufen wurde. */
  alphas: number[];
  /** Je Bild der `view.alpha`, wie er WAEHREND `render` stand. */
  seen: number[];
  frames: FrameStats[];
  setNow(value: number): void;
}

function harness(patch: Partial<SoloSessionOptions> = {}): Harness {
  let now = 0;
  const scheduled: (() => void)[] = [];
  const cancelled: number[] = [];
  const alphas: number[] = [];
  const seen: number[] = [];
  const frames: FrameStats[] = [];
  let nextHandle = 0;
  const clock: FixedLoopClock = {
    now: () => now,
    requestFrame: (run) => { scheduled.push(run); nextHandle += 1; return nextHandle; },
    cancelFrame: (handle) => { cancelled.push(handle); },
  };
  // `render` laeuft immer erst NACH `harness()` (ueber `pump`, `advance` oder einen eingeplanten
  // Frame) – deshalb darf es die Sicht aus diesem Halter lesen.
  const holder: { view?: RenderView } = {};
  const session = createSoloSession({
    levelJson: levelFixture,
    balanceJson: balanceFixture,
    seed: 1,
    keyboard: createKeyboard(),
    clock,
    manual: true,
    render: (alpha) => {
      alphas.push(alpha);
      if (holder.view !== undefined) seen.push(holder.view.alpha);
    },
    onFrame: (stats) => { frames.push(stats); },
    ...patch,
  });
  holder.view = session.view;
  return { session, scheduled, cancelled, alphas, seen, frames, setNow(value) { now = value; } };
}

/** Maus-Spawn aus der Fixture – hergeleitet, nicht abgeschrieben. */
function spawnX(slot: number): number {
  const spawn = levelFixture.spawns.mice[slot];
  if (spawn === undefined) throw new Error(`Spawn ${slot} fehlt`);
  return spawn.x;
}

const goldenCase = golden.cases.find((entry) => entry.name === 'mini-neutral-300');
if (goldenCase === undefined) throw new Error('golden.json: Fall mini-neutral-300 fehlt');

/** Ort eines Platzes aus dem ZUSTAND – ohne optionales Lesen im Test. */
function posOf(session: SoloSession, slot: number): { x: number; z: number } {
  const player = session.state().players[slot];
  if (player === undefined) throw new Error(`Platz ${slot} fehlt`);
  return { x: player.pos.x, z: player.pos.z };
}

describe('soloSession: Aufbau', () => {
  it('laedt Level und Balance aus INJIZIERTEN Daten und baut die Runtime', () => {
    const h = harness();
    // 16 Kollider (4 Waende + 2x5 Regal + 1 Kiste + 1 Stopfen), 3 Wegpunkte, 2 Kanten bei L = 12 –
    // dieselben Zahlen, die `levelRuntime.test.ts` an derselben Fixture pinnt.
    expect(h.session.runtime.colliders).toHaveLength(16);
    expect(h.session.runtime.nav.points).toHaveLength(3);
    expect(h.session.kind).toBe('solo');
    expect(h.session.tick()).toBe(0);
  });

  it('reicht `maxEdge` an `buildLevelRuntime` weiter', () => {
    // Die drei Wegpunkte liegen mit Abstand 10 auf einer Linie: bei L = 12 zwei Kanten, bei L = 8
    // keine. Ohne die Durchreiche stuende hier in beiden Faellen 2.
    const edges = (session: SoloSession): number =>
      session.runtime.nav.adjacency.reduce((sum, list) => sum + list.length, 0) / 2;
    expect(edges(harness().session)).toBe(2);
    expect(edges(harness({ maxEdge: 8 }).session)).toBe(0);
  });

  it('legt ZWEI Schnappschuesse auf den Anfangszustand und einen `slow` dazu', () => {
    const h = harness();
    const view = h.session.view;
    expect(view.prev).not.toBe(view.curr);
    expect(view.prev.tick).toBe(0);
    expect(view.curr.tick).toBe(0);
    expect(view.alpha).toBe(0);
    expect(view.slow.tick).toBe(0);
    // Der Ort der vier Maeuse steht schon im Schnappschuss – vor dem ersten Tick, sonst zeichnete
    // das erste Bild vier Figuren im Ursprung.
    expect(view.curr.values[0]).toBe(posOf(h.session, 0).x);
    expect(view.curr.values[1]).toBe(posOf(h.session, 0).z);
  });

  it('startet bei `manual: true` KEINE Schleife', () => {
    const h = harness();
    expect(h.session.loop.running()).toBe(false);
    expect(h.scheduled).toHaveLength(0);
    expect(h.alphas).toHaveLength(0);
  });

  it('startet ohne `manual` genau ein Bild ueber die injizierte Uhr', () => {
    const h = harness({ manual: undefined });
    expect(h.session.loop.running()).toBe(true);
    expect(h.scheduled).toHaveLength(1);
    // Gezeichnet wird erst im rAF-Rueckruf – `createSoloSession` selbst zeichnet nie.
    expect(h.alphas).toHaveLength(0);
    h.scheduled[0]?.();
    expect(h.alphas).toEqual([0]);
  });

  it('`?seed=` saet den Zustand, und die Saat als ZEICHENKETTE zaehlt gleich', () => {
    const one = harness({ seed: 1 }).session.hash();
    const text = harness({ seed: '1' }).session.hash();
    const other = harness({ seed: 2 }).session.hash();
    expect(text).toBe(one);
    expect(other).not.toBe(one);
  });
});

describe('soloSession: Determinismus', () => {
  it('300 neutrale Ticks liefern den EINGEFRORENEN Golden-Hash `mini-neutral-300`', () => {
    // Zwei Wege, eine Zahl: der Golden-Fall entsteht in `scripts/core-rebaseline.mjs` aus
    // Skript-Bots, diese Sitzung aus klebenden Rahmen. Beide Wege muessen denselben Zustand
    // ergeben – sonst schleppt die Sitzung eine eigene Eingabe-Wahrheit mit. Wird die Baseline je
    // neu gesetzt, ist DIESER Fall mitzuziehen.
    const h = harness();
    expect(h.session.advance(300)).toBe(300);
    expect(h.session.hash()).toBe(goldenCase.hash);
  });

  it('zwei Sitzungen mit derselben Saat laufen bitgleich', () => {
    const a = harness().session;
    const b = harness().session;
    a.advance(120);
    b.advance(60);
    b.advance(60);
    expect(b.hash()).toBe(a.hash());
  });

  it('`state()` liefert den lebenden Zustand, `hash()` seinen Hash', () => {
    const h = harness();
    h.session.advance(30);
    expect(h.session.state().tick).toBe(30);
    expect(h.session.tick()).toBe(30);
  });
});

describe('soloSession: klebende Rahmen und Tastatur', () => {
  it('haelt den Rahmen, bis er neu gesetzt wird – die Maus laeuft ueber mehrere Ticks', () => {
    // Verglichen wird auf DEMSELBEN Tick: `hashState` hasht `state.tick` mit, ein Vergleich
    // "Tick 0 gegen Tick 30" waere von der Eingabe voellig unabhaengig.
    const ruhig = harness().session;
    ruhig.advance(30);
    const bewegt = harness().session;
    bewegt.setInput(0, 127, 0, 0);
    bewegt.advance(30);
    expect(bewegt.tick()).toBe(30);
    expect(bewegt.hash()).not.toBe(ruhig.hash());
    expect(posOf(bewegt, 0).x).toBeGreaterThan(posOf(ruhig, 0).x);
  });

  it('gilt fuer ALLE vier Plaetze, nicht nur fuer Platz 0', () => {
    const h = harness();
    for (let slot = 0; slot < 4; slot += 1) h.session.setInput(slot, 127, 0, 0);
    h.session.advance(10);
    for (let slot = 0; slot < 4; slot += 1) {
      expect(posOf(h.session, slot).x, `Platz ${slot}`).toBeGreaterThan(spawnX(slot));
    }
  });

  it('die Tastatur ueberschreibt NUR Platz 0', () => {
    const h = harness();
    for (let slot = 0; slot < 4; slot += 1) h.session.setInput(slot, 127, 0, 0);
    expect(h.session.keyDown('KeyA')).toBe(true);   // nach WESTEN, gegen den klebenden Rahmen
    h.session.advance(10);
    expect(posOf(h.session, 0).x).toBeLessThan(spawnX(0));
    for (let slot = 1; slot < 4; slot += 1) {
      expect(posOf(h.session, slot).x, `Platz ${slot}`).toBeGreaterThan(spawnX(slot));
    }
  });

  it('eine RUHENDE Tastatur wischt `setInput(0, …)` NICHT weg', () => {
    // Genau der Fehler, den `view2d/main.ts` schon kannte: ohne die `keyboard.idle()`-Abfrage legte
    // der Tastatur-Rahmen in JEDEM Tick einen neutralen Rahmen ueber Platz 0, und ein
    // Playwright-Lauf haette nie eine Bewegung gesehen.
    const h = harness();
    h.session.setInput(0, 127, 0, 0);
    h.session.advance(10);
    expect(posOf(h.session, 0).x).toBeGreaterThan(spawnX(0));
  });

  it('`keyUp` gibt die Taste frei und meldet fremde Tasten als fremd', () => {
    const h = harness();
    expect(h.session.keyDown('KeyA')).toBe(true);
    expect(h.session.keyUp('KeyA')).toBe(true);
    expect(h.session.keyDown('KeyQ')).toBe(false);
    expect(h.session.keyUp('KeyQ')).toBe(false);
  });

  it('`resetInput` leert Tastatur UND klebende Rahmen', () => {
    const h = harness();
    for (let slot = 0; slot < 4; slot += 1) h.session.setInput(slot, 127, 0, BUTTON_SPRINT);
    h.session.keyDown('KeyA');
    h.session.resetInput();
    const ruhig = harness().session;
    h.session.advance(30);
    ruhig.advance(30);
    expect(h.session.hash()).toBe(ruhig.hash());
  });

  it('`setInput` wirft bei Werten, die das Drahtformat nicht traegt', () => {
    const h = harness();
    for (const bad of [1.5, Number.NaN, 128, -128, Number.POSITIVE_INFINITY]) {
      expect(() => h.session.setInput(0, bad, 0, 0), `mx ${bad}`).toThrow(RangeError);
      expect(() => h.session.setInput(0, 0, bad, 0), `mz ${bad}`).toThrow(RangeError);
    }
    for (const bad of [1.5, Number.NaN, -1, 256]) {
      expect(() => h.session.setInput(0, 0, 0, bad), `buttons ${bad}`).toThrow(RangeError);
    }
    expect(() => h.session.setInput(0, 127, -127, 255)).not.toThrow();
    expect(() => h.session.setInput(9, 0, 0, 0)).toThrow(RangeError);
  });

  it('`advance` wirft bei nicht ganzzahligen, negativen und absurd grossen Werten', () => {
    const h = harness();
    expect(() => h.session.advance(1.5)).toThrow(RangeError);
    expect(() => h.session.advance(-1)).toThrow(RangeError);
    expect(() => h.session.advance(100001)).toThrow(RangeError);
    expect(h.session.tick()).toBe(0);
  });
});

describe('soloSession: Schnappschuss-Tausch', () => {
  it('tauscht die beiden Objekte statt neue anzulegen', () => {
    const h = harness();
    const a = h.session.view.prev;
    const b = h.session.view.curr;
    h.session.advance(1);
    expect(h.session.view.prev).toBe(b);
    expect(h.session.view.curr).toBe(a);
    h.session.advance(1);
    expect(h.session.view.prev).toBe(a);
    expect(h.session.view.curr).toBe(b);
  });

  it('`curr` traegt den neuen, `prev` den vorherigen Tick', () => {
    const h = harness();
    h.session.advance(5);
    expect(h.session.view.curr.tick).toBe(5);
    expect(h.session.view.prev.tick).toBe(4);
  });

  it('schreibt Ort und Sichtbarkeit jedes Platzes und der Katze', () => {
    const h = harness();
    h.session.setInput(0, 127, 0, 0);
    h.session.advance(10);
    const values = h.session.view.curr.values;
    expect(values[0]).toBe(posOf(h.session, 0).x);
    expect(values[1]).toBe(posOf(h.session, 0).z);
    // Alle vier Plaetze der Fixture sind aktiv und keiner gefangen; die Katze ist immer sichtbar.
    expect([...h.session.view.curr.visible]).toEqual([1, 1, 1, 1, 1]);
  });

  it('`view.alpha` steht schon, wenn `render` laeuft – und nach `advance` auf 1', () => {
    const h = harness();
    h.session.advance(3);
    expect(h.session.view.alpha).toBe(1);
    expect(h.alphas).toEqual([1]);
    expect(h.seen).toEqual([1]);
    h.setNow(TICK_MS * 1.5);
    h.session.loop.pump();
    expect(h.session.view.alpha).toBeCloseTo(0.5, 9);
    expect(h.seen[1]).toBe(h.session.view.alpha);
  });

  it('baut `view.slow` NUR bei gerechneten Ticks neu', () => {
    // Gemessen legt `makeSlowView` sonst je Bild ein Objekt mit vier Unterobjekten an – sechzig Mal
    // je Sekunde fuer einen unveraenderten Inhalt.
    const h = harness();
    const before = h.session.view.slow;
    h.session.loop.pump();                        // 0 Ticks: die gestellte Uhr steht
    expect(h.session.view.slow).toBe(before);
    h.setNow(TICK_MS);
    expect(h.session.loop.pump().steps).toBe(1);
    expect(h.session.view.slow).not.toBe(before);
    expect(h.session.view.slow.tick).toBe(1);
  });

  it('meldet `steps` und `alpha` je Bild an `onFrame`', () => {
    const h = harness();
    h.session.loop.pump();
    h.setNow(TICK_MS * 2);
    h.session.loop.pump();
    expect(h.frames.map((entry) => entry.steps)).toEqual([0, 2]);
  });
});

describe('soloSession: teleport und roomOf', () => {
  it('schreibt `pos`, nullt `vel` und laesst `facing` stehen', () => {
    const h = harness();
    h.session.setInput(0, 127, 0, 0);
    h.session.advance(10);
    const facing = h.session.state().players[0]?.facing;
    h.session.teleport(0, 5, -7);
    const player = h.session.state().players[0];
    expect(player?.pos).toEqual({ x: 5, z: -7 });
    expect(player?.vel).toEqual({ x: 0, z: 0 });
    expect(player?.facing).toBe(facing);
  });

  it('setzt BEIDE Schnappschuesse – die Figur zieht nicht ueber das halbe Level', () => {
    const h = harness();
    h.session.advance(2);
    h.session.teleport(0, 5, -7);
    expect(h.session.view.prev.values[0]).toBe(5);
    expect(h.session.view.curr.values[0]).toBe(5);
    expect(h.session.view.prev.values[1]).toBe(-7);
    expect(h.session.view.curr.values[1]).toBe(-7);
  });

  it('loest den Raum NICHT selbst auf – das tut der naechste Tick', () => {
    const h = harness();
    h.session.advance(1);
    expect(h.session.roomOf(0)).toBe(0);
    // Ausserhalb jedes Raums: `playerMove` traegt es erst im naechsten Tick nach.
    h.session.teleport(0, 500, 500);
    expect(h.session.roomOf(0)).toBe(0);
    h.session.advance(1);
    expect(h.session.roomOf(0)).toBe(NO_ROOM);
  });

  it('`roomOf` ist NO_ROOM, solange kein Tick gelaufen ist', () => {
    expect(harness().session.roomOf(0)).toBe(NO_ROOM);
  });

  it('weist unbekannte Plaetze und unsinnige Koordinaten zurueck', () => {
    const h = harness();
    expect(() => h.session.teleport(9, 0, 0)).toThrow(RangeError);
    expect(() => h.session.roomOf(9)).toThrow(RangeError);
    expect(() => h.session.teleport(0, Number.NaN, 0)).toThrow(RangeError);
    expect(() => h.session.teleport(0, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('soloSession: Ereignispuffer', () => {
  it('ist DASSELBE Array und wird bei jedem Tick-Stapel zuerst geleert', () => {
    const h = harness();
    const buffer = h.session.events;
    h.session.advance(300);
    // 300 neutrale Ticks der Fixture: Phasenwechsel und Tagesbeginn – gemessen sechs Ereignisse.
    expect(buffer.length).toBeGreaterThan(0);
    h.session.advance(1);
    expect(h.session.events).toBe(buffer);
    expect(buffer).toHaveLength(0);
  });

  it('deckelt den Puffer bei EVENT_BUFFER_MAX und zaehlt den Ueberschuss', () => {
    // Vier sprintende Maeuse machen je Tick Laerm: gemessen 360 Ereignisse in 100 Ticks, also 256
    // im Puffer und 104 verworfen. Ohne Deckel legte ein `advance(100000)` im Tor
    // hunderttausend Objekte an, die niemand abholt (M5 liest den Puffer noch nicht).
    const h = harness();
    for (let slot = 0; slot < 4; slot += 1) h.session.setInput(slot, 127, 0, BUTTON_SPRINT);
    h.session.advance(100);
    expect(h.session.events).toHaveLength(EVENT_BUFFER_MAX);
    expect(h.session.droppedEvents()).toBeGreaterThan(0);
  });

  it('`droppedEvents` ist eine LAUFENDE Summe und faellt nie', () => {
    const h = harness();
    for (let slot = 0; slot < 4; slot += 1) h.session.setInput(slot, 127, 0, BUTTON_SPRINT);
    h.session.advance(100);
    const first = h.session.droppedEvents();
    h.session.advance(1);
    expect(h.session.droppedEvents()).toBeGreaterThanOrEqual(first);
  });

  it('bleibt bei 0, solange nichts ueberlaeuft', () => {
    const h = harness();
    h.session.advance(300);
    expect(h.session.droppedEvents()).toBe(0);
  });
});
