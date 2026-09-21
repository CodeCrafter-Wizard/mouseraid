import type { Channel, Transport, TransportState } from './transport';

const CHANNEL_PREFIX = 'maeusebau-lab-';
const SYN_INTERVAL_MS = 250;

type Envelope =
  | { to: string; from: string; inst: string; kind: 'syn' | 'ack' | 'bye' }
  | { to: string; from: string; inst: string; kind: 'data'; channel: Channel; data: Uint8Array };

type Incoming =
  | { kind: 'syn' | 'ack' | 'bye'; inst: string }
  | { kind: 'data'; channel: Channel; data: Uint8Array; inst: string };

/**
 * Prüft Adresse und Form. Auf dem Bus kann alles Mögliche liegen – Unpassendes wird still ignoriert.
 *
 * `inst` identifiziert die SENDENDE Transport-Instanz (Finding 2): ohne eine nichtleere `inst` ist der
 * Umschlag ungültig, auch wenn Adresse und Form sonst passen.
 */
function readEnvelope(raw: unknown, selfId: string, peerId: string): Incoming | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { to, from, kind, channel, data, inst } = raw as Record<string, unknown>;
  if (to !== selfId || from !== peerId) return null;
  if (typeof inst !== 'string' || inst.length === 0) return null;
  if (kind === 'syn' || kind === 'ack' || kind === 'bye') return { kind, inst };
  if (kind !== 'data' || (channel !== 'state' && channel !== 'events') || !(data instanceof Uint8Array)) return null;
  return { kind, channel, data, inst };
}

/**
 * Transport über `BroadcastChannel` – für Entwicklung und den Zwei-Tab-E2E-Test, ohne WebRTC.
 * Läuft auch in Node (dort hält der offene Kanal die Ereignisschleife am Leben → immer `close()`).
 *
 * Handshake: jede Seite sendet sofort `syn` und wiederholt es alle 250 ms, bis sie offen ist; JEDES
 * `syn` wird mit `ack` beantwortet – so bekommt auch ein Nachzügler seine Antwort. Geöffnet wird beim
 * ersten gültigen Handshake-Umschlag der Gegenstelle (`syn` oder `ack`): er beweist, dass sie zuhört.
 * (`data` kann eine Verbindung nie eröffnen – die Gegenstelle kann laut Protokoll ohnehin erst senden,
 * nachdem sie selbst schon offen ist, also nachdem der Handshake längst gelaufen ist.)
 * `close()` sendet `bye`; die Gegenstelle wird dadurch `closed`. `closed` ist endgültig.
 *
 * Jede Instanz erzeugt eine eigene `inst` (Finding 2). NUR Handshake-Umschläge führen eine Instanz der
 * Gegenstelle EIN: ein `syn` übernimmt seine `inst` immer (Erstkontakt ODER Neustart der Gegenstelle);
 * ein `ack` übernimmt seine `inst` nur, solange noch KEINE Instanz bekannt ist – ein `ack` einer
 * anderen Instanz, während schon eine bekannt ist, wird vollständig ignoriert. `data` führt NIE eine
 * neue Instanz ein (Finding, Runde 2): es wird nur zugestellt, wenn seine `inst` zur bekannten Instanz
 * passt, sonst still verworfen – ein Nachzügler einer alten Instanz darf weder als Live-Verkehr
 * ankommen noch (über `peerInst`) ein späteres, eigentlich fremdes `bye` legitimieren. Ein `bye` wird
 * nur befolgt, wenn seine `inst` zur zuletzt bekannten Instanz der Gegenstelle passt – ein Nachzügler-
 * `bye` einer VORHERIGEN Instanz (z. B. nach einem Tab-Reload mit denselben ids) darf eine frisch
 * übernommene Verbindung nicht mehr schließen. Ein `bye`, das ankommt, bevor überhaupt eine Instanz
 * bekannt ist, wird ebenfalls ignoriert – kann in der Praxis aber nicht vorkommen, weil jede Seite vor
 * einem `bye` immer erst ein `syn` sendet.
 *
 * Beide Kanäle laufen über denselben Bus und sind hier zuverlässig und geordnet – Verlust auf
 * `state` lässt sich nur mit echtem WebRTC messen.
 */
export function createBroadcastTransport(options: { room: string; selfId: string; peerId: string }): Transport {
  const { room, selfId, peerId } = options;
  const inst = crypto.randomUUID();
  const bus = new BroadcastChannel(CHANNEL_PREFIX + room);
  let state: TransportState = 'connecting';
  let synTimer: ReturnType<typeof setInterval> | null = null;
  let peerInst: string | null = null;

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
      post({ to: peerId, from: selfId, inst, kind: 'data', channel, data: data.slice() });
      return true;
    },
    close() {
      if (state === 'closed') return;
      post({ to: peerId, from: selfId, inst, kind: 'bye' });
      shutDown();
    },
  };

  bus.onmessage = (event: MessageEvent) => {
    const incoming = readEnvelope(event.data, selfId, peerId);
    if (incoming === null) return;

    if (incoming.kind === 'bye') {
      // Nur die Instanz, die wir zuletzt als „das ist die Gegenstelle" gesehen haben, darf uns schließen.
      if (incoming.inst === peerInst) shutDown();
      return;
    }

    if (incoming.kind === 'data') {
      // data führt NIE eine neue Instanz ein – nur zustellen, wenn sie zur bekannten Instanz passt.
      if (state === 'open' && incoming.inst === peerInst) transport.onMessage?.(incoming.channel, incoming.data);
      return;
    }

    if (incoming.kind === 'ack') {
      // Ein ack einer ANDEREN, bereits bekannten Instanz wird vollständig ignoriert – nur der
      // Erstkontakt (peerInst noch unbekannt) darf die Instanz über ein ack setzen.
      if (peerInst !== null && incoming.inst !== peerInst) return;
      peerInst = incoming.inst;
    } else {
      // syn: immer die aktuelle Instanz übernehmen (Erstkontakt ODER Neustart der Gegenstelle), dann
      // erst antworten, dann öffnen: ein im onStateChange('open') gesendetes Paket läuft so HINTER dem ack.
      peerInst = incoming.inst;
      post({ to: peerId, from: selfId, inst, kind: 'ack' });
    }

    if (state === 'connecting') {
      stopSyn();
      setState('open');
    }
  };

  const sendSyn = (): void => post({ to: peerId, from: selfId, inst, kind: 'syn' });
  sendSyn();
  synTimer = setInterval(sendSyn, SYN_INTERVAL_MS);
  return transport;
}
