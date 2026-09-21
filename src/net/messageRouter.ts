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
 * Reicht einen Fehler sicher an `onProtocolError` weiter. Wirft der Callback SELBST (Minor 2, Runde 2),
 * bricht das weder die Zustellung an Geschwister-Handler noch wirft es in den Transport – die Ausnahme
 * des Callbacks wird stattdessen asynchron über `queueMicrotask` weitergeworfen. Ohne Callback tut diese
 * Funktion nichts; die Aufrufstelle entscheidet selbst, was dann passiert (siehe unten).
 * @returns ob ein Callback vorhanden war (und – sicher – aufgerufen wurde).
 */
function reportProtocolError(onProtocolError: ((error: unknown) => void) | undefined, error: unknown): boolean {
  if (!onProtocolError) return false;
  try {
    onProtocolError(error);
  } catch (callbackError) {
    queueMicrotask(() => { throw callbackError; });
  }
  return true;
}

/**
 * NetMessage-Dispatch über einem Transport.
 *
 * Der Router ÜBERNIMMT `transport.onMessage` – ein Transport hat deshalb genau EINEN Router; ein
 * zweiter `createMessageRouter` auf demselben Transport hängt den ersten still ab.
 *
 * Nicht dekodierbare Bytes gehen an `onProtocolError` und werden sonst verworfen: die Gegenstelle
 * darf den Transport nie zum Werfen bringen. Jeder Handler läuft isoliert: eine Ausnahme aus einem
 * Handler stoppt die übrigen Handler NICHT und wirft nie in den Transport. `onProtocolError` erhält
 * Dekodierfehler UND Ausnahmen aus Handlern; ohne Callback werden Handler-Ausnahmen asynchron
 * weitergeworfen (`queueMicrotask`), damit sie weiterhin im globalen Fehler-Panel landen. Wirft
 * `onProtocolError` selbst, wird auch DAS nie in den Transport geworfen, sondern ebenfalls asynchron
 * weitergereicht (siehe `reportProtocolError`).
 */
export function createMessageRouter(transport: Transport, onProtocolError?: (error: unknown) => void): MessageRouter {
  const handlers = new Map<NetMessage['type'], Set<AnyHandler>>();

  transport.onMessage = (channel, data) => {
    let message: NetMessage;
    try {
      message = decodeMessage(data);
    } catch (error) {
      reportProtocolError(onProtocolError, error);
      return;
    }
    const registered = handlers.get(message.type);
    if (registered === undefined) return;
    // Über eine Kopie laufen: Handler dürfen sich während der Zustellung abmelden.
    for (const handler of [...registered]) {
      if (!registered.has(handler)) continue;
      try {
        handler(message, channel);
      } catch (error) {
        if (!reportProtocolError(onProtocolError, error)) queueMicrotask(() => { throw error; });
      }
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
