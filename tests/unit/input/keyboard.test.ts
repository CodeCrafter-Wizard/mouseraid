import { describe, expect, it } from 'vitest';

import { loadBalance } from '../../../src/core/data/balanceLoad';
import type { Balance } from '../../../src/core/data/balanceTypes';
import type { GameEvent } from '../../../src/core/sim/events';
import { BUTTON_INTERACT, BUTTON_SPRINT, packInput, unpackInput } from '../../../src/core/sim/input';
import type { InputFrame } from '../../../src/core/sim/input';
import { createInitialState } from '../../../src/core/sim/state';
import { playerIntent } from '../../../src/core/systems/playerIntent';
import { generateColliders } from '../../../src/core/world/generateColliders';
import realBalanceJson from '../../../src/data/balance.json';
import {
  KEY_AXIS_SPRINT, KEY_AXIS_SPRINT_DIAG, KEY_AXIS_WALK, KEY_AXIS_WALK_DIAG, createKeyboard,
} from '../../../src/input/keyboard';
import testBalanceJson from '../../fixtures/core/test-balance.json';
import { miniLevel, player } from '../core/testWorld';

/** Tasten der Reihe nach druecken (und gedrueckt lassen), dann den Rahmen lesen. */
function frameAfter(codes: readonly string[], tick = 0, seq = 0): InputFrame {
  const kb = createKeyboard();
  for (const code of codes) expect(kb.onKeyDown(code)).toBe(true);
  return kb.frame(tick, seq);
}

describe('keyboard: Achsenwerte (Vertrag)', () => {
  it('die vier Konstanten stehen fest und die Diagonalen sind floor(gerade/sqrt2)', () => {
    expect(KEY_AXIS_WALK).toBe(112);
    expect(KEY_AXIS_WALK_DIAG).toBe(79);
    expect(KEY_AXIS_SPRINT).toBe(127);
    expect(KEY_AXIS_SPRINT_DIAG).toBe(89);
    // Der Test liegt ausserhalb von src/core und darf Math.* als Referenz benutzen.
    expect(KEY_AXIS_WALK_DIAG).toBe(Math.floor(KEY_AXIS_WALK / Math.SQRT2));
    expect(KEY_AXIS_SPRINT_DIAG).toBe(Math.floor(KEY_AXIS_SPRINT / Math.SQRT2));
  });

  it('kein Betrag ueberschreitet die volle Auslenkung – sonst klemmte playerIntent ihn still ab', () => {
    const walkDiag = (KEY_AXIS_WALK_DIAG * Math.SQRT2) / KEY_AXIS_SPRINT;
    const sprintDiag = (KEY_AXIS_SPRINT_DIAG * Math.SQRT2) / KEY_AXIS_SPRINT;
    expect(walkDiag).toBeLessThanOrEqual(1);
    expect(sprintDiag).toBeLessThanOrEqual(1);
    // Die Diagonale darf auch nicht spuerbar LANGSAMER sein als die Gerade: hoechstens 1 % Abstand.
    expect(Math.abs(walkDiag - KEY_AXIS_WALK / KEY_AXIS_SPRINT)).toBeLessThan(0.01);
    expect(1 - sprintDiag).toBeLessThan(0.01);
  });
});

