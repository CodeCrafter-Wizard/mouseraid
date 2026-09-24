import { describe, expect, it } from 'vitest';
import {
  LOCK_SECONDS,
  armedTrackState,
  beginLockRun,
  finishLockRun,
  measuredLockPings,
  needsReconnect,
  type LockPings,
  type LockSeconds,
} from '../../../src/lab/lockTest';
import type { PingStats } from '../../../src/net/pingTest';

/** Verstellbare Uhr: der Test sagt, wie viel Zeit zwischen den Aufrufen vergeht. */
function fakeClock(start = 1000): { now: () => number; advance(ms: number): void } {
  let value = start;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

const stats = (sent: number, received: number): PingStats => ({
  sent, received, lossPct: sent === 0 ? 0 : Math.round(((sent - received) * 1000) / sent) / 10,
  minMs: 2, medianMs: 3, p95Ms: 9, maxMs: 30, outOfOrder: 0,
});
const pings = (events: PingStats | null, state: PingStats | null): LockPings => ({ state, events });

describe('LOCK_SECONDS', () => {
  it('bietet genau die drei Dauern des Designs an', () => {
    expect([...LOCK_SECONDS]).toEqual([10, 30, 60]);
  });
});

describe('beginLockRun', () => {
  it('hält Dauer, Startzeitpunkt und die Zustände VOR dem Sperren fest', () => {
    const clock = fakeClock(5000);
    const plan = beginLockRun({ plannedSeconds: 30, transport: 'open', track: 'live', now: clock.now });
    expect(plan).toEqual({ plannedSeconds: 30, hiddenAtMs: 5000, transportBefore: 'open', trackBefore: 'live' });
  });

  it('fragt die Uhr genau einmal', () => {
    let calls = 0;
    beginLockRun({ plannedSeconds: 10, transport: 'open', track: 'live', now: () => { calls += 1; return 1; } });
    expect(calls).toBe(1);
  });
});

describe('finishLockRun', () => {
  const plan = (seconds: LockSeconds = 30) => beginLockRun({ plannedSeconds: seconds, transport: 'open', track: 'live', now: () => 1000 });

  it('misst die tatsächlich verdeckte Zeit – nicht die geplante', () => {
    const clock = fakeClock(1000);
    const started = beginLockRun({ plannedSeconds: 30, transport: 'open', track: 'live', now: clock.now });
    clock.advance(41_800); // der Nutzer war länger weg als geplant
    const run = finishLockRun(started, { transport: 'open', track: 'unmuted', pingAfter: null, reconnected: false, now: clock.now });
    expect(run.plannedSeconds).toBe(30);
    expect(run.hiddenMs).toBe(41_800);
  });

  it('rundet auf ganze Millisekunden und wird nie negativ', () => {
    expect(finishLockRun(plan(), { transport: 'open', track: 'live', pingAfter: null, reconnected: false, now: () => 1010.4 }).hiddenMs).toBe(10);
    expect(finishLockRun(plan(), { transport: 'open', track: 'live', pingAfter: null, reconnected: false, now: () => 1010.6 }).hiddenMs).toBe(11);
    // Uhr springt zurück (Attrappe, aber auch echte Uhren dürfen das): 0 statt einer negativen Dauer.
    expect(finishLockRun(plan(), { transport: 'open', track: 'live', pingAfter: null, reconnected: false, now: () => 900 }).hiddenMs).toBe(0);
  });

  it('trägt beide Zustandspaare, die Ping-Serie und das Kennzeichen „neu verbunden“ ein', () => {
    const started = beginLockRun({ plannedSeconds: 60, transport: 'open', track: 'live', now: () => 0 });
    const after = pings(stats(20, 20), stats(20, 18));
    const run = finishLockRun(started, { transport: 'failed', track: 'ended', pingAfter: after, reconnected: true, now: () => 60_500 });
    expect(run).toEqual({
      plannedSeconds: 60,
      hiddenMs: 60_500,
      transportBefore: 'open',
      transportAfter: 'failed',
      trackBefore: 'live',
      trackAfter: 'ended',
      pingAfter: after,
      reconnected: true,
    });
  });

  it('ist rein: derselbe Plan lässt sich mehrfach abschließen und wird dabei nicht verändert', () => {
    const started = plan(10);
    const first = finishLockRun(started, { transport: 'open', track: 'live', pingAfter: null, reconnected: false, now: () => 11_000 });
    const second = finishLockRun(started, { transport: 'closed', track: 'ended', pingAfter: null, reconnected: true, now: () => 12_000 });
    expect(started).toEqual({ plannedSeconds: 10, hiddenAtMs: 1000, transportBefore: 'open', trackBefore: 'live' });
    expect(first.hiddenMs).toBe(10_000);
    expect(second.hiddenMs).toBe(11_000);
    expect(first.transportAfter).toBe('open');
  });
});

describe('armedTrackState', () => {
  it('eine laufende Kamera hat eine frische, lebende Spur – ein altes „ended" belastet den nächsten Lauf nicht', () => {
    // Genau der Fall „Spur verloren → Kamera neu starten → nächsten Lauf schärfen".
    expect(armedTrackState(true, 'ended')).toBe('live');
    expect(armedTrackState(true, 'muted')).toBe('live');
    expect(armedTrackState(true, 'live')).toBe('live');
  });

  it('ohne laufende Kamera bleibt es beim bisherigen Zustand – es gibt keine Spur, die etwas anderes sagt', () => {
    for (const previous of ['live', 'muted', 'unmuted', 'ended'] as const) {
      expect(armedTrackState(false, previous)).toBe(previous);
    }
  });
});

describe('measuredLockPings', () => {
  const full = (): LockPings => pings(stats(20, 20), stats(20, 19));

  it('ohne offene Verbindung beim Entsperren gab es nichts zu messen', () => {
    expect(measuredLockPings(false, full())).toBeNull();
    expect(measuredLockPings(false, { state: null, events: null })).toBeNull();
  });

  it('zwei leere Kanäle sind dasselbe wie keine Messung – sonst stünden im Bericht zwei Gedankenstriche statt „nicht gemessen"', () => {
    expect(measuredLockPings(true, { state: null, events: null })).toBeNull();
  });

  it('eine echte Serie kommt unverändert durch – auch wenn nur ein Kanal etwas geliefert hat', () => {
    const both = full();
    expect(measuredLockPings(true, both)).toBe(both);
    const onlyEvents = pings(stats(20, 20), null);
    expect(measuredLockPings(true, onlyEvents)).toBe(onlyEvents);
    const onlyState = pings(null, stats(20, 17));
    expect(measuredLockPings(true, onlyState)).toBe(onlyState);
  });
});

describe('needsReconnect', () => {
  it('nur ein nicht mehr offener Transport oder eine beendete Spur verlangt ein frisches Angebot', () => {
    expect(needsReconnect({ transportAfter: 'open', trackAfter: 'live' })).toBe(false);
    expect(needsReconnect({ transportAfter: 'open', trackAfter: 'unmuted' })).toBe(false);
    // Die Unterbrechung am Sperrbildschirm ist 'muted'/'unmuted' – sie ist kein Grund, neu zu verbinden.
    expect(needsReconnect({ transportAfter: 'open', trackAfter: 'muted' })).toBe(false);
    expect(needsReconnect({ transportAfter: 'open', trackAfter: 'ended' })).toBe(true);
    for (const state of ['connecting', 'closed', 'failed'] as const) {
      expect(needsReconnect({ transportAfter: state, trackAfter: 'live' })).toBe(true);
    }
  });
});
