import { catBrain } from '../systems/catBrain';
import { catMove } from '../systems/catMove';
import { catPerception } from '../systems/catPerception';
import { catchSystem } from '../systems/catch';
import { clock } from '../systems/clock';
import { colony } from '../systems/colony';
import { interaction } from '../systems/interaction';
import { noise } from '../systems/noise';
import { playerIntent } from '../systems/playerIntent';
import { playerMove } from '../systems/playerMove';
import type { GameEvent } from './events';
import type { InputFrame } from './input';
import { neutralInput } from './input';
import type { StepContext, SystemFn, WorldState } from './state';
import { MAX_PLAYERS } from './state';

// Naht für die Client-Vorhersage (Spec Zeile 65): M9 rechnet denselben Bewegungsschritt lokal
// voraus. Der Aufrufer soll dafür NICHT nach src/core/systems greifen müssen.
export type { StepContext } from './state';
export type { MoveModifiers } from '../systems/playerMove';
export { stepPlayerMovement } from '../systems/playerMove';

/** Die Systemreihenfolge der Spec (Zeile 109) – wortwörtlich und unveränderlich. */
export const SYSTEM_ORDER = ['clock', 'playerIntent', 'playerMove', 'interaction', 'noise',
  'catPerception', 'catBrain', 'catMove', 'catch', 'colony'] as const;
/** Name eines Systems. */
export type SystemName = (typeof SYSTEM_ORDER)[number];
/** Ein Eintrag der Systemliste. */
export interface SystemEntry { readonly name: SystemName; readonly run: SystemFn }

/**
 * Die Systeme in genau dieser Reihenfolge. Gepinnt wird über das `name`-Feld, nicht über
 * `Function.name`: `catch` ist ein reserviertes Wort, die Funktion heißt deshalb `catchSystem`.
 */
export const SYSTEMS: readonly SystemEntry[] = [
  { name: 'clock', run: clock },
  { name: 'playerIntent', run: playerIntent },
  { name: 'playerMove', run: playerMove },
  { name: 'interaction', run: interaction },
  { name: 'noise', run: noise },
  { name: 'catPerception', run: catPerception },
  { name: 'catBrain', run: catBrain },
  { name: 'catMove', run: catMove },
  { name: 'catch', run: catchSystem },
  { name: 'colony', run: colony },
];

/**
 * Ein Simulationsschritt – die EINZIGE Stelle, an der der Zustand verändert wird.
 *
 * `inputs` ist nach SLOT indiziert; fehlt ein Slot, gilt `neutralInput(state.tick, 0)`. Die
 * Ergänzung passiert genau hier, damit kein System die Lücke einzeln behandeln muss. Der
 * Tick-Zähler steigt am ENDE (vereinbarte Konvention, R3): so arbeiten alle zehn Systeme auf
 * derselben Tick-Nummer, und ein Ereignis trägt den Tick, in dem es entstanden ist.
 *
 * Ereignisse landen im Puffer des AUFRUFERS (Spec Zeile 65) – der Zustand merkt sie sich nicht.
 */
export function step(state: WorldState, inputs: readonly InputFrame[], ctx: StepContext, out: GameEvent[]): void {
  const frames: InputFrame[] = new Array<InputFrame>(MAX_PLAYERS);
  for (let i = 0; i < MAX_PLAYERS; i += 1) {
    const given = inputs[i];
    frames[i] = given === undefined ? neutralInput(state.tick, 0) : given;
  }
  for (let i = 0; i < SYSTEMS.length; i += 1) {
    const entry = SYSTEMS[i];
    if (entry === undefined) continue;
    entry.run(state, ctx, frames, out);
  }
  state.tick += 1;
}