describe('keyboard: Gehen (ohne Shift)', () => {
  it.each([
    { codes: ['KeyW'], mx: 0, mz: -KEY_AXIS_WALK },
    { codes: ['ArrowUp'], mx: 0, mz: -KEY_AXIS_WALK },
    { codes: ['KeyS'], mx: 0, mz: KEY_AXIS_WALK },
    { codes: ['ArrowDown'], mx: 0, mz: KEY_AXIS_WALK },
    { codes: ['KeyA'], mx: -KEY_AXIS_WALK, mz: 0 },
    { codes: ['ArrowLeft'], mx: -KEY_AXIS_WALK, mz: 0 },
    { codes: ['KeyD'], mx: KEY_AXIS_WALK, mz: 0 },
    { codes: ['ArrowRight'], mx: KEY_AXIS_WALK, mz: 0 },
    { codes: ['KeyW', 'KeyD'], mx: KEY_AXIS_WALK_DIAG, mz: -KEY_AXIS_WALK_DIAG },
    { codes: ['KeyW', 'KeyA'], mx: -KEY_AXIS_WALK_DIAG, mz: -KEY_AXIS_WALK_DIAG },
    { codes: ['KeyS', 'KeyD'], mx: KEY_AXIS_WALK_DIAG, mz: KEY_AXIS_WALK_DIAG },
    { codes: ['KeyS', 'KeyA'], mx: -KEY_AXIS_WALK_DIAG, mz: KEY_AXIS_WALK_DIAG },
    { codes: ['ArrowUp', 'ArrowRight'], mx: KEY_AXIS_WALK_DIAG, mz: -KEY_AXIS_WALK_DIAG },
  ])('$codes ergibt mx $mx, mz $mz', ({ codes, mx, mz }) => {
    const f = frameAfter(codes);
    expect(f.mx).toBe(mx);
    expect(f.mz).toBe(mz);
    expect(f.buttons).toBe(0);
  });

  it('W ist -Z und S ist +Z – die Ansicht ist ein Grundriss mit +Z nach UNTEN', () => {
    expect(frameAfter(['KeyW']).mz).toBeLessThan(0);
    expect(frameAfter(['KeyS']).mz).toBeGreaterThan(0);
    expect(frameAfter(['KeyA']).mx).toBeLessThan(0);
    expect(frameAfter(['KeyD']).mx).toBeGreaterThan(0);
  });

  it('reicht tick und seq unveraendert durch', () => {
    const f = frameAfter(['KeyD'], 4711, 7);
    expect(f.tick).toBe(4711);
    expect(f.seq).toBe(7);
  });

  it('ohne Taste steht der Rahmen auf null', () => {
    const kb = createKeyboard();
    expect(kb.frame(0, 0)).toEqual({ seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0 });
  });

  it('jeder Rahmen passt in das 8-Byte-Drahtformat (mx/mz sind i8)', () => {
    const buffer = new Uint8Array(8);
    for (const codes of [['KeyW'], ['KeyA'], ['KeyW', 'KeyA'], ['ShiftLeft', 'KeyS', 'KeyD']]) {
      const f = frameAfter(codes, 9, 3);
      packInput(f, buffer, 0);
      expect(unpackInput(buffer, 0)).toEqual(f);
    }
  });
});

describe('keyboard: Sprint (Shift gehalten)', () => {
  it.each([
    { codes: ['ShiftLeft', 'KeyW'], mx: 0, mz: -KEY_AXIS_SPRINT },
    { codes: ['ShiftRight', 'KeyD'], mx: KEY_AXIS_SPRINT, mz: 0 },
    { codes: ['ShiftLeft', 'KeyS', 'KeyA'], mx: -KEY_AXIS_SPRINT_DIAG, mz: KEY_AXIS_SPRINT_DIAG },
    { codes: ['ShiftRight', 'ArrowUp', 'ArrowRight'], mx: KEY_AXIS_SPRINT_DIAG, mz: -KEY_AXIS_SPRINT_DIAG },
  ])('$codes ergibt mx $mx, mz $mz mit gesetztem Sprint-Bit', ({ codes, mx, mz }) => {
    const f = frameAfter(codes);
    expect(f.mx).toBe(mx);
    expect(f.mz).toBe(mz);
    expect(f.buttons).toBe(BUTTON_SPRINT);
  });

  it('setzt das Sprint-Bit auch im Stand – Knopf UND Aussenring sind zwei Wege, nicht einer', () => {
    const f = frameAfter(['ShiftLeft']);
    expect(f.mx).toBe(0);
    expect(f.mz).toBe(0);
    expect(f.buttons).toBe(BUTTON_SPRINT);
  });

  it('faellt beim Loslassen von Shift zurueck auf Gehen', () => {
    const kb = createKeyboard();
    kb.onKeyDown('KeyD');
    kb.onKeyDown('ShiftLeft');
    expect(kb.frame(0, 0).mx).toBe(KEY_AXIS_SPRINT);
    kb.onKeyUp('ShiftLeft');
    const f = kb.frame(1, 1);
    expect(f.mx).toBe(KEY_AXIS_WALK);
    expect(f.buttons).toBe(0);
  });
});

