/**
 * Transport-Vertrag: zwei logische Kanäle zu genau EINER Gegenstelle.
 *
 * - `state`  – unzuverlässig, ungeordnet (WebRTC: `{ordered:false, maxRetransmits:0}`): Pakete dürfen
 *   fehlen, doppelt oder in falscher Reihenfolge ankommen.
 * - `events` – zuverlässig und geordnet (WebRTC: `{ordered:true}`).
 *
 * Diese Datei enthält nur Typen. Implementierungen: `rtcTransport.ts` (WebRTC),
 * `broadcastTransport.ts` (Dev/E2E) und `tests/helpers/memoryTransport.ts` (Unit-Tests).
 */
export type Channel = 'state' | 'events';

/** `closed` und `failed` sind Endzustände – ein Transport wird nie wieder `open`. */
export type TransportState = 'connecting' | 'open' | 'closed' | 'failed';

export interface Transport {
  readonly peerId: string;
  readonly state: TransportState;
  /** @returns `false`, wenn nicht offen oder der Sendepuffer voll ist – es wird NICHT geworfen. */
  send(channel: Channel, data: Uint8Array): boolean;
  /** Genau ein Abnehmer. `createMessageRouter` belegt dieses Feld. */
  onMessage: ((channel: Channel, data: Uint8Array) => void) | null;
  onStateChange: ((state: TransportState) => void) | null;
  close(): void;
}
