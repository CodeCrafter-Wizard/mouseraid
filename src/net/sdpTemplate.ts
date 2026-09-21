// SDP-Text eines reinen DataChannel-Angebots bzw. einer Antwort aus den sitzungsspezifischen
// Teilen. Die Zeilenfolge entspricht dem, was Chromium selbst erzeugt (erfasst in M1, Task 3) –
// ohne die beiden Zeilen, die nur für Medienspuren gelten (extmap-allow-mixed, msid-semantic).

export interface SdpParts {
  sessionId: number;
  ufrag: string;
  pwd: string;
  /** sha-256 als "AB:CD:…" in Großbuchstaben. */
  fingerprint: string;
  setup: 'actpass' | 'active' | 'passive';
  sctpPort: number;
  maxMessageSize: number | null;
  /** Jeweils der Text nach "a=candidate:". */
  candidates: string[];
}

/** CRLF-Zeilenenden, endet mit CRLF. Port 9 / 0.0.0.0 sind die üblichen Platzhalter – die Kandidaten zählen. */
export function renderSdp(parts: SdpParts): string {
  const lines = [
    'v=0',
    `o=- ${parts.sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...parts.candidates.map((candidate) => `a=candidate:${candidate}`),
    `a=ice-ufrag:${parts.ufrag}`,
    `a=ice-pwd:${parts.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${parts.fingerprint}`,
    `a=setup:${parts.setup}`,
    'a=mid:0',
    `a=sctp-port:${parts.sctpPort}`,
  ];
  if (parts.maxMessageSize !== null) lines.push(`a=max-message-size:${parts.maxMessageSize}`);
  return `${lines.join('\r\n')}\r\n`;
}