describe('keyboard: Gegentasten und doppelt belegte Richtungen', () => {
  it.each([
    { codes: ['KeyW', 'KeyS'], mx: 0, mz: 0 },
    { codes: ['KeyA', 'KeyD'], mx: 0, mz: 0 },
    { codes: ['KeyW', 'ArrowDown'], mx: 0, mz: 0 },
    { codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], mx: 0, mz: 0 },
  ])('$codes heben sich auf', ({ codes, mx, mz }) => {
    const f = frameAfter(codes);
    expect(f.mx).toBe(mx);
    expect(f.mz).toBe(mz);
  });

  it('eine aufgehobene Achse macht den Rahmen NICHT diagonal', () => {
    // W und S heben sich auf, D bleibt: das ist eine gerade Bewegung und nimmt 112, nicht 79.
    expect(frameAfter(['KeyW', 'KeyS', 'KeyD']).mx).toBe(KEY_AXIS_WALK);
    expect(frameAfter(['KeyA', 'KeyD', 'KeyW']).mz).toBe(-KEY_AXIS_WALK);
  });

  it('zwei Tasten derselben Richtung zaehlen einzeln', () => {
    const kb = createKeyboard();
    kb.onKeyDown('KeyW');
    kb.onKeyDown('ArrowUp');
    expect(kb.frame(0, 0).mz).toBe(-KEY_AXIS_WALK);
    kb.onKeyUp('KeyW');
    // Pfeil-hoch ist noch gehalten – wer die zweite Taste loslaesst, bleibt nicht stehen.
    expect(kb.frame(1, 0).mz).toBe(-KEY_AXIS_WALK);
    kb.onKeyUp('ArrowUp');
    expect(kb.frame(2, 0).mz).toBe(0);
  });

  it('liefert bei unveraendertem Tastenbild denselben Ausschlag', () => {
    const kb = createKeyboard();
    kb.onKeyDown('KeyD');
    const a = kb.frame(0, 0);
    const b = kb.frame(1, 1);
    expect([b.mx, b.mz, b.buttons]).toEqual([a.mx, a.mz, a.buttons]);
  });
});

