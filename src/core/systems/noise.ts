import type { SystemFn } from '../sim/state';
import { NOISE_RING } from '../sim/state';

/**
 * Quadrat des Tempos, ab dem ein Spieler als „in Bewegung" gilt – dieselbe Schwelle wie die
 * Blickrichtung in playerMove (1e-9), nur quadriert, damit hier die Wurzel entfällt.
 */
const MOVING_EPSILON_SQ = 1e-18;

/**
 * Legt je aktivem, sich bewegendem Spieler EINE Probe in den Ringpuffer, aus dem die
 * Katzenwahrnehmung (M7) später liest. Laute Proben gehen zusätzlich als Ereignis an den
 * Aufrufer – der leise Rest steht nur im Puffer.
 *
 * Der Ring hat feste Größe (NOISE_RING): `noiseHead` zeigt auf den nächsten Schreibplatz,
 * `noiseCount` sagt, wie viele Plätze schon gefüllt sind. Es wird überschrieben, nicht angehängt –
 * innerhalb eines Ticks wächst kein Array.
 */
export const noise: SystemFn = (state, ctx, inputs, out) => {
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    if (p === undefined || !p.active) continue;
    if (p.vel.x * p.vel.x + p.vel.z * p.vel.z <= MOVING_EPSILON_SQ) continue;

    const sample = state.noise[state.noiseHead];
    if (sample === undefined) continue;
    sample.tick = state.tick;
    sample.slot = p.slot;
    sample.x = p.pos.x;
    sample.z = p.pos.z;
    sample.loudness = p.loudness;
    state.noiseHead = (state.noiseHead + 1) % NOISE_RING;
    if (state.noiseCount < NOISE_RING) state.noiseCount += 1;

    if (p.loudness >= ctx.balance.noiseEventMinLoudness) {
      out.push({ kind: 'noise', tick: state.tick, slot: p.slot, x: p.pos.x, z: p.pos.z, loudness: p.loudness });
    }
  }
};
