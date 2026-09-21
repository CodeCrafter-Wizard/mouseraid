import { candidatesFromSdp } from './candidates';
import type { FailureCode } from './failureCodes';
import { createRtcPeer, type GatherResult, type RtcPeer } from './rtcTransport';
import { CODEC_VERSION, decodeDesc, encodeDesc, minimise, rebuildSdp, type PayloadSizes, type SdpRole, type SessionDesc } from './sdpCodec';
import type { Timeline } from './timeline';

export interface HandshakeArtifacts {
  payload: string;
  sizes: PayloadSizes;
  desc: SessionDesc;
  localSdp: string;
  gather: { durationMs: number; timedOut: boolean; gathered: number; transmitted: number };
}

/** Fehlschlag beim Code-Austausch. `message` ist technisch (englisch) – den Nutzertext liefert `S.failures`. */
export class HandshakeError extends Error {
  readonly failure: FailureCode;

  constructor(failure: FailureCode, message: string) {
    super(message);
    this.name = 'HandshakeError';
    this.failure = failure;
  }
}

export interface ConnectorDeps {
  protoV: number;
  makeTimeline: () => Timeline;
  randomNonce: () => number;
}

export interface HostSlotEntry {
  slot: number;
  peer: RtcPeer;
  timeline: Timeline;
  offer: HandshakeArtifacts;
  remoteSdp: string | null;
}

export interface HostLobby {
  createOffer(slot: number): Promise<HandshakeArtifacts>;
  acceptAnswer(slot: number, payloadText: string): Promise<RtcPeer>;
  entries(): ReadonlyMap<number, HostSlotEntry>;
  closeSlot(slot: number): void;
  closeAll(): void;
}

export interface ClientJoin {
  acceptOffer(payloadText: string): Promise<HandshakeArtifacts>;
  readonly peer: RtcPeer | null;
  readonly timeline: Timeline | null;
  readonly slot: number | null;
  readonly remoteSdp: string | null;
  close(): void;
}

const MIN_SLOT = 1;
const MAX_SLOT = 3;

const isSlot = (value: number): boolean => Number.isInteger(value) && value >= MIN_SLOT && value <= MAX_SLOT;

/** Alles, was beim Entschlüsseln oder Anwenden eines Codes schiefgeht, ist aus Nutzersicht „Code ungültig" = F5. */
function toF5(what: string, error: unknown): HandshakeError {
  if (error instanceof HandshakeError) return error;
  return new HandshakeError('F5', `${what}: ${error instanceof Error ? error.message : String(error)}`);
}

/** Der Aufrufer hat den Vorgang selbst überholt (Slot geschlossen/neu belegt) – kein Befund, die UI ignoriert `AbortError`. */
const superseded = (what: string): DOMException => new DOMException(`${what} was superseded`, 'AbortError');

/** `RtcPeer` bricht laufende Handshake-Schritte mit `AbortError` ab, sobald er geschlossen wird. */
const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