describe('keyboard: Interact wird gerastet', () => {
  it.each(['KeyE', 'Space'])('%s setzt das Bit in GENAU einem Rahmen', (code) => {
    const kb = createKeyboard();
    expect(kb.onKeyDown(code)).toBe(true);
    expect(kb.frame(0, 0).buttons).toBe(BUTTON_INTERACT);
    expect(kb.frame(1, 1).buttons).toBe(0);
  });

  it('haelt einen Druck fest, der zwischen zwei Rahmen beginnt UND endet', () => {
    // Genau dafuer ist die Marke da: 60 Hz Anzeige gegen 30 Hz Simulation.
    const kb = createKeyboard();
    kb.onKeyDown('KeyE');
    kb.onKeyUp('KeyE');
    expect(kb.frame(0, 0).buttons).toBe(BUTTON_INTERACT);
    expect(kb.frame(1, 1).buttons).toBe(0);
  });

  it('loest bei Autowiederholung nicht erneut aus, bei einem echten zweiten Druck schon', () => {
    const kb = createKeyboard();
    kb.onKeyDown('KeyE');
    expect(kb.frame(0, 0).buttons).toBe(BUTTON_INTERACT);
    kb.onKeyDown('KeyE'); // Wiederholung des Systems: kein keyup dazwischen
    expect(kb.frame(1, 0).buttons).toBe(0);
    kb.onKeyUp('KeyE');
    kb.onKeyDown('KeyE'); // echter zweiter Druck
    expect(kb.frame(2, 0).buttons).toBe(BUTTON_INTERACT);
  });

  it('fasst zwei Druecke zwischen denselben zwei Rahmen zu einem zusammen', () => {
    // Bewusst so: die Marke ist ein Wahrheitswert, kein Zaehler. Ein zweiter Druck innerhalb
    // derselben 33 ms ist kein zweiter Wille, und ein Zaehler brauchte eine Obergrenze.
    const kb = createKeyboard();
    kb.onKeyDown('KeyE');
    kb.onKeyUp('KeyE');
    kb.onKeyDown('Space');
    kb.onKeyUp('Space');
    expect(kb.frame(0, 0).buttons).toBe(BUTTON_INTERACT);
    expect(kb.frame(1, 0).buttons).toBe(0);
  });

  it('traegt Sprint- und Interact-Bit gemeinsam', () => {
    const kb = createKeyboard();
    kb.onKeyDown('ShiftLeft');
    kb.onKeyDown('KeyE');
    expect(kb.frame(0, 0).buttons).toBe(BUTTON_SPRINT | BUTTON_INTERACT);
    expect(kb.frame(1, 0).buttons).toBe(BUTTON_SPRINT);
  });
});

describe('keyboard: idle und fremde Tasten', () => {
  it('meldet den Ruhezustand, solange nichts gedrueckt und keine Marke offen ist', () => {
    const kb = createKeyboard();
    expect(kb.idle()).toBe(true);
    kb.onKeyDown('KeyW');
    expect(kb.idle()).toBe(false);
    kb.onKeyUp('KeyW');
    expect(kb.idle()).toBe(true);
  });

  it('bleibt nach einem losgelassenen E so lange nicht ruhig, bis der Rahmen die Marke abholt', () => {
    // Sonst wischte `__mb.setInput` in einem Playwright-Lauf die Interact-Flanke weg (T5).
    const kb = createKeyboard();
    kb.onKeyDown('KeyE');
    kb.onKeyUp('KeyE');
    expect(kb.idle()).toBe(false);
    kb.frame(0, 0);
    expect(kb.idle()).toBe(true);
  });

  it.each(['KeyZ', 'Tab', 'F5', 'Escape', 'Enter', 'keyw', ''])('%s gehoert uns nicht', (code) => {
    const kb = createKeyboard();
    expect(kb.onKeyDown(code)).toBe(false);
    expect(kb.onKeyUp(code)).toBe(false);
    expect(kb.idle()).toBe(true);
    expect(kb.frame(0, 0)).toEqual({ seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0 });
  });

  it('ein keyup ohne keydown ist harmlos', () => {
    const kb = createKeyboard();
    expect(kb.onKeyUp('KeyW')).toBe(true);
    expect(kb.idle()).toBe(true);
    expect(kb.frame(0, 0).mz).toBe(0);
  });

  it('zwei Tastaturen teilen keinen Zustand', () => {
    const a = createKeyboard();
    const b = createKeyboard();
    a.onKeyDown('KeyD');
    expect(a.frame(0, 0).mx).toBe(KEY_AXIS_WALK);
    expect(b.frame(0, 0).mx).toBe(0);
    expect(b.idle()).toBe(true);
  });
});

// Aussenring-Gegenprobe: NICHT die Zahlen der Balance werden gepinnt, sondern die BEZIEHUNG
// „Gehen bleibt unter dem Aussenring, Shift kommt darueber" – und zwar gegen BEIDE Balance-Dateien.
// Bei voller Auslenkung (127/127 = 1) waere `sprint` ueber den Ring immer wahr; genau deshalb geht
// die Tastatur mit 112/79 (Entscheidung 11).

