import { describe, expect, it } from 'vitest';

import type { SystemFn } from '../../../../src/core/sim/state';
import { catBrain } from '../../../../src/core/systems/catBrain';
import { catMove } from '../../../../src/core/systems/catMove';
import { catPerception } from '../../../../src/core/systems/catPerception';
import { catchSystem } from '../../../../src/core/systems/catch';
import { colony } from '../../../../src/core/systems/colony';
import { interaction } from '../../../../src/core/systems/interaction';
import { frame, makeWorld } from '../testWorld';

/**
 * Die sechs Stümpfe existieren, damit Reihenfolge, Zustandsfelder und die Naht `SystemFn` jetzt
 * entstehen (Kopf-Abweichung 9). Ein Stumpf, der die Katze „irgendwie" bewegte, würde jeden
 * Golden-Hash festschreiben, den M7 sofort wieder umwirft – deshalb sind sie LEER, nicht minimal.
 */
const STUBS: readonly { readonly name: string; readonly run: SystemFn }[] = [
  { name: 'interaction', run: interaction },
  { name: 'catPerception', run: catPerception },
  { name: 'catBrain', run: catBrain },
  { name: 'catMove', run: catMove },
  { name: 'catch', run: catchSystem },
  { name: 'colony', run: colony },
];

describe('eingehängte Stümpfe', () => {
  it('sind genau sechs und alle Funktionen', () => {
    expect(STUBS).toHaveLength(6);
    for (const s of STUBS) expect(typeof s.run).toBe('function');
  });

  for (const stub of STUBS) {
    it(`${stub.name} lässt den gesamten Zustand unverändert`, () => {
      const w = makeWorld();
      const before = JSON.stringify(w.state);
      stub.run(w.state, w.ctx, [frame(0, 127, 127, 3)], w.events);
      expect(JSON.stringify(w.state)).toBe(before);
      expect(w.events).toHaveLength(0);
    });

    it(`${stub.name} lässt Katze und Beute unangetastet`, () => {
      const w = makeWorld();
      const cat = JSON.stringify(w.state.cat);
      stub.run(w.state, w.ctx, [], w.events);
      expect(JSON.stringify(w.state.cat)).toBe(cat);
      expect(w.state.cat.state).toBe('sleeping');
      expect(w.state.loot).toEqual([]);
    });
  }
});