function newPeer(peerId: string, timeline: Timeline): RtcPeer {
  try {
    return createRtcPeer({ peerId, timeline });
  } catch (error) {
    throw new HandshakeError('F6', `RTCPeerConnection unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function decode(payloadText: string, role: SdpRole, protoV: number): Promise<SessionDesc> {
  let desc: SessionDesc;
  try {
    desc = await decodeDesc(payloadText);
  } catch (error) {
    throw toF5(`decode ${role}`, error);
  }
  if (desc.role !== role) throw new HandshakeError('F5', `wrong role: expected ${role}, got ${desc.role}`);
  if (desc.codecV !== CODEC_VERSION) throw new HandshakeError('F5', `codec version mismatch: ${desc.codecV} != ${CODEC_VERSION}`);
  if (desc.protoV !== protoV) throw new HandshakeError('F5', `protocol version mismatch: ${desc.protoV} != ${protoV}`);
  if (!isSlot(desc.slot)) throw new HandshakeError('F5', `slot out of range: ${desc.slot}`);
  return desc;
}

/** Lokales SDP → minimierte Beschreibung → Payload-Text samt Größen und „gesammelt vs. übertragen". */
async function buildArtifacts(
  gather: GatherResult,
  meta: { protoV: number; role: SdpRole; slot: number; nonce: number },
): Promise<HandshakeArtifacts> {
  const desc = minimise(gather.sdp, meta);
  const encoded = await encodeDesc(desc);
  return {
    payload: encoded.text,
    sizes: { sdpBytes: new TextEncoder().encode(gather.sdp).length, ...encoded.sizes },
    desc,
    localSdp: gather.sdp,
    gather: {
      durationMs: gather.durationMs,
      timedOut: gather.timedOut,
      gathered: candidatesFromSdp(gather.sdp).length,
      transmitted: desc.candidates.length,
    },
  };
}

/** Host-Seite: ein RtcPeer je Slot 1–3; weitere Spieler lassen sich hinzufügen, während andere Slots schon laufen. */
export function createHostLobby(deps: ConnectorDeps): HostLobby {
  const slots = new Map<number, HostSlotEntry>();
  /** Peers, deren Gathering noch läuft – damit `closeSlot` auch sie erreicht. */
  const gathering = new Map<number, RtcPeer>();

  function closeSlot(slot: number): void {
    gathering.get(slot)?.close();
    gathering.delete(slot);
    slots.get(slot)?.peer.close();
    slots.delete(slot);
  }

  return {
    async createOffer(slot) {
      if (!isSlot(slot)) throw new RangeError(`slot must be ${MIN_SLOT}..${MAX_SLOT}, got ${slot}`);
      closeSlot(slot);
      const timeline = deps.makeTimeline();
      const peer = newPeer(`slot-${slot}`, timeline);
      gathering.set(slot, peer);
      try {
        const gather = await peer.createOffer();
        const offer = await buildArtifacts(gather, { protoV: deps.protoV, role: 'offer', slot, nonce: deps.randomNonce() });
        if (gathering.get(slot) !== peer) throw superseded(`offer for slot ${slot}`);
        gathering.delete(slot);
        slots.set(slot, { slot, peer, timeline, offer, remoteSdp: null });
        return offer;
      } catch (error) {
        peer.close();
        const current = gathering.get(slot) === peer;
        if (current) gathering.delete(slot); // den Eintrag eines NEUEREN Versuchs nie anfassen
        if (!current || isAbort(error)) throw superseded(`offer for slot ${slot}`);
        throw toF5('create offer', error);
      }
    },

    async acceptAnswer(slot, payloadText) {
      const entry = slots.get(slot);
      if (entry === undefined) throw new HandshakeError('F5', `no pending offer for slot ${slot}`);
      if (entry.remoteSdp !== null) throw new HandshakeError('F5', `slot ${slot} already has an answer`);
      const desc = await decode(payloadText, 'answer', deps.protoV);
      if (desc.slot !== slot) throw new HandshakeError('F5', `answer is for slot ${desc.slot}, expected ${slot}`);
      if (desc.nonce !== entry.offer.desc.nonce) throw new HandshakeError('F5', 'answer belongs to a different offer (nonce mismatch)');
      if (slots.get(slot) !== entry) throw superseded(`answer for slot ${slot}`);
      try {
        // `rebuildSdp` steht mit im try, damit auch ein Fehler beim Zusammenbauen als F5 herauskommt –
        // genau wie auf der Client-Seite in `acceptOffer`.
        const remoteSdp = rebuildSdp(desc);
        await entry.peer.acceptAnswer(remoteSdp);
        entry.remoteSdp = remoteSdp;
      } catch (error) {
        if (slots.get(slot) !== entry || isAbort(error)) throw superseded(`answer for slot ${slot}`);
        throw toF5('apply answer', error);
      }
      return entry.peer;
    },

    entries: () => slots,
    closeSlot,
    closeAll() {
      for (const slot of [...gathering.keys(), ...slots.keys()]) closeSlot(slot);
    },
  };
}

/** Client-Seite: nimmt ein Angebot an; ein erneutes `acceptOffer` ersetzt den vorigen Versuch. */
export function createClientJoin(deps: ConnectorDeps): ClientJoin {
  let peer: RtcPeer | null = null;
  let timeline: Timeline | null = null;
  let slot: number | null = null;
  let remoteSdp: string | null = null;
  /**
   * Nummer des jüngsten Annahme-Versuchs. Ein Versuch, dessen Nummer nicht mehr die aktuelle ist, wurde
   * überholt. Nötig, weil `acceptOffer` zuerst ENTSCHLÜSSELT und den Peer erst danach anlegt: in diesem
   * Fenster gibt es noch keinen Peer, den `close()` schließen könnte.
   */
  let generation = 0;

  /** Räumt den laufenden Versuch ab, OHNE zu überholen – der interne Aufräumschritt. */
  function reset(): void {
    peer?.close();
    peer = null;
    timeline = null;
    slot = null;
    remoteSdp = null;
  }

  /** Öffentliches Schließen: überholt zusätzlich einen Versuch, der noch entschlüsselt. */
  function close(): void {
    generation += 1;
    reset();
  }

  return {
    async acceptOffer(payloadText) {
      const attempt = (generation += 1);
      let desc: SessionDesc;
      try {
        desc = await decode(payloadText, 'offer', deps.protoV);
      } catch (error) {
        // Ein überholter Versuch darf der Oberfläche nie ein F5 melden – der Nutzer hat ihn selbst abgelöst.
        if (attempt !== generation) throw superseded('answer');
        throw error;
      }
      if (attempt !== generation) throw superseded('answer');
      reset();
      const ownTimeline = deps.makeTimeline();
      const ownPeer = newPeer('host', ownTimeline);
      peer = ownPeer;
      timeline = ownTimeline;
      slot = desc.slot;
      try {
        const sdp = rebuildSdp(desc);
        const gather = await ownPeer.acceptOffer(sdp);
        // Die Antwort trägt Slot und Nonce des Angebots – daran erkennt der Host, wohin sie gehört.
        const answer = await buildArtifacts(gather, { protoV: deps.protoV, role: 'answer', slot: desc.slot, nonce: desc.nonce });
        if (peer !== ownPeer || attempt !== generation) throw superseded('answer');
        remoteSdp = sdp;
        return answer;
      } catch (error) {
        ownPeer.close();
        const current = peer === ownPeer && attempt === generation;
        if (current) reset(); // die Felder eines NEUEREN Versuchs nie anfassen
        if (!current || isAbort(error)) throw superseded('answer');
        throw toF5('apply offer', error);
      }
    },
    get peer() {
      return peer;
    },
    get timeline() {
      return timeline;
    },
    get slot() {
      return slot;
    },
    get remoteSdp() {
      return remoteSdp;
    },
    close,
  };
}
