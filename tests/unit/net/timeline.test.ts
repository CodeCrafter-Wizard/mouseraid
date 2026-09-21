import { describe, expect, it } from 'vitest';
import { createTimeline, type TimelineEvent } from '../../../src/net/timeline';

/** Uhr zum Verstellen – die Zeitleiste bekommt ihre Zeitquelle immer injiziert. */
function fakeClock(start: number): { now: () => number; set: (value: number) => void } {
  let current = start;
  return { now: () => current, set: (value) => { current = value; } };
}

describe('createTimeline', () => {
  it('misst tMs relativ zum Erzeugungszeitpunkt', () => {
    const clock = fakeClock(1000);
    const timeline = createTimeline(clock.now);
    clock.set(1012);
    timeline.push('pc-created');
    clock.set(1250);
    timeline.push('ice:checking', 'erster Versuch');
    expect(timeline.events()).toEqual([
      { tMs: 12, kind: 'pc-created', detail: '' },
      { tMs: 250, kind: 'ice:checking', detail: 'erster Versuch' },
    ]);
  });

  it('detail ist ohne Angabe ein leerer Text', () => {
    const timeline = createTimeline(() => 5);
    timeline.push('gathering:complete');
    expect(timeline.events()[0]).toEqual({ tMs: 0, kind: 'gathering:complete', detail: '' });
  });

  it('rundet auf ganze Millisekunden (performance.now() liefert Bruchteile)', () => {
    const clock = fakeClock(0.4);
    const timeline = createTimeline(clock.now);
    clock.set(12.7);
    timeline.push('a');
    clock.set(100.95);
    timeline.push('b');
    expect(timeline.events().map((event) => event.tMs)).toEqual([12, 101]);
  });

  it('beginnt leer', () => {
    expect(createTimeline(() => 0).events()).toEqual([]);
  });

  it('events() ist ein Schnappschuss: spätere Einträge verändern ihn nicht', () => {
    const timeline = createTimeline(() => 0);
    timeline.push('a');
    const snapshot = timeline.events();
    timeline.push('b');
    expect(snapshot).toHaveLength(1);
    expect(timeline.events()).toHaveLength(2);
  });

  it('events() ist kopiersicher: Änderungen am Ergebnis erreichen die Zeitleiste nicht', () => {
    const timeline = createTimeline(() => 0);
    timeline.push('a', 'original');
    const leaked = timeline.events() as TimelineEvent[];
    leaked.push({ tMs: 99, kind: 'gefälscht', detail: '' });
    const first = leaked[0];
    if (first === undefined) throw new Error('Eintrag fehlt');
    first.detail = 'manipuliert';
    expect(timeline.events()).toEqual([{ tMs: 0, kind: 'a', detail: 'original' }]);
  });
});
