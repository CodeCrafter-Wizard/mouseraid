import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { hashState } from '../../../../src/core/sim/hash';
import { MAX_PLAYERS, createInitialState } from '../../../../src/core/sim/state';
import type { WorldState } from '../../../../src/core/sim/state';
import type { RenderView } from '../../../../src/core/sim/views';
import {
  SNAPSHOT_ACTORS, SNAPSHOT_CAT, SNAPSHOT_STRIDE, createSnapshot, makeSlowView, snapshotFast,
} from '../../../../src/core/sim/views';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import balanceJson from '../../../fixtures/core/test-balance.json';
import levelJson from '../../../fixtures/core/mini-level.json';
import { at } from '../testWorld';

const level = loadLevel(levelJson);
const balance = loadBalance(balanceJson);

function stateFuerAnzeige(): WorldState {
  const state = createInitialState(level, balance, 'anzeige');
  state.tick = 900;
  state.clock.phase = 'day';
  state.clock.phaseTick = 120;
  state.clock.dayCount = 4;
  state.clock.skipVotes[2] = true;
  at(state.players, 1).weakened = true;
  at(state.players, 1).loudness = 0.42;
  at(state.players, 2).caught = true;
  at(state.players, 2).room = 0;
  at(state.players, 3).active = false;
  state.cat.state = 'search';
  state.cat.awareness = [0.1, 0.2, 0.3, 0.4];
  return state;
}

describe('makeSlowView', () => {
  it('nimmt genau die Felder auf, die eine Anzeige ein paar Mal je Sekunde braucht', () => {
    const view = makeSlowView(stateFuerAnzeige());
    expect(view).toEqual({
      tick: 900,
      phase: 'day',
      phaseTick: 120,
      dayCount: 4,
      skipVotes: [false, false, true, false],
      players: [
        { slot: 0, active: true, weakened: false, caught: false, room: -1, loudness: 0 },
        { slot: 1, active: true, weakened: true, caught: false, room: -1, loudness: 0.42 },
        { slot: 2, active: true, weakened: false, caught: true, room: 0, loudness: 0 },
        { slot: 3, active: false, weakened: false, caught: false, room: -1, loudness: 0 },
      ],
      catState: 'search',
      awareness: [0.1, 0.2, 0.3, 0.4],
    });
  });

  it('führt auch inaktive Plätze auf – die Anzeige zeigt vier Plätze, nicht drei', () => {
    expect(makeSlowView(stateFuerAnzeige()).players).toHaveLength(MAX_PLAYERS);
  });

  it('ist rein: der Zustand bleibt unverändert', () => {
    const state = stateFuerAnzeige();
    const vorher = hashState(state);
    makeSlowView(state);
    expect(hashState(state)).toBe(vorher);
  });

  it('liefert bei jedem Aufruf ein NEUES Objekt mit gleichem Inhalt', () => {
    const state = stateFuerAnzeige();
    const a = makeSlowView(state);
    const b = makeSlowView(state);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.players).not.toBe(b.players);
    expect(at(a.players, 0)).not.toBe(at(b.players, 0));
    expect(a.skipVotes).not.toBe(b.skipVotes);
    expect(a.awareness).not.toBe(b.awareness);
  });

  it('teilt keine Arrays mit dem Zustand', () => {
    const state = stateFuerAnzeige();
    const view = makeSlowView(state);
    expect(view.skipVotes).not.toBe(state.clock.skipVotes);
    expect(view.awareness).not.toBe(state.cat.awareness);

    view.skipVotes[0] = true;
    view.awareness[0] = 99;
    at(view.players, 0).loudness = 99;
    expect(state.clock.skipVotes[0]).toBe(false);
    expect(state.cat.awareness[0]).toBe(0.1);
    expect(at(state.players, 0).loudness).toBe(0);
  });

  it('folgt dem Zustand, wenn dieser sich ändert', () => {
    const state = stateFuerAnzeige();
    const vorher = makeSlowView(state);
    state.tick = 901;
    at(state.players, 0).loudness = 0.9;
    const nachher = makeSlowView(state);
    expect(vorher.tick).toBe(900);
    expect(nachher.tick).toBe(901);
    expect(at(nachher.players, 0).loudness).toBe(0.9);
  });

  it('RenderView traegt ab M5 ZWEI Schnappschuesse – gebaut wird er von soloSession', () => {
    // Kostet nichts und faengt eine spaetere Feldumbenennung schon im Typecheck: ohne diese Zeile
    // pruefte kein Test `RenderView` an irgendeiner Stelle. In M3 standen hier zwei `WorldState`.
    const state = stateFuerAnzeige();
    const view: RenderView = {
      prev: snapshotFast(state, createSnapshot()),
      curr: snapshotFast(state, createSnapshot()),
      alpha: 0.5,
      slow: makeSlowView(state),
    };
    expect(view.alpha).toBe(0.5);
    expect(view.prev).not.toBe(view.curr);
    expect(view.prev.tick).toBe(900);
    expect(view.slow.tick).toBe(900);
  });
});

