import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageRouter, type MessageRouter } from '../../../src/net/messageRouter';
import { attachPongResponder, runPingSeries, type PingSeriesOptions, type PingStats } from '../../../src/net/pingTest';
import { decodeMessage } from '../../../src/net/protocol';
import type { Channel } from '../../../src/net/transport';
import { createMemoryTransportPair, type MemoryTransportOptions } from '../../helpers/memoryTransport';

/** 5 Pings alle 33 ms: gesendet bei t = 0, 33, 66, 99, 132 ms. */
const OPTIONS: PingSeriesOptions = { count: 5, intervalMs: 33, timeoutMs: 2000, now: () => Date.now() };
const LAST_PING_AT = 132;
/**
 * Laufzeit je Richtung. Bewusst nie 0: die Fake-Timer machen aus einem `setTimeout(…, 0)`, der
 * WÄHREND eines Timer-Callbacks entsteht, 1 ms – die Zeitpunkte wären sonst schief.
 */
const LATENCY = 5;
const RTT = 2 * LATENCY;

function setup(net: MemoryTransportOptions = {}) {
  const pair = createMemoryTransportPair({ latencyMs: () => LATENCY, ...net });
  return { pair, local: createMessageRouter(pair.a), remote: createMessageRouter(pair.b) };
}

/** Startet die Serie und merkt sich das Ergebnis, sobald das Promise auflöst. */
function start(router: MessageRouter, channel: Channel, options: PingSeriesOptions = OPTIONS): { stats: PingStats | null } {
  const run: { stats: PingStats | null } = { stats: null };
  void runPingSeries(router, channel, options).then((stats) => {
    run.stats = stats;
  });
  return run;
}

