import { parseCandidate } from './candidates';
import type { Timeline } from './timeline';
import type { Channel, Transport, TransportState } from './transport';

export interface GatherResult {
  sdp: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RtcPeer {
  readonly pc: RTCPeerConnection;
  readonly transport: Transport;
  createOffer(): Promise<GatherResult>;
  acceptOffer(remoteSdp: string): Promise<GatherResult>;
  acceptAnswer(remoteSdp: string): Promise<void>;
  close(): void;
}

/** Feste IDs + `negotiated: true`: beide Seiten legen dieselben Kanäle an, im SDP steht davon nichts. */
const CHANNEL_SPECS: readonly { name: Channel; init: RTCDataChannelInit }[] = [
  { name: 'state', init: { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 } },
  { name: 'events', init: { negotiated: true, id: 1, ordered: true } },
];
const MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_GATHER_TIMEOUT_MS = 2500;

/**
 * Eine PeerConnection ohne STUN/TURN mit den zwei Spielkanälen. Kein Trickle-ICE: `createOffer` und
 * `acceptOffer` liefern das lokale SDP erst, wenn das Gathering fertig ist (oder der Timeout greift).
 */
export function createRtcPeer(options: { peerId: string; timeline: Timeline; gatherTimeoutMs?: number; now?: () => number }): RtcPeer {
  const { timeline } = options;
  const now = options.now ?? (() => performance.now());
  const gatherTimeoutMs = options.gatherTimeoutMs ?? DEFAULT_GATHER_TIMEOUT_MS;

  const pc = new RTCPeerConnection({ iceServers: [] });
  timeline.push('pc-created');

  let state: TransportState = 'connecting';
  const channels = new Map<Channel, RTCDataChannel>();

  function setState(next: TransportState): void {
    if (state === next || state === 'closed') return;
    state = next;
    transport.onStateChange?.(next);
  }

  // Auf einer geschlossenen PeerConnection bleiben createOffer/setLocalDescription laut Spezifikation für
  // immer unentschieden. Deshalb läuft jeder Handshake-Schritt im Wettlauf mit diesem Abbruch-Versprechen.
  let abort: (error: DOMException) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = reject;
  });
  aborted.catch(() => undefined); // nie als unhandledrejection im Fehler-Panel landen
  const untilClosed = <T>(work: Promise<T>): Promise<T> => Promise.race([work, aborted]);

  function close(): void {
    for (const dc of channels.values()) dc.close();
    pc.close();
    setState('closed');
    abort(new DOMException('peer closed', 'AbortError'));
  }

  const transport: Transport = {
    peerId: options.peerId,
    get state() {
      return state;
    },
    onMessage: null,
    onStateChange: null,
    send(channel, data) {
      const dc = channels.get(channel);
      if (state !== 'open' || dc === undefined || dc.readyState !== 'open') return false;
      if (dc.bufferedAmount > MAX_BUFFERED_BYTES) return false;
      try {
        // Kopie in einen frischen ArrayBuffer: `send` nimmt keine Sicht auf einen SharedArrayBuffer.
        dc.send(new Uint8Array(data));
        return true;
      } catch {
        return false;
      }
    },
    close,
  };

  // Kanäle VOR createOffer/acceptOffer anlegen – sonst enthält das SDP keine m=application-Sektion.
  for (const spec of CHANNEL_SPECS) {
    const dc = pc.createDataChannel(spec.name, spec.init);
    dc.binaryType = 'arraybuffer';
    channels.set(spec.name, dc);
    dc.addEventListener('open', () => {
      timeline.push(`channel-open:${spec.name}`);
      const allOpen = [...channels.values()].every((channel) => channel.readyState === 'open');
      if (allOpen && state === 'connecting') setState('open');
    });
    dc.addEventListener('close', () => {
      timeline.push(`channel-close:${spec.name}`);
      if (state === 'open') setState('closed');
    });
    dc.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) transport.onMessage?.(spec.name, new Uint8Array(event.data));
    });
  }

  pc.addEventListener('icegatheringstatechange', () => timeline.push(`gathering:${pc.iceGatheringState}`));
  pc.addEventListener('connectionstatechange', () => {
    timeline.push(`connection:${pc.connectionState}`);
    // Gemessen (Chromium 153): kommt ICE nie zustande, bleibt iceConnectionState nach ~15 s auf 'disconnected'
    // stehen und NUR connectionState wird 'failed'. Ohne diese Zeile gäbe es dort nie ein 'failed'.
    if (pc.connectionState === 'failed') setState('failed');
  });
  pc.addEventListener('iceconnectionstatechange', () => {
    timeline.push(`ice:${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed') setState('failed');
  });
  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate === null || event.candidate.candidate === '') return;
    // Nur Typ/Familie – die Adresse gehört nie in die Zeitleiste (Reports werden geteilt).
    const parsed = parseCandidate(event.candidate.candidate);
    timeline.push('candidate', parsed === null ? 'unparsed' : `${parsed.type}/${parsed.family}`);
  });

  /** @returns true, wenn der Timeout das Gathering beendet hat. */
  function waitForGathering(): Promise<boolean> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve(false);
        return;
      }
      const finish = (timedOut: boolean): void => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve(timedOut);
      };
      const onChange = (): void => {
        if (pc.iceGatheringState === 'complete') finish(false);
      };
      const timer = setTimeout(() => finish(true), gatherTimeoutMs);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  async function gather(description: RTCLocalSessionDescriptionInit): Promise<GatherResult> {
    const startedAt = now();
    await pc.setLocalDescription(description);
    const timedOut = await waitForGathering();
    return { sdp: pc.localDescription?.sdp ?? '', durationMs: Math.round(now() - startedAt), timedOut };
  }

  return {
    pc,
    transport,
    async createOffer() {
      return untilClosed(pc.createOffer().then(gather));
    },
    async acceptOffer(remoteSdp) {
      return untilClosed(
        pc
          .setRemoteDescription({ type: 'offer', sdp: remoteSdp })
          .then(() => pc.createAnswer())
          .then(gather),
      );
    },
    async acceptAnswer(remoteSdp) {
      return untilClosed(pc.setRemoteDescription({ type: 'answer', sdp: remoteSdp }));
    },
    close,
  };
}