describe('snapshotFast', () => {
  it('legt Arrays in voller Laenge an und meldet sich als nie beschrieben', () => {
    const snapshot = createSnapshot();
    expect(snapshot.tick).toBe(-1);
    expect(snapshot.values).toHaveLength(SNAPSHOT_ACTORS * SNAPSHOT_STRIDE);
    expect(snapshot.visible).toHaveLength(SNAPSHOT_ACTORS);
    expect(SNAPSHOT_ACTORS).toBe(MAX_PLAYERS + 1);
    expect(SNAPSHOT_CAT).toBe(MAX_PLAYERS);
  });

  it('schreibt Ort und Blickrichtung jedes Platzes an SEINEN Index', () => {
    const state = stateFuerAnzeige();
    at(state.players, 0).pos.x = 1.5;
    at(state.players, 0).pos.z = -2.5;
    at(state.players, 0).facing = 0.25;
    at(state.players, 3).pos.x = -7;
    at(state.players, 3).pos.z = 8;
    at(state.players, 3).facing = -1.75;
    state.cat.pos.x = 11;
    state.cat.pos.z = 12;
    state.cat.facing = 3;

    const snapshot = snapshotFast(state, createSnapshot());
    expect([...snapshot.values.slice(0, SNAPSHOT_STRIDE)]).toEqual([1.5, -2.5, 0.25]);
    expect([...snapshot.values.slice(3 * SNAPSHOT_STRIDE, 4 * SNAPSHOT_STRIDE)]).toEqual([-7, 8, -1.75]);
    expect([...snapshot.values.slice(SNAPSHOT_CAT * SNAPSHOT_STRIDE)]).toEqual([11, 12, 3]);
    expect(snapshot.tick).toBe(900);
  });

  it('sichtbar ist, wer AKTIV und NICHT gefangen ist; die Katze immer', () => {
    // `stateFuerAnzeige` hat Platz 2 gefangen und Platz 3 inaktiv – beide Gruende fuehren zum
    // selben Bild (Mesh aus), und genau deshalb tragen sie dieselbe Zahl.
    const snapshot = snapshotFast(stateFuerAnzeige(), createSnapshot());
    expect([...snapshot.visible]).toEqual([1, 1, 0, 0, 1]);
  });

  it('gibt `out` zurueck und allokiert bei wiederholtem Aufruf NICHTS', () => {
    // Das ist der ganze Sinn der Typed Arrays: `soloSession` tauscht zwei Schnappschuesse je Tick,
    // und ab dem zweiten Aufruf entsteht kein Objekt mehr.
    const state = stateFuerAnzeige();
    const snapshot = createSnapshot();
    const values = snapshot.values;
    const visible = snapshot.visible;
    expect(snapshotFast(state, snapshot)).toBe(snapshot);
    state.tick = 901;
    at(state.players, 0).pos.x = 42;
    const again = snapshotFast(state, snapshot);
    expect(again).toBe(snapshot);
    expect(again.values).toBe(values);
    expect(again.visible).toBe(visible);
    expect(again.values[0]).toBe(42);
    expect(again.tick).toBe(901);
  });

  it('ist rein: der Zustand bleibt unveraendert', () => {
    const state = stateFuerAnzeige();
    const vorher = hashState(state);
    snapshotFast(state, createSnapshot());
    expect(hashState(state)).toBe(vorher);
  });
});
