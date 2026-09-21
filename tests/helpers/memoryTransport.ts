import type { Channel, Transport, TransportState } from '../../src/net/transport';

/** Ein Paket auf dem Weg zur Gegenstelle – Eingabe für die deterministischen Netz-Funktionen unten. */
export interface MemoryPacket {
  /** Seite, die gesendet hat. */
  from: 'a' | 'b';
  channel: Channel;
  /** Laufende Nummer je Absender UND Kanal, ab 0 (zählt auch verworfene Pakete). */
  index: number;
  /** Kopie der gesendeten Bytes – darf z. B. mit `decodeMessage` untersucht werden. */
  data: Uint8Array;
}

export interface MemoryTransportOptions {
  /** `peerId`, unter der Seite b ihre Gegenstelle a sieht. Standard `'a'`. */
  idA?: string;
  /** `peerId`, unter der Seite a ihre Gegenstelle b sieht. Standard `'b'`. */
  idB?: string;
  /** Laufzeit je Paket in ms. Standard 0 – zugestellt wird trotzdem nie synchron, sondern per `setTimeout`. */
  latencyMs?: (packet: MemoryPacket) => number;
  /** `true` = das Paket geht unterwegs verloren (`send` meldet trotzdem `true`). Standard: nie. */
  drop?: (packet: MemoryPacket) => boolean;
  /**
   * `true` = das Paket wird zurückgehalten und erst direkt NACH dem nächsten Paket desselben Absenders
   * und Kanals zugestellt (es wird überholt). Folgt kein Paket mehr, kommt es nie an. Standard: nie.
   */
  reorder?: (packet: MemoryPacket) => boolean;
}

export interface MemoryTransportPair {
  a: Transport;
  b: Transport;
}

type Side = 'a' | 'b';

/**
 * Zwei verbundene Transports im selben Prozess – für Unit-Tests mit Vitest-Fake-Timern.
 *
 * Beide Seiten starten `open`. Laufzeit, Verlust und Umordnung kommen aus reinen Funktionen des
 * Pakets (kein `Math.random`), damit jeder Test exakt wiederholbar ist. Der Helfer unterscheidet die
 * Kanäle NICHT: wer `events` realistisch (zuverlässig, geordnet) haben will, lässt `drop`/`reorder`
 * für `packet.channel === 'events'` `false` liefern. `close()` schließt beide Seiten sofort.
 *
 * Fake-Timer-Falle: ein `setTimeout(…, 0)`, der WÄHREND eines Timer-Callbacks entsteht, feuert unter
 * `vi.useFakeTimers()` erst 1 ms später (Regel von @sinonjs/fake-timers). Wer exakte Zeitpunkte prüft,
 * gibt deshalb eine `latencyMs` ≥ 1 an.
 */
export function createMemoryTransportPair(options: MemoryTransportOptions = {}): MemoryTransportPair {
  const latencyMs = options.latencyMs ?? (() => 0);
  const drop = options.drop ?? (() => false);
  const reorder = options.reorder ?? (() => false);
  const states: Record<Side, TransportState> = { a: 'open', b: 'open' };
  const ends: Partial<Record<Side, Transport>> = {};

  function setState(side: Side, next: TransportState): void {
    if (states[side] === next) return;
    states[side] = next;
    ends[side]?.onStateChange?.(next);
  }

  function createEnd(side: Side, other: Side, peerId: string): Transport {
    const counters: Record<Channel, number> = { state: 0, events: 0 };
    const held: Record<Channel, Uint8Array[]> = { state: [], events: [] };
    const deliver = (channel: Channel, data: Uint8Array): void => {
      if (states[other] === 'open') ends[other]?.onMessage?.(channel, data);
    };
    return {
      peerId,
      get state() {
        return states[side];
      },
      onMessage: null,
      onStateChange: null,
      send(channel, data) {
        if (states[side] !== 'open') return false;
        const packet: MemoryPacket = { from: side, channel, index: counters[channel], data: data.slice() };
        counters[channel] += 1;
        if (drop(packet)) return true;
        if (reorder(packet)) {
          held[channel].push(packet.data);
          return true;
        }
        const overtaken = held[channel].splice(0);
        setTimeout(() => {
          deliver(channel, packet.data);
          for (const late of overtaken) deliver(channel, late);
        }, latencyMs(packet));
        return true;
      },
      close() {
        setState(side, 'closed');
        setState(other, 'closed');
      },
    };
  }

  const a = createEnd('a', 'b', options.idB ?? 'b');
  const b = createEnd('b', 'a', options.idA ?? 'a');
  ends.a = a;
  ends.b = b;
  return { a, b };
}
