import type { SystemFn } from '../sim/state';

/**
 * Tag/Nacht-Uhr. Zählt `phaseTick` hoch und beendet die Phase entweder nach der vollen Dauer
 * (Balance, in Ticks) oder sofort, wenn ALLE aktiven Spieler zum Überspringen gestimmt haben.
 * Das Spiel startet in der Nacht (Beutezug, Game_Design §8.2); `dayCount` steigt deshalb nur beim
 * Wechsel Nacht → Tag. Der 7. Tag ist der Invasionstag (§8.11) – M3 zählt nur.
 *
 * `inputs` bleibt ungenutzt: die Stimmen liegen als `clock.skipVotes` IM Zustand, weil sie über
 * den Tick hinaus gelten (ein Spieler stimmt einmal, nicht in jedem Rahmen neu).
 */
export const clock: SystemFn = (state, ctx, inputs, out) => {
  const c = state.clock;
  c.phaseTick += 1;

  let active = 0;
  let votes = 0;
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    if (p === undefined || !p.active) continue;
    active += 1;
    if (c.skipVotes[i] === true) votes += 1;
  }
  // Ohne aktiven Spieler gibt es keine Mehrheit – sonst überspränge ein leerer Tisch die Nacht.
  const skipped = active > 0 && votes === active;
  const full = c.phaseTick >= (c.phase === 'day' ? ctx.balance.dayTicks : ctx.balance.nightTicks);
  if (!full && !skipped) return;

  c.phase = c.phase === 'day' ? 'night' : 'day';
  c.phaseTick = 0;
  for (let i = 0; i < c.skipVotes.length; i += 1) c.skipVotes[i] = false;
  // dayCount VOR den Ereignissen erhöhen, damit beide dieselbe Zahl tragen.
  if (c.phase === 'day') c.dayCount += 1;
  out.push({ kind: 'phase-changed', tick: state.tick, phase: c.phase, dayCount: c.dayCount });
  if (c.phase === 'day') out.push({ kind: 'day-started', tick: state.tick, dayCount: c.dayCount });
};