const BALANCES: [string, Balance][] = [
  ['test-balance.json (eingefroren)', loadBalance(testBalanceJson)],
  ['src/data/balance.json (provisorisch)', loadBalance(realBalanceJson)],
];

interface Intent { mag: number; sprint: boolean; interact: boolean }

/**
 * Eine Buehne mit EINEM Zustand. Aufeinanderfolgende Rahmen sehen damit dieselbe `prevButtons`-
 * Historie – nur so ist die Interact-FLANKE ueberhaupt pruefbar (ein frischer Zustand je Rahmen
 * haette immer prevButtons 0 und jede Flanke waere trivial wahr).
 */
function probe(balance: Balance): (f: InputFrame) => Intent {
  const level = miniLevel();
  const state = createInitialState(level, balance, 'T4');
  const ctx = { balance, level, colliders: generateColliders(level) };
  const events: GameEvent[] = [];
  return (f: InputFrame): Intent => {
    playerIntent(state, ctx, [f], events);
    const p = player(state, 0);
    return { mag: p.intent.mag, sprint: p.intent.sprint, interact: p.intent.interact };
  };
}

/** Ein einzelner Rahmen auf einer frischen Buehne. */
function intentOf(balance: Balance, f: InputFrame): Intent {
  return probe(balance)(f);
}

const WALK_DIRECTIONS: { codes: string[] }[] = [
  { codes: ['KeyW'] }, { codes: ['KeyA'] }, { codes: ['KeyS'] }, { codes: ['KeyD'] },
  { codes: ['KeyW', 'KeyA'] }, { codes: ['KeyW', 'KeyD'] },
  { codes: ['KeyS', 'KeyA'] }, { codes: ['KeyS', 'KeyD'] },
];

describe.each(BALANCES)('keyboard gegen playerIntent mit %s', (_name, balance) => {
  it.each(WALK_DIRECTIONS)('Gehen mit $codes sprintet NICHT', ({ codes }) => {
    const { mag, sprint } = intentOf(balance, frameAfter(codes));
    expect(sprint).toBe(false);
    expect(mag).toBeLessThan(balance.mouse.sprintRingMag);
    // ... und ist trotzdem eine echte Bewegung, keine Totzone.
    expect(mag).toBeGreaterThan(balance.mouse.deadZone);
  });

  it.each(WALK_DIRECTIONS)('Shift + $codes sprintet', ({ codes }) => {
    const { mag, sprint } = intentOf(balance, frameAfter(['ShiftLeft', ...codes]));
    expect(sprint).toBe(true);
    expect(mag).toBeGreaterThanOrEqual(balance.mouse.sprintRingMag);
  });

  it('Shift im Stand sprintet ueber den KNOPF, nicht ueber den Ring', () => {
    const { mag, sprint, interact } = intentOf(balance, frameAfter(['ShiftLeft']));
    expect(mag).toBe(0);
    expect(sprint).toBe(true);
    expect(interact).toBe(false);
  });

  it('E loest die Interact-Flanke genau einmal aus – auf EINEM Zustand geprueft', () => {
    const kb = createKeyboard();
    const run = probe(balance);
    kb.onKeyDown('KeyE');
    expect(run(kb.frame(0, 0)).interact).toBe(true);
    // Die Taste ist noch gehalten; die Marke ist aber abgeholt, also faellt das Bit und mit ihm die Flanke.
    expect(run(kb.frame(1, 0)).interact).toBe(false);
    kb.onKeyUp('KeyE');
    kb.onKeyDown('KeyE');
    expect(run(kb.frame(2, 0)).interact).toBe(true);
  });

  it('volle Auslenkung WUERDE ueber den Ring sprinten – der Grund fuer 112 statt 127', () => {
    const full = { seq: 0, tick: 0, mx: KEY_AXIS_SPRINT, mz: 0, buttons: 0 };
    expect(intentOf(balance, full).sprint).toBe(true);
    expect(intentOf(balance, frameAfter(['KeyD'])).sprint).toBe(false);
  });
});
