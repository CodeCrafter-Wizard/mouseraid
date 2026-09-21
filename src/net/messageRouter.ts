import { decodeMessage, encodeMessage, type NetMessage } from './protocol';
import type { Channel, Transport } from './transport';

export interface MessageRouter {
  /** Registriert einen Handler für genau einen Nachrichtentyp. @returns Funktion, die ihn wieder abmeldet. */
  on<T extends NetMessage['type']>(
    type: T,
    handler: (message: Extract<NetMessage, { type: T }>, channel: Channel) => void,
  ): () => void;
  /** Kodiert die Nachricht und sendet sie. @returns das boolean von `transport.send`. */
  send(channel: Channel, message: NetMessage): boolean;
}

type AnyHandler = (message: NetMessage, channel: Channel) => void;

/**
 * NetMessage-Dispatch über einem Transport.
 *
 * Der Router ÜBERNIMMT `transport.onMessage` – ein Transport hat deshalb genau EINEN Router; ein
 * zweiter `createMessageRouter` auf demselben Transport hängt den ersten still ab.
 *
 * Nicht dekodierbare Bytes gehen an `onProtocolError` und werden sonst verworfen: die Gegenstelle
 * darf den Transport nie zum Werfen bringen. Eine Ausnahme aus einem HANDLER ist dagegen ein eigener
 * Programmfehler – sie läuft durch (und landet so im Fehler-Panel), statt als Protokollfehler
 * getarnt zu werden.
 */
export function createMessageRouter(transport: Transport, onProtocolError?: (error: unknown) => void): MessageRouter {
  const handlers = new Map<NetMessage['type'], Set<AnyHandler>>();

  transport.onMessage = (channel, data) => {
    let message: NetMessage;
    try {
      message = decodeMessage(data);
    } catch (error) {
      onProtocolError?.(error);
      return;
    }
    const registered = handlers.get(message.type);
    if (registered === undefined) return;
    // Über eine Kopie laufen: Handler dürfen sich während der Zustellung abmelden.
    for (const handler of [...registered]) {
      if (registered.has(handler)) handler(message, channel);
    }
  };

  return {
    on(type, handler) {
      const entry = handler as AnyHandler;
      let registered = handlers.get(type);
      if (registered === undefined) {
        registered = new Set();
        handlers.set(type, registered);
      }
      registered.add(entry);
      return () => {
        handlers.get(type)?.delete(entry);
      };
    },
    send(channel, message) {
      return transport.send(channel, encodeMessage(message));
    },
  };
}
