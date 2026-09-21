import type { Channel, Transport, TransportState } from './transport';

const CHANNEL_PREFIX = 'maeusebau-lab-';
const SYN_INTERVAL_MS = 250;

type Envelope =
  | { to: string; from: string; kind: 'syn' | 'ack' | 'bye' }
  | { to: string; from: string; kind: 'data'; channel: Channel; data: Uint8Array };

type Incoming = { kind: 'syn' | 'ack' | 'bye' } | { kind: 'data'; channel: Channel; data: Uint8Array };

/** Prüft Adresse und Form. Auf dem Bus kann alles Mögliche liegen – Unpassendes wird still ignoriert. */
function readEnvelope(raw: unknown, selfId: string, peerId: string): Incoming | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { to, from, kind, channel, data } = raw as Record<string, unknown>;
  if (to !== selfId || from !== peerId) return null;
  if (kind === 'syn' || kind === 'ack' || kind === 'bye') return { kind };
  if (kind !== 'data' || (channel !== 'state' && channel !== 'events') || !(data instanceof Uint8Array)) return null;
  return { kind, channel, data };
}

/**
 * Transport über `BroadcastChannel` – für Entwicklung und den Zwei-Tab-E2E-Test, ohne WebRTC.
 * Läuft auch in Node (dort hält der offene Kanal die Ereignisschleife am Leben → immer `close()`).
 *
 * Handshake: jede Seite sendet sofort `syn` und wiederholt es alle 250 ms, bis sie offen ist; JEDES
 * `syn` wird mit `ack` beantwortet – so bekommt auch ein Nachzügler seine Antwort. Geöffnet wird beim
 * ersten gültigen Umschlag der Gegenstelle (`syn`, `ack` oder `data`): er beweist, dass sie zuhört.
 * `close()` sendet `bye`; die Gegenstelle wird dadurch `closed`. `closed` ist endgültig.
 *
 * Beide Kanäle laufen über denselben Bus und sind hier zuverlässig und geordnet – Verlust auf
 * `state` lässt sich nur mit echtem WebRTC messen.
 */
export function createBroadcastTransport(options: { room: string; selfId: string; peerId: string }): Transport {
  const { room, selfId, peerId } = options;
  const bus = new BroadcastChannel(CHANNEL_PREFIX + room);
  let state: TransportState = 'connecting';
  let synTimer: ReturnType<typeof setInterval> | null = null;

  const post = (envelope: Envelope): void => bus.postMessage(envelope);

  function stopSyn(): void {
    if (synTimer !== null) clearInterval(synTimer);
    synTimer = null;
  }

  function setState(next: TransportState): void {
    state = next;
    transport.onStateChange?.(next);
  }

  function shutDown(): void {
    stopSyn();
    bus.onmessage = null;
    bus.close();
    setState('closed');
  }

  const transport: Transport = {
    peerId,
    get state() {
      return state;
    },
    onMessage: null,
    onStateChange: null,
    send(channel, data) {
      if (state !== 'open') return false;
      // slice(): nur die Bytes der Sicht klonen, nicht den ganzen Puffer dahinter.
      post({ to: peerId, from: selfId, kind: 'data', channel, data: data.slice() });
      return true;
    },
    close() {
      if (state === 'closed') return;
      post({ to: peerId, from: selfId, kind: 'bye' });
      shutDown();
    },
  };

  bus.onmessage = (event: MessageEvent) => {
    const incoming = readEnvelope(event.data, selfId, peerId);
    if (incoming === null) return;
    if (incoming.kind === 'bye') {
      shutDown();
      return;
    }
    // Erst antworten, dann öffnen: ein im onStateChange('open') gesendetes Paket läuft so HINTER dem ack.
    if (incoming.kind === 'syn') post({ to: peerId, from: selfId, kind: 'ack' });
    if (state === 'connecting') {
      stopSyn();
      setState('open');
    }
    if (incoming.kind === 'data' && state === 'open') transport.onMessage?.(incoming.channel, incoming.data);
  };

  const sendSyn = (): void => post({ to: peerId, from: selfId, kind: 'syn' });
  sendSyn();
  synTimer = setInterval(sendSyn, SYN_INTERVAL_MS);
  return transport;
}
