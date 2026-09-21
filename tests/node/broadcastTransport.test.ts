import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBroadcastTransport } from '../../src/net/broadcastTransport';
import type { Channel, Transport } from '../../src/net/transport';

// Läuft nur in Node (tests/node): zwei Instanzen im selben Prozess reden über den ECHTEN
// BroadcastChannel von Node. Dessen Zustellung ist asynchron und hängt nicht an Timern – deshalb
// wartet jeder Test mit vi.waitUntil auf ein Ereignis statt eine feste Zeit zu schlafen.
//
// WICHTIG: Ein offener BroadcastChannel hält die Node-Ereignisschleife am Leben. Alles, was ein Test
// öffnet, läuft durch track() und wird in afterEach geschlossen.

const WAIT = { timeout: 5000, interval: 5 };
const opened: Array<{ close(): void }> = [];
let roomCounter = 0;

function track<T extends { close(): void }>(item: T): T {
  opened.push(item);
  return item;
}

/** Jeder Test bekommt einen eigenen Raum – Nachzügler eines anderen Tests können so nicht stören. */
function nextRoom(): string {
  roomCounter += 1;
  return `bt-test-${roomCounter}`;
}

function connect(room: string, selfId: string, peerId: string): Transport {
  return track(createBroadcastTransport({ room, selfId, peerId }));
}

interface WireEnvelope {
  to?: unknown;
  from?: unknown;
  inst?: unknown;
  kind?: unknown;
  channel?: unknown;
  data?: unknown;
}

/** Roher Mithörer/Einspeiser auf demselben Kanalnamen – sieht die Umschläge, wie sie wirklich über den Bus gehen. */
function tapWire(room: string): { seen: WireEnvelope[]; post(message: unknown): void; count(from: string, kind: string): number } {
  const bus = track(new BroadcastChannel(`maeusebau-lab-${room}`));
  const seen: WireEnvelope[] = [];
  bus.onmessage = (event: MessageEvent) => {
    seen.push(event.data as WireEnvelope);
  };
  return {
    seen,
    post: (message) => bus.postMessage(message),
    count: (from, kind) => seen.filter((envelope) => envelope.from === from && envelope.kind === kind).length,
  };
}

function record(transport: Transport): Array<[Channel, number[]]> {
  const got: Array<[Channel, number[]]> = [];
  transport.onMessage = (channel, data) => {
    expect(data).toBeInstanceOf(Uint8Array);
    got.push([channel, [...data]]);
  };
  return got;
}

afterEach(() => {
  for (const item of opened.splice(0)) item.close();
  vi.useRealTimers();
});

