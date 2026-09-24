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

  // „Neu verbinden" (Sperrtest, D9) ist ein NEUER Austausch: sein Report soll zeigen, wie ER gelaufen
  // ist. Ein `qr:error` des toten Peers dort erneut aufzuführen, hängte dem frischen Lauf ein F9 an,
  // das mit ihm nichts zu tun hat. Der zweite Versuch am SELBEN Austausch („Erneut scannen") behält
  // dagegen den ganzen Verlauf – das prüft der Test darüber.
  it('reset(): der nächste Austausch erbt den Verlauf des alten nicht', () => {
    const relay = createRelayTimeline(() => 0);
    relay.timeline.push('qr:backend', 'worker');
    relay.timeline.push('qr:error', 'scan-timeout');
    const first = createTimeline(() => 0);
    relay.drainInto(first);
    expect(first.events()).toHaveLength(2);

    relay.reset();

    // Der alte Lauf behält, was er schon hat – geschrieben wird dort aber nichts mehr.
    relay.timeline.push('qr:shown', 'offer 704 Zeichen, 101 Module, 4 px/Modul');
    expect(first.events()).toHaveLength(2);
    expect(relay.timeline.events().map((event) => event.kind)).toEqual(['qr:shown']);

    const second = createTimeline(() => 0);
    relay.drainInto(second);
    expect(second.events().map((event) => event.kind)).toEqual(['qr:shown']);
  });
});

// Ganz am Ende, weil dieser Block den Seiten-Puffer absichtlich überlaufen lässt.
describe('labEvents: Deckel bei 200 Einträgen', () => {
  it('behält die jüngsten 200 Einträge und verrechnet die herausgefallenen', () => {
    for (let index = 0; index < 205; index += 1) recordLabEvent('camera:track:muted', String(index));

    const timeline = createTimeline(() => 0);
    flushLabEvents(timeline);
    const details = timeline.events().map((event) => event.detail);
    // Der Deckel schneidet VORNE ab – ohne Platzhalter: eine flatternde Kamera-Spur soll den Report
    // nicht sprengen, und die jüngsten Ereignisse erklären den Lauf.
    expect(details).toHaveLength(200);
    expect(details[0]).toBe('5');
    expect(details[199]).toBe('204');

    // Ein zweiter Durchgang derselben Zeitleiste doppelt nichts – auch nicht über die Lücke hinweg.
    flushLabEvents(timeline);
    expect(timeline.events()).toHaveLength(200);

    // Und was danach kommt, kommt genau einmal an: die Merker zählen global, nicht im Puffer.
    recordLabEvent('wakelock:acquired');
    flushLabEvents(timeline);
    expect(timeline.events()).toHaveLength(201);
    expect(timeline.events().map((event) => event.kind).pop()).toBe('wakelock:acquired');
  });
});
