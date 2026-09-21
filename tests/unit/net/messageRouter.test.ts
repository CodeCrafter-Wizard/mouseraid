import { describe, expect, it, vi } from 'vitest';
import { createMessageRouter } from '../../../src/net/messageRouter';
import { decodeMessage, encodeMessage, ProtocolError, type NetMessage } from '../../../src/net/protocol';
import type { Channel, Transport } from '../../../src/net/transport';

interface FakeTransport extends Transport {
  sent: Array<{ channel: Channel; data: Uint8Array }>;
  accept: boolean;
}

/** Transport-Attrappe: merkt sich Gesendetes; Empfang wird über `onMessage` direkt eingespielt. */
function fakeTransport(): FakeTransport {
  const transport: FakeTransport = {
    peerId: 'gegenstelle',
    state: 'open',
    sent: [],
    accept: true,
    onMessage: null,
    onStateChange: null,
    send(channel, data) {
      if (!transport.accept) return false;
      transport.sent.push({ channel, data });
      return true;
    },
    close() {},
  };
  return transport;
}

const PING: NetMessage = { type: 'ping', seq: 7, sentAtMs: 1234.5 };
const PONG: NetMessage = { type: 'pong', seq: 7, sentAtMs: 1234.5 };
const HELLO: NetMessage = { type: 'hello', protoV: 1, buildId: 'abc12345' };

