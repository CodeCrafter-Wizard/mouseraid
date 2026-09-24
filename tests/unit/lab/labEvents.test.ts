import { describe, expect, it } from 'vitest';
import { createRelayTimeline, flushLabEvents, recordLabEvent } from '../../../src/lab/labEvents';
import { createTimeline } from '../../../src/net/timeline';

// Der Puffer ist Seiten-Zustand (ein Modul je Seitenaufruf). Die Tests messen deshalb RELATIV:
// erst einmal leer flushen, dann zählen, was danach dazukommt.

describe('labEvents', () => {
  it('schreibt aufgezeichnete Seiten-Ereignisse in eine Zeitleiste', () => {
    const timeline = createTimeline(() => 0);
    flushLabEvents(timeline);
    const before = timeline.events().length;

    recordLabEvent('wakelock:acquired');
    recordLabEvent('camera:track:muted');
    flushLabEvents(timeline);

    expect(timeline.events().slice(before).map((event) => event.kind)).toEqual(['wakelock:acquired', 'camera:track:muted']);
  });

  it('schreibt in dieselbe Zeitleiste nichts doppelt', () => {
    const timeline = createTimeline(() => 0);
    recordLabEvent('wakelock:denied');
    flushLabEvents(timeline);
    const after = timeline.events().length;

    flushLabEvents(timeline);
    expect(timeline.events()).toHaveLength(after);

    recordLabEvent('camera-error', 'track-ended');
    flushLabEvents(timeline);
    expect(timeline.events().slice(after)).toEqual([{ tMs: 0, kind: 'camera-error', detail: 'track-ended' }]);
  });

  it('gibt jeder neuen Zeitleiste alle bisherigen Ereignisse (ein Platz, der später aufmacht, sieht sie auch)', () => {
    recordLabEvent('wakelock:acquired');
    const first = createTimeline(() => 0);
    flushLabEvents(first);
    const second = createTimeline(() => 0);
    flushLabEvents(second);

    expect(second.events().map((event) => event.kind)).toEqual(first.events().map((event) => event.kind));
    expect(second.events().map((event) => event.kind)).toContain('wakelock:acquired');
  });
});

// Zweiter Puffer derselben Art: der Client scannt das Angebot, BEVOR `acceptOffer` seine Zeitleiste
// anlegt (T4). Beides wohnt in EINEM Modul – „Ereignisse ohne Zeitleiste" ist eine Regel, nicht zwei.

describe('createRelayTimeline', () => {
  it('puffert, solange es kein Ziel gibt', () => {
    const relay = createRelayTimeline(() => 0);
    relay.timeline.push('qr:backend', 'worker');
    expect(relay.timeline.events().map((event) => event.kind)).toEqual(['qr:backend']);
  });

  it('trägt beim Andocken alles nach – in derselben Reihenfolge', () => {
    const relay = createRelayTimeline(() => 0);
    relay.timeline.push('qr:backend', 'worker');
    relay.timeline.push('qr:decoded', 'worker 24ms 7');
    const target = createTimeline(() => 0);
    relay.drainInto(target);
    expect(target.events()).toEqual([
      { tMs: 0, kind: 'qr:backend', detail: 'worker' },
      { tMs: 0, kind: 'qr:decoded', detail: 'worker 24ms 7' },
    ]);
  });

  it('schreibt nach dem Andocken ins Ziel – genau einmal', () => {
    const relay = createRelayTimeline(() => 0);
    const target = createTimeline(() => 0);
    relay.drainInto(target);
    relay.timeline.push('qr:shown', 'offer 704 Zeichen, 101 Module, 4 px/Modul');
    expect(target.events().map((event) => event.kind)).toEqual(['qr:shown']);
  });

  it('dieselbe Zeitleiste zweimal andocken doppelt nichts', () => {
    const relay = createRelayTimeline(() => 0);
    relay.timeline.push('qr:backend', 'worker');
    const target = createTimeline(() => 0);
    relay.drainInto(target);
    relay.timeline.push('qr:shown', 'offer 704 Zeichen, 101 Module, 4 px/Modul');
    relay.drainInto(target);
    expect(target.events().map((event) => event.kind)).toEqual(['qr:backend', 'qr:shown']);
  });

  it('eine zweite Zeitleiste bekommt den GANZEN Verlauf, die erste nichts mehr', () => {
    const relay = createRelayTimeline(() => 0);
    relay.timeline.push('qr:backend', 'worker');
    relay.timeline.push('qr:shown', 'offer 704 Zeichen, 101 Module, 4 px/Modul');
    const first = createTimeline(() => 0);
    relay.drainInto(first);
    expect(first.events()).toHaveLength(2);

    relay.timeline.push('qr:decoded', 'worker 24ms 7');
    expect(first.events()).toHaveLength(3);

    // Zweiter Versuch, zweite Zeitleiste (ein erneutes `acceptOffer` legt eine neue an): sie bekommt
    // den ganzen bisherigen Verlauf – sonst fehlten genau die Einträge, die sie belegen soll.
    const second = createTimeline(() => 0);
    relay.drainInto(second);
    expect(second.events().map((event) => event.kind)).toEqual(['qr:backend', 'qr:shown', 'qr:decoded']);
    expect(first.events()).toHaveLength(3);

    // Ab jetzt landet jeder Eintrag NUR noch in der neuesten Zeitleiste.
    relay.timeline.push('qr:fallback-text', 'offer');
    expect(second.events()).toHaveLength(4);
    expect(first.events()).toHaveLength(3);
  });
});
