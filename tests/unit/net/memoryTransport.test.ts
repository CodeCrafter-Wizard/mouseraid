import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../../src/net/transport';
import { createMemoryTransportPair } from '../../helpers/memoryTransport';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('createMemoryTransportPair (Test-Helfer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('startet offen, kennt die Gegenstelle und stellt nie synchron zu', () => {
    const { a, b } = createMemoryTransportPair();
    const got: Array<[Channel, number[]]> = [];
    b.onMessage = (channel, data) => got.push([channel, [...data]]);

    expect(a.state).toBe('open');
    expect(a.peerId).toBe('b');
    expect(b.peerId).toBe('a');
    expect(a.send('state', bytes(1, 2))).toBe(true);
    expect(a.send('events', bytes(3))).toBe(true);
    expect(got).toEqual([]);

    vi.advanceTimersByTime(0);
    expect(got).toEqual([['state', [1, 2]], ['events', [3]]]);
  });

  it('liefert Kopien: spätere Änderungen am Sendepuffer kommen nicht an', () => {
    const { a, b } = createMemoryTransportPair();
    const got: number[][] = [];
    b.onMessage = (_channel, data) => got.push([...data]);
    const buffer = bytes(7, 8, 9);

    a.send('state', buffer);
    buffer[0] = 0;
    vi.advanceTimersByTime(0);

    expect(got).toEqual([[7, 8, 9]]);
  });

  it('verzögert je Paket über latencyMs – unterschiedliche Werte ordnen um', () => {
    const { a, b } = createMemoryTransportPair({ latencyMs: (packet) => (packet.index === 0 ? 50 : 10) });
    const got: number[] = [];
    b.onMessage = (_channel, data) => got.push(data[0] ?? -1);

    a.send('state', bytes(0));
    a.send('state', bytes(1));
    vi.advanceTimersByTime(10);
    expect(got).toEqual([1]);
    vi.advanceTimersByTime(40);
    expect(got).toEqual([1, 0]);
  });

  it('drop verwirft Pakete, send meldet trotzdem true (Verlust unterwegs)', () => {
    const seen: string[] = [];
    const { a, b } = createMemoryTransportPair({
      drop: (packet) => {
        seen.push(`${packet.from}/${packet.channel}#${packet.index}`);
        return packet.from === 'a' && packet.index === 1;
      },
    });
    const got: number[] = [];
    b.onMessage = (_channel, data) => got.push(data[0] ?? -1);
    a.onMessage = (_channel, data) => got.push(100 + (data[0] ?? -1));

    expect(a.send('state', bytes(0))).toBe(true);
    expect(a.send('state', bytes(1))).toBe(true);
    expect(a.send('events', bytes(2))).toBe(true);
    expect(b.send('state', bytes(3))).toBe(true);
    vi.advanceTimersByTime(0);

    expect(got).toEqual([0, 2, 103]);
    expect(seen).toEqual(['a/state#0', 'a/state#1', 'a/events#0', 'b/state#0']);
  });

  it('reorder hält ein Paket zurück, bis das nächste desselben Kanals zugestellt ist', () => {
    const { a, b } = createMemoryTransportPair({ reorder: (packet) => packet.channel === 'state' && packet.index === 1 });
    const got: number[] = [];
    b.onMessage = (_channel, data) => got.push(data[0] ?? -1);

    a.send('state', bytes(0));
    a.send('state', bytes(1));
    a.send('events', bytes(9));
    vi.advanceTimersByTime(0);
    expect(got).toEqual([0, 9]);

    a.send('state', bytes(2));
    vi.advanceTimersByTime(0);
    expect(got).toEqual([0, 9, 2, 1]);
  });

  it('close schließt beide Seiten, meldet es und verwirft Pakete, die noch unterwegs sind', () => {
    const { a, b } = createMemoryTransportPair({ latencyMs: () => 20 });
    const states: string[] = [];
    const got: number[] = [];
    a.onStateChange = (state) => states.push(`a:${state}`);
    b.onStateChange = (state) => states.push(`b:${state}`);
    b.onMessage = (_channel, data) => got.push(data[0] ?? -1);

    a.send('events', bytes(1));
    a.close();
    a.close();
    vi.advanceTimersByTime(20);

    expect(states).toEqual(['a:closed', 'b:closed']);
    expect(a.state).toBe('closed');
    expect(b.state).toBe('closed');
    expect(got).toEqual([]);
    expect(a.send('state', bytes(2))).toBe(false);
    expect(b.send('state', bytes(3))).toBe(false);
  });
});
