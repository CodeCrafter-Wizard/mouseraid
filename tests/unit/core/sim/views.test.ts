import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { hashState } from '../../../../src/core/sim/hash';
import { MAX_PLAYERS, createInitialState } from '../../../../src/core/sim/state';
import type { WorldState } from '../../../../src/core/sim/state';
import type { RenderView } from '../../../../src/core/sim/views';
import { makeSlowView } from '../../../../src/core/sim/views';
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

  it('RenderView ist in M3 nur ein Typ – gebaut wird er erst von fixedLoop (M5)', () => {
    // Kostet nichts und faengt eine spaetere Feldumbenennung schon im Typecheck: ohne diese Zeile
    // pruefte T4 `RenderView` an keiner Stelle.
    const state = stateFuerAnzeige();
    const view: RenderView = { prev: state, curr: state, alpha: 0.5, slow: makeSlowView(state) };
    expect(view.alpha).toBe(0.5);
    expect(view.prev).toBe(view.curr);
    expect(view.slow.tick).toBe(900);
  });
});