describe('createBroadcastTransport', () => {
  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])('beide Seiten werden open, auch wenn %s lange vor %s startet', async (early, late) => {
    const room = nextRoom();
    const wire = tapWire(room);
    const first = connect(room, early, late);
    const firstStates: string[] = [];
    first.onStateChange = (state) => firstStates.push(state);
    expect(first.state).toBe('connecting');
    expect(first.peerId).toBe(late);

    // Das erste syn des Frühstarters ist nachweislich ins Leere gegangen, bevor der Nachzügler existiert.
    await vi.waitUntil(() => wire.count(early, 'syn') >= 1, WAIT);
    const second = connect(room, late, early);
    const secondStates: string[] = [];
    second.onStateChange = (state) => secondStates.push(state);

    await vi.waitUntil(() => first.state === 'open' && second.state === 'open', WAIT);
    expect(firstStates).toEqual(['open']);
    expect(secondStates).toEqual(['open']);
  });

  it('send() vor dem Öffnen liefert false', () => {
    const lonely = connect(nextRoom(), 'a', 'b');

    expect(lonely.state).toBe('connecting');
    expect(lonely.send('events', new Uint8Array([1]))).toBe(false);
  });

  it('wiederholt syn alle 250 ms, beantwortet JEDES syn mit ack und stoppt den Timer nach dem Öffnen', async () => {
    // Nur das Intervall ist gefälscht; die Zustellung des BroadcastChannel bleibt echt.
    // (vi.waitUntil schiebt die gefälschte Uhr je Abfrage um `interval` weiter – deshalb nur >=-Vergleiche.)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const room = nextRoom();
    const wire = tapWire(room);
    const a = connect(room, 'a', 'b');

    await vi.waitUntil(() => wire.count('a', 'syn') >= 1, WAIT);
    // toMatchObject statt toEqual: die echten Umschläge tragen zusätzlich eine `inst`-Kennung (Finding 2).
    expect(wire.seen[0]).toMatchObject({ to: 'b', from: 'a', kind: 'syn' });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(250);
    await vi.waitUntil(() => wire.count('a', 'syn') >= 2, WAIT);

    wire.post({ to: 'a', from: 'b', inst: 'b-instanz', kind: 'syn' });
    await vi.waitUntil(() => wire.count('a', 'ack') >= 1, WAIT);
    expect(a.state).toBe('open');
    expect(vi.getTimerCount()).toBe(0);

    wire.post({ to: 'a', from: 'b', inst: 'b-instanz', kind: 'syn' });
    await vi.waitUntil(() => wire.count('a', 'ack') >= 2, WAIT);
    expect(wire.seen.find((envelope) => envelope.kind === 'ack')).toMatchObject({ to: 'b', from: 'a', kind: 'ack' });
  });

  it('liefert Daten in beide Richtungen auf beiden Kanälen – als Uint8Array-Kopien', async () => {
    const room = nextRoom();
    const a = connect(room, 'a', 'b');
    const b = connect(room, 'b', 'a');
    const gotA = record(a);
    const gotB = record(b);
    await vi.waitUntil(() => a.state === 'open' && b.state === 'open', WAIT);

    const buffer = new Uint8Array([1, 2, 3]);
    expect(a.send('state', buffer)).toBe(true);
    buffer[0] = 99;
    expect(a.send('events', new Uint8Array([0, 0, 5, 6, 0]).subarray(2, 4))).toBe(true);
    expect(b.send('events', new Uint8Array([7]))).toBe(true);
    expect(b.send('state', new Uint8Array(0))).toBe(true);

    await vi.waitUntil(() => gotA.length === 2 && gotB.length === 2, WAIT);
    expect(gotB).toEqual([['state', [1, 2, 3]], ['events', [5, 6]]]);
    expect(gotA).toEqual([['events', [7]], ['state', []]]);
  });

  it('Daten, die direkt im onStateChange("open") gesendet werden, kommen auf beiden Seiten an', async () => {
    const room = nextRoom();
    const a = connect(room, 'a', 'b');
    const gotA = record(a);
    a.onStateChange = (state) => {
      if (state === 'open') a.send('events', new Uint8Array([1]));
    };
    const b = connect(room, 'b', 'a');
    const gotB = record(b);
    b.onStateChange = (state) => {
      if (state === 'open') b.send('events', new Uint8Array([2]));
    };

    await vi.waitUntil(() => gotA.length === 1 && gotB.length === 1, WAIT);
    expect(gotA).toEqual([['events', [2]]]);
    expect(gotB).toEqual([['events', [1]]]);
  });

  it('ignoriert Umschläge an oder von anderen ids sowie Müll auf dem Bus', async () => {
    const room = nextRoom();
    const wire = tapWire(room);
    const a = connect(room, 'a', 'b');
    const got = record(a);
    wire.post({ to: 'a', from: 'b', inst: 'b-instanz', kind: 'ack' });
    await vi.waitUntil(() => a.state === 'open', WAIT);

    const data = new Uint8Array([1]);
    wire.post({ to: 'x', from: 'b', inst: 'b-instanz', kind: 'data', channel: 'state', data });
    wire.post({ to: 'a', from: 'fremd', inst: 'fremd-instanz', kind: 'data', channel: 'state', data });
    wire.post({ to: 'a', from: 'fremd', inst: 'fremd-instanz', kind: 'bye' });
    wire.post({ to: 'a', from: 'b', inst: 'b-instanz', kind: 'data', channel: 'quatsch', data });
    wire.post({ to: 'a', from: 'b', inst: 'b-instanz', kind: 'data', channel: 'state', data: 'kein Uint8Array' });
    // Finding 2: eine leere oder fehlende inst macht den Umschlag ungültig – auch das ist Müll.
    wire.post({ to: 'a', from: 'b', inst: '', kind: 'data', channel: 'state', data });
    wire.post({ to: 'a', from: 'b', kind: 'data', channel: 'state', data });
    wire.post({ to: 'a', from: 'b', inst: 'b-instanz', kind: 'unbekannt' });
    wire.post('nur Text');
    wire.post(null);
    wire.post({ to: 'a', from: 'b', inst: 'b-instanz', kind: 'data', channel: 'events', data: new Uint8Array([42]) });

    await vi.waitUntil(() => got.length >= 1, WAIT);
    expect(got).toEqual([['events', [42]]]);
    expect(a.state).toBe('open');
  });

  it('mehrere Paare im selben Raum stören sich nicht (Host mit zwei Clients)', async () => {
    const room = nextRoom();
    const hostToC1 = connect(room, 'host', 'c1');
    const hostToC2 = connect(room, 'host', 'c2');
    const c1 = connect(room, 'c1', 'host');
    const c2 = connect(room, 'c2', 'host');
    const gotFromC1 = record(hostToC1);
    const gotFromC2 = record(hostToC2);
    const gotC1 = record(c1);
    const gotC2 = record(c2);
    await vi.waitUntil(() => [hostToC1, hostToC2, c1, c2].every((transport) => transport.state === 'open'), WAIT);

    c1.send('state', new Uint8Array([1]));
    c2.send('state', new Uint8Array([2]));
    hostToC2.send('events', new Uint8Array([3]));

    await vi.waitUntil(() => gotFromC1.length === 1 && gotFromC2.length === 1 && gotC2.length === 1, WAIT);
    expect(gotFromC1).toEqual([['state', [1]]]);
    expect(gotFromC2).toEqual([['state', [2]]]);
    expect(gotC2).toEqual([['events', [3]]]);
    expect(gotC1).toEqual([]);
  });

  it('close() sendet bye: die Gegenstelle wird closed, send() liefert danach false', async () => {
    const room = nextRoom();
    const wire = tapWire(room);
    const a = connect(room, 'a', 'b');
    const b = connect(room, 'b', 'a');
    await vi.waitUntil(() => a.state === 'open' && b.state === 'open', WAIT);
    const statesA: string[] = [];
    const statesB: string[] = [];
    a.onStateChange = (state) => statesA.push(state);
    b.onStateChange = (state) => statesB.push(state);

    a.close();
    a.close();

    expect(a.state).toBe('closed');
    expect(a.send('events', new Uint8Array([1]))).toBe(false);
    await vi.waitUntil(() => b.state === 'closed' && wire.count('a', 'bye') >= 1, WAIT);
    expect(b.send('events', new Uint8Array([1]))).toBe(false);
    expect(statesA).toEqual(['closed']);
    expect(statesB).toEqual(['closed']);
    // toMatchObject statt toEqual: der echte bye-Umschlag trägt zusätzlich eine `inst`-Kennung (Finding 2).
    expect(wire.seen.filter((envelope) => envelope.kind === 'bye')).toMatchObject([{ to: 'b', from: 'a', kind: 'bye' }]);
  });

  it('ignoriert ein bye mit fremder Instanz-ID – die Gegenstelle bleibt offen (Finding 2)', async () => {
    const room = nextRoom();
    const wire = tapWire(room);
    const a = connect(room, 'a', 'b');
    const b = connect(room, 'b', 'a');
    const gotA = record(a);
    await vi.waitUntil(() => a.state === 'open' && b.state === 'open', WAIT);

    // Ein bye, das nicht von der wirklich verbundenen Instanz stammt (z. B. ein Nachzügler einer
    // anderen Sitzung mit derselben id), darf A nicht schließen.
    // wire.count() kann das eigene Posting NICHT sehen (BroadcastChannel liefert nie an den Absender
    // selbst zurück) – der Beweis kommt deshalb über einen echten Empfang, nicht über das Zählen.
    wire.post({ to: 'a', from: 'b', inst: 'fremde-instanz', kind: 'bye' });

    expect(b.send('events', new Uint8Array([9]))).toBe(true);
    await vi.waitUntil(() => gotA.length === 1, WAIT);
    expect(gotA).toEqual([['events', [9]]]);
    expect(a.state).toBe('open');
  });

  it('close() mit passender Instanz-ID schließt die Gegenstelle weiterhin (Finding 2)', async () => {
    const room = nextRoom();
    const a = connect(room, 'a', 'b');
    const b = connect(room, 'b', 'a');
    await vi.waitUntil(() => a.state === 'open' && b.state === 'open', WAIT);

    b.close();

    await vi.waitUntil(() => a.state === 'closed', WAIT);
    expect(a.send('events', new Uint8Array([1]))).toBe(false);
  });

  it('Peer-Neustart: eine neue Instanz übernimmt, ein verspätetes bye der alten Instanz schließt A nicht (Finding 2)', async () => {
    const room = nextRoom();
    const wire = tapWire(room);
    const a = connect(room, 'a', 'b');
    const bOld = connect(room, 'b', 'a');
    await vi.waitUntil(() => a.state === 'open' && bOld.state === 'open', WAIT);

    // Neustart der Gegenstelle (z. B. Tab-Reload): eine zweite Instanz mit denselben ids übernimmt,
    // OHNE dass bOld vorher ein bye gesendet hat.
    const bNew = connect(room, 'b', 'a');
    const gotA = record(a);
    const gotBNew = record(bNew);
    await vi.waitUntil(() => bNew.state === 'open', WAIT);
    expect(a.state).toBe('open');

    // Verspätetes bye der ALTEN Instanz (z. B. ein Tab, der jetzt erst tatsächlich schließt) darf die
    // frisch übernommene Verbindung nicht kappen.
    bOld.close();
    await vi.waitUntil(() => wire.count('b', 'bye') >= 1, WAIT);
    expect(a.state).toBe('open');

    expect(a.send('state', new Uint8Array([1]))).toBe(true);
    expect(bNew.send('state', new Uint8Array([2]))).toBe(true);
    await vi.waitUntil(() => gotBNew.length === 1 && gotA.length === 1, WAIT);
    expect(gotBNew).toEqual([['state', [1]]]);
    expect(gotA).toEqual([['state', [2]]]);

    bNew.close();
    await vi.waitUntil(() => a.state === 'closed', WAIT);
  });

  it('close() während des Verbindens stoppt die syn-Wiederholung', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const lonely = connect(nextRoom(), 'a', 'b');
    expect(vi.getTimerCount()).toBe(1);

    lonely.close();

    expect(lonely.state).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