/** Netz-Funktion: trifft genau die Nachricht mit diesem Typ und dieser seq. */
const isMessage = (type: 'ping' | 'pong', seq: number) => (packet: { data: Uint8Array }): boolean => {
  const message = decodeMessage(packet.data);
  return message.type === type && message.seq === seq;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('attachPongResponder', () => {
  it('beantwortet jeden Ping mit einem Pong gleicher seq/sentAtMs auf DEMSELBEN Kanal', async () => {
    const { local, remote } = setup();
    const pongs: unknown[] = [];
    local.on('pong', (message, channel) => pongs.push([message, channel]));
    attachPongResponder(remote);

    local.send('state', { type: 'ping', seq: 3, sentAtMs: 12.25 });
    local.send('events', { type: 'ping', seq: 4, sentAtMs: 99 });
    await vi.advanceTimersByTimeAsync(RTT);

    expect(pongs).toEqual([
      [{ type: 'pong', seq: 3, sentAtMs: 12.25 }, 'state'],
      [{ type: 'pong', seq: 4, sentAtMs: 99 }, 'events'],
    ]);
  });

  it('antwortet nach dem Abmelden nicht mehr', async () => {
    const { local, remote } = setup();
    const onPong = vi.fn();
    local.on('pong', onPong);
    const detach = attachPongResponder(remote);

    detach();
    local.send('state', { type: 'ping', seq: 1, sentAtMs: 1 });
    await vi.advanceTimersByTimeAsync(RTT);

    expect(onPong).not.toHaveBeenCalled();
  });
});

describe('runPingSeries', () => {
  it('sendet count Pings im Abstand intervalMs (den ersten sofort) mit seq ab 0 und sentAtMs aus now()', async () => {
    const { local, remote } = setup();
    const arrivals: Array<[number, number, number]> = [];
    remote.on('ping', (message) => arrivals.push([message.seq, message.sentAtMs, Date.now() - LATENCY]));

    start(local, 'state', { ...OPTIONS, now: () => 5000 + Date.now() });
    await vi.advanceTimersByTimeAsync(LAST_PING_AT + OPTIONS.timeoutMs);

    expect(arrivals).toEqual([
      [0, 5000, 0],
      [1, 5033, 33],
      [2, 5066, 66],
      [3, 5099, 99],
      [4, 5132, 132],
    ]);
  });

  it('löst vorzeitig auf, sobald alle Pongs da sind, und misst die RTT mit now()', async () => {
    const { local, remote } = setup();
    attachPongResponder(remote);

    const run = start(local, 'state');
    await vi.advanceTimersByTimeAsync(LAST_PING_AT + RTT - 1);
    expect(run.stats).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(run.stats).toEqual({
      sent: 5, received: 5, lossPct: 0, minMs: RTT, medianMs: RTT, p95Ms: RTT, maxMs: RTT, outOfOrder: 0,
    });
  });

  it('wartet bei Verlust bis letzter Ping + timeoutMs und meldet den Verlust', async () => {
    const lostPing = isMessage('ping', 1);
    const lostPong = isMessage('pong', 3);
    const { local, remote } = setup({ drop: (packet) => lostPing(packet) || lostPong(packet) });
    attachPongResponder(remote);

    const run = start(local, 'state');
    await vi.advanceTimersByTimeAsync(LAST_PING_AT + OPTIONS.timeoutMs - 1);
    expect(run.stats).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(run.stats).toMatchObject({ sent: 5, received: 3, lossPct: 40, outOfOrder: 0 });
  });

  it('ein Pong, der erst nach dem Timeout kommt, zählt nicht mehr', async () => {
    const slowPong = isMessage('pong', 4);
    const { local, remote } = setup({ latencyMs: (packet) => (slowPong(packet) ? 5000 : LATENCY) });
    attachPongResponder(remote);

    const run = start(local, 'events');
    await vi.advanceTimersByTimeAsync(LAST_PING_AT + OPTIONS.timeoutMs);
    const resolved = run.stats;
    await vi.advanceTimersByTimeAsync(5000);

    expect(resolved).toMatchObject({ sent: 5, received: 4, lossPct: 20 });
    expect(run.stats).toBe(resolved);
  });

  it('send() === false zählt als gesendet-aber-verloren; ohne offene Pongs endet die Serie mit dem letzten Ping', async () => {
    const { pair, local, remote } = setup();
    attachPongResponder(remote);

    const run = start(local, 'state');
    await vi.advanceTimersByTimeAsync(50);
    pair.a.close();
    await vi.advanceTimersByTimeAsync(LAST_PING_AT - 50 - 1);
    expect(run.stats).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(run.stats).toMatchObject({ sent: 5, received: 2, lossPct: 60 });
  });

  it('zählt überholte Pongs als outOfOrder', async () => {
    const { local, remote } = setup({ reorder: isMessage('ping', 1) });
    const order: number[] = [];
    local.on('pong', (message) => order.push(message.seq));
    attachPongResponder(remote);

    const run = start(local, 'state');
    await vi.advanceTimersByTimeAsync(LAST_PING_AT + RTT);

    expect(order).toEqual([0, 2, 1, 3, 4]);
    expect(run.stats).toMatchObject({ sent: 5, received: 5, lossPct: 0, outOfOrder: 1 });
  });

  it('zählt doppelte Pongs nur einmal', async () => {
    const { local, remote } = setup();
    attachPongResponder(remote);
    attachPongResponder(remote);

    const run = start(local, 'state');
    await vi.advanceTimersByTimeAsync(LAST_PING_AT + RTT);

    expect(run.stats).toMatchObject({ sent: 5, received: 5, lossPct: 0, outOfOrder: 0 });
  });

  it('ignoriert Pongs vom anderen Kanal, mit fremdem sentAtMs oder unbekannter seq', async () => {
    const { local, remote } = setup();
    remote.on('ping', (message, channel) => {
      remote.send(channel === 'state' ? 'events' : 'state', { type: 'pong', seq: message.seq, sentAtMs: message.sentAtMs });
      remote.send(channel, { type: 'pong', seq: message.seq, sentAtMs: message.sentAtMs + 1 });
      remote.send(channel, { type: 'pong', seq: 999, sentAtMs: message.sentAtMs });
    });

    const run = start(local, 'state');
    await vi.advanceTimersByTimeAsync(LAST_PING_AT + OPTIONS.timeoutMs);

    expect(run.stats).toMatchObject({ sent: 5, received: 0, lossPct: 100 });
  });

  it('räumt auf: Pong-Handler abgemeldet, keine Timer übrig – nach vorzeitigem Ende und nach Timeout', async () => {
    for (const net of [{}, { drop: isMessage('pong', 2) }]) {
      const { local, remote } = setup(net);
      attachPongResponder(remote);
      const unsubscribed = vi.fn();
      const spied: MessageRouter = {
        on: (type, handler) => {
          const off = local.on(type, handler);
          return () => {
            unsubscribed();
            off();
          };
        },
        send: (channel, message) => local.send(channel, message),
      };

      const run = start(spied, 'state');
      await vi.advanceTimersByTimeAsync(LAST_PING_AT + OPTIONS.timeoutMs);

      expect(run.stats).not.toBeNull();
      expect(unsubscribed).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('count 0 löst sofort mit leerer Statistik auf und sendet nichts', async () => {
    const { local, remote } = setup();
    const onPing = vi.fn();
    remote.on('ping', onPing);

    const run = start(local, 'state', { ...OPTIONS, count: 0 });
    await vi.advanceTimersByTimeAsync(RTT);

    expect(run.stats).toEqual({
      sent: 0, received: 0, lossPct: 0, minMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, outOfOrder: 0,
    });
    expect(onPing).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