describe('createMessageRouter', () => {
  it('dekodiert eingehende Bytes und verteilt sie nach Typ an ALLE Handler dieses Typs – mit Kanal', () => {
    const transport = fakeTransport();
    const router = createMessageRouter(transport);
    const first = vi.fn();
    const second = vi.fn();
    const hello = vi.fn();
    router.on('ping', first);
    router.on('ping', second);
    router.on('hello', hello);

    transport.onMessage?.('state', encodeMessage(PING));
    transport.onMessage?.('events', encodeMessage(HELLO));

    expect(first.mock.calls).toEqual([[PING, 'state']]);
    expect(second.mock.calls).toEqual([[PING, 'state']]);
    expect(hello.mock.calls).toEqual([[HELLO, 'events']]);
  });

  it('ruft Handler anderer Typen nicht auf und verkraftet Nachrichten ohne Handler', () => {
    const transport = fakeTransport();
    const router = createMessageRouter(transport);
    const onPing = vi.fn();
    router.on('ping', onPing);

    expect(() => transport.onMessage?.('state', encodeMessage(PONG))).not.toThrow();
    expect(onPing).not.toHaveBeenCalled();
  });

  it('die Rückgabe von on() meldet genau diesen Handler ab', () => {
    const transport = fakeTransport();
    const router = createMessageRouter(transport);
    const stays = vi.fn();
    const leaves = vi.fn();
    router.on('pong', stays);
    const off = router.on('pong', leaves);

    off();
    off();
    transport.onMessage?.('events', encodeMessage(PONG));

    expect(stays).toHaveBeenCalledTimes(1);
    expect(leaves).not.toHaveBeenCalled();
  });

  it('ein Handler darf sich während der Zustellung abmelden, ohne die übrigen zu stören', () => {
    const transport = fakeTransport();
    const router = createMessageRouter(transport);
    const calls: string[] = [];
    const offFirst = router.on('ping', () => {
      calls.push('erster');
      offFirst();
    });
    router.on('ping', () => calls.push('zweiter'));

    transport.onMessage?.('state', encodeMessage(PING));
    transport.onMessage?.('state', encodeMessage(PING));

    expect(calls).toEqual(['erster', 'zweiter', 'zweiter']);
  });

  it('meldet Protokollfehler an onProtocolError und wirft nie in den Transport', () => {
    const transport = fakeTransport();
    const errors: unknown[] = [];
    const router = createMessageRouter(transport, (error) => errors.push(error));
    const onPing = vi.fn();
    router.on('ping', onPing);

    expect(() => transport.onMessage?.('state', new Uint8Array([99, 1, 2]))).not.toThrow();
    expect(() => transport.onMessage?.('events', new Uint8Array(0))).not.toThrow();

    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
    expect(onPing).not.toHaveBeenCalled();
  });

  it('schluckt Protokollfehler auch ohne onProtocolError', () => {
    const transport = fakeTransport();
    createMessageRouter(transport);

    expect(() => transport.onMessage?.('state', new Uint8Array([99]))).not.toThrow();
  });

  it('eine Ausnahme aus einem Handler geht an onProtocolError und stört die übrigen Handler nicht', () => {
    const transport = fakeTransport();
    const errors: unknown[] = [];
    const router = createMessageRouter(transport, (error) => errors.push(error));
    const thrown = new Error('Fehler im Handler');
    const second = vi.fn();
    router.on('ping', () => {
      throw thrown;
    });
    router.on('ping', second);

    expect(() => transport.onMessage?.('state', encodeMessage(PING))).not.toThrow();

    expect(second).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([thrown]);
  });

  it('ohne onProtocolError wird eine Handler-Ausnahme asynchron über queueMicrotask weitergeworfen', () => {
    const queued: Array<() => void> = [];
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      queued.push(callback);
    });
    try {
      const transport = fakeTransport();
      const router = createMessageRouter(transport);
      const thrown = new Error('Fehler im Handler');
      const second = vi.fn();
      router.on('ping', () => {
        throw thrown;
      });
      router.on('ping', second);

      expect(() => transport.onMessage?.('state', encodeMessage(PING))).not.toThrow();

      expect(second).toHaveBeenCalledTimes(1);
      expect(queued).toHaveLength(1);
      expect(() => queued[0]?.()).toThrow(thrown);
    } finally {
      spy.mockRestore();
    }
  });

  it('wirft onProtocolError selbst, wird SEINE Ausnahme asynchron weitergeworfen – Geschwister-Handler laufen trotzdem (Minor 2, Runde 2)', () => {
    const queued: Array<() => void> = [];
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      queued.push(callback);
    });
    try {
      const transport = fakeTransport();
      const callbackError = new Error('Fehler im onProtocolError-Callback');
      const onProtocolError = vi.fn(() => {
        throw callbackError;
      });
      const router = createMessageRouter(transport, onProtocolError);
      const thrown = new Error('Fehler im Handler');
      const second = vi.fn();
      router.on('ping', () => {
        throw thrown;
      });
      router.on('ping', second);

      expect(() => transport.onMessage?.('state', encodeMessage(PING))).not.toThrow();

      expect(onProtocolError).toHaveBeenCalledWith(thrown);
      expect(second).toHaveBeenCalledTimes(1);
      expect(queued).toHaveLength(1);
      expect(() => queued[0]?.()).toThrow(callbackError);
    } finally {
      spy.mockRestore();
    }
  });

  it('send kodiert die Nachricht und reicht das boolean des Transports durch', () => {
    const transport = fakeTransport();
    const router = createMessageRouter(transport);

    expect(router.send('events', HELLO)).toBe(true);
    transport.accept = false;
    expect(router.send('state', PING)).toBe(false);

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.channel).toBe('events');
    expect(decodeMessage(transport.sent[0]?.data ?? new Uint8Array(0))).toEqual(HELLO);
  });

  it('übernimmt transport.onMessage – ein Transport hat genau EINEN Router', () => {
    const transport = fakeTransport();
    const earlier = vi.fn();
    transport.onMessage = earlier;
    const firstRouter = createMessageRouter(transport);
    const onFirst = vi.fn();
    firstRouter.on('ping', onFirst);
    const secondRouter = createMessageRouter(transport);
    const onSecond = vi.fn();
    secondRouter.on('ping', onSecond);

    transport.onMessage?.('state', encodeMessage(PING));

    expect(earlier).not.toHaveBeenCalled();
    expect(onFirst).not.toHaveBeenCalled();
    expect(onSecond).toHaveBeenCalledTimes(1);
  });
});
