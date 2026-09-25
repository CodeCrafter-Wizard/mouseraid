import { describe, expect, it } from 'vitest';
import {
  BOT_PATTERNS, BURST_MAG, BURST_PERIOD, BURST_REST_MAG, BURST_TICKS, CIRCLE_JITTER, CIRCLE_MAG,
  CIRCLE_TICKS, LEG_TICKS, WALL_MAG, scriptedInputs,
} from '../../helpers/scriptedInputs';
import type { BotPattern } from '../../helpers/scriptedInputs';
import { BUTTON_INTERACT, BUTTON_SPRINT } from '../../../src/core/sim/input';

const ALL: BotPattern[] = ['idle', 'walk-circle', 'sprint-bursts', 'wall-hugger'];

describe('Skript-Bots', () => {
  it('kennt genau die vier Muster des Vertrags', () => {
    expect([...BOT_PATTERNS]).toEqual(ALL);
  });

  it('ist rein: derselbe Aufruf liefert zweimal dasselbe', () => {
    for (let tick = 0; tick < 400; tick += 7) {
      expect(scriptedInputs(4711, ALL, tick)).toEqual(scriptedInputs(4711, ALL, tick));
    }
  });

  it('haengt an der Saat: eine andere Saat aendert die Frames', () => {
    // idle ist bewusst saat-unabhaengig, die drei anderen Muster nicht.
    const seeded: BotPattern[] = ['walk-circle', 'sprint-bursts', 'wall-hugger'];
    let differences = 0;
    for (let tick = 0; tick < 400; tick += 1) {
      const a = scriptedInputs(1, seeded, tick);
      const b = scriptedInputs(2, seeded, tick);
      for (let slot = 0; slot < seeded.length; slot += 1) {
        const left = a[slot];
        const right = b[slot];
        if (left !== undefined && right !== undefined && (left.mx !== right.mx || left.mz !== right.mz)) differences += 1;
      }
    }
    expect(differences).toBeGreaterThan(100);
  });

  it('liefert je Platz einen Frame mit tick und seq', () => {
    const frames = scriptedInputs(9, ALL, 517);
    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      expect(frame.tick).toBe(517);
      expect(frame.seq).toBe(517 & 0xff);
    }
  });

  it('haelt mx/mz ganzzahlig in [-127, 127] und buttons in [0, 255]', () => {
    for (let tick = 0; tick < 600; tick += 1) {
      for (const frame of scriptedInputs(20260925, ALL, tick)) {
        expect(Number.isInteger(frame.mx)).toBe(true);
        expect(Number.isInteger(frame.mz)).toBe(true);
        expect(frame.mx).toBeGreaterThanOrEqual(-127);
        expect(frame.mx).toBeLessThanOrEqual(127);
        expect(frame.mz).toBeGreaterThanOrEqual(-127);
        expect(frame.mz).toBeLessThanOrEqual(127);
        expect(frame.buttons).toBeGreaterThanOrEqual(0);
        expect(frame.buttons).toBeLessThanOrEqual(255);
      }
    }
  });

  it('idle bleibt neutral – unabhaengig von Saat und Tick', () => {
    for (const seed of [0, 1, 999]) {
      for (let tick = 0; tick < 200; tick += 13) {
        const frame = scriptedInputs(seed, ['idle'], tick)[0];
        expect(frame).toBeDefined();
        expect(frame?.mx).toBe(0);
        expect(frame?.mz).toBe(0);
        expect(frame?.buttons).toBe(0);
      }
    }
  });

  it('walk-circle dreht die Richtung und haelt die Auslenkung im Zitterband', () => {
    const min = CIRCLE_MAG - CIRCLE_JITTER;
    const max = CIRCLE_MAG + CIRCLE_JITTER;
    for (let tick = 0; tick < CIRCLE_TICKS; tick += 1) {
      const frame = scriptedInputs(77, ['walk-circle'], tick)[0];
      expect(frame).toBeDefined();
      if (frame === undefined) continue;
      const length = Math.sqrt(frame.mx * frame.mx + frame.mz * frame.mz);
      expect(length).toBeGreaterThanOrEqual(min - 1);
      expect(length).toBeLessThanOrEqual(max + 1);
      expect(frame.buttons).toBe(0);
      // Eine halbe Umdrehung spaeter zeigt die Richtung genau entgegengesetzt.
      const opposite = scriptedInputs(77, ['walk-circle'], tick + CIRCLE_TICKS / 2)[0];
      expect(opposite).toBeDefined();
      if (opposite === undefined) continue;
      expect(frame.mx * opposite.mx + frame.mz * opposite.mz).toBeLessThan(0);
    }
  });

  it('sprint-bursts druecken SPRINT genau im Schub und halten die Richtung je Abschnitt', () => {
    for (let tick = 0; tick < 3 * BURST_PERIOD; tick += 1) {
      const frame = scriptedInputs(12345, ['sprint-bursts'], tick)[0];
      const start = Math.floor(tick / BURST_PERIOD) * BURST_PERIOD;
      const first = scriptedInputs(12345, ['sprint-bursts'], start)[0];
      expect(frame).toBeDefined();
      expect(first).toBeDefined();
      if (frame === undefined || first === undefined) continue;
      const sprinting = tick - start < BURST_TICKS;
      expect(frame.buttons).toBe(sprinting ? BUTTON_SPRINT : 0);
      const length = Math.sqrt(frame.mx * frame.mx + frame.mz * frame.mz);
      expect(length).toBeLessThanOrEqual((sprinting ? BURST_MAG : BURST_REST_MAG) + 1);
      expect(length).toBeGreaterThanOrEqual((sprinting ? BURST_MAG : BURST_REST_MAG) - 1);
      // Richtung: im Schub Tick fuer Tick derselbe Frame wie am Abschnittsanfang (exakt), danach
      // dieselbe Halbebene (das Runden auf die kleinere Auslenkung dreht den Winkel leicht).
      if (sprinting) {
        expect(frame.mx).toBe(first.mx);
        expect(frame.mz).toBe(first.mz);
      } else {
        expect(frame.mx * first.mx + frame.mz * first.mz).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('wall-hugger laeuft achsenparallel, wechselt nur am Geradenanfang und drueckt dort INTERACT', () => {
    let changes = 0;
    let previous = '';
    for (let tick = 0; tick < 4 * LEG_TICKS; tick += 1) {
      const frame = scriptedInputs(31337, ['wall-hugger'], tick)[0];
      expect(frame).toBeDefined();
      if (frame === undefined) continue;
      expect(Math.abs(frame.mx) + Math.abs(frame.mz)).toBe(WALL_MAG);
      expect(frame.mx === 0 || frame.mz === 0).toBe(true);
      const legStart = tick % LEG_TICKS === 0;
      expect(frame.buttons).toBe(legStart ? BUTTON_INTERACT : 0);
      const key = `${frame.mx}/${frame.mz}`;
      if (previous !== '' && key !== previous) {
        changes += 1;
        expect(legStart).toBe(true);
      }
      previous = key;
    }
    expect(changes).toBeGreaterThan(0);
  });
});
