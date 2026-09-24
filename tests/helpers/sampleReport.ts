import type { LabReport } from '../../src/lab/report';
import type { AddressFamily, AddressScope, ParsedCandidate } from '../../src/net/candidates';

// Vollständig befüllter Beispiel-Report für Tests (Report-Modell, Lab-UI, Selbsttest).
// Nur Dokumentationsadressen (RFC 5737 / RFC 3849). Der mDNS-Name wird zur Laufzeit
// zusammengesetzt, damit der Datenschutz-Wächter (tests/node/privacy-guard.test.ts) nicht anschlägt.
const HOST_IPV4 = '192.0.2.10';
const SECOND_IPV4 = '198.51.100.7';
const HOST_IPV6 = '2001:db8::10';
const MDNS_NAME = `${['11111111', '1111', '1111', '1111', '111111111111'].join('-')}.local`;

/** Alle Adressen, die im Beispiel-Report vorkommen (in der Reihenfolge ihres ersten Auftretens). */
export function sampleAddresses(): string[] {
  return [HOST_IPV4, HOST_IPV6, MDNS_NAME, SECOND_IPV4];
}

/** Baut einen Kandidaten so, wie ihn `parseCandidate` liefern würde (raw = Text nach "a=candidate:"). */
export function sampleCandidate(
  foundation: number,
  protocol: 'udp' | 'tcp',
  address: string,
  port: number,
  family: AddressFamily,
  scope: AddressScope,
  extension = '',
): ParsedCandidate {
  const priority = 2122260223 - foundation;
  const tcpType = protocol === 'tcp' ? ' tcptype active' : '';
  return {
    raw: `${foundation} 1 ${protocol} ${priority} ${address} ${port} typ host${tcpType}${extension} generation 0 network-cost 10`,
    foundation: String(foundation),
    component: 1,
    protocol,
    priority,
    address,
    port,
    type: 'host',
    family,
    scope,
  };
}

/** Frisches Objekt pro Aufruf; `overrides` ersetzt Felder der obersten Ebene. */
export function sampleReport(overrides: Partial<LabReport> = {}): LabReport {
  const base: LabReport = {
    id: 'r-2026-09-21-0001',
    createdAt: '2026-09-21T10:00:00.000Z',
    buildId: 'abc12345',
    protoV: 1,
    cell: { role: 'host', hotspotOwner: 'dieses-geraet', camera: 'an', path: 'text', device: 'Pixel-A' },
    environment: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      engine: 'chromium',
      displayMode: 'standalone',
      secureContext: true,
      online: false,
      swControlled: true,
      buildId: 'abc12345',
      features: {
        rtc: true,
        compressionStream: true,
        wakeLock: true,
        barcodeDetector: true,
        barcodeFormats: ['qr_code', 'ean_13'],
        storagePersist: true,
        shareText: true,
        clipboardWrite: true,
      },
    },
    permissions: { camera: 'granted', localNetwork: 'prompt', loopbackNetwork: 'unsupported' },
    gumCalledThisSession: true,
    gather: {
      durationMs: 118.4,
      timedOut: false,
      gathered: [
        sampleCandidate(1001, 'udp', HOST_IPV4, 50001, 'ipv4', 'global'),
        sampleCandidate(1002, 'udp', HOST_IPV6, 50002, 'ipv6', 'global'),
        sampleCandidate(1003, 'udp', MDNS_NAME, 50003, 'mdns', 'mdns'),
        sampleCandidate(1004, 'tcp', HOST_IPV4, 9, 'ipv4', 'global'),
        sampleCandidate(1005, 'udp', SECOND_IPV4, 50004, 'ipv4', 'global'),
      ],
      transmitted: 5,
    },
    payloadSizes: { sdpBytes: 912, minimisedBytes: 498, packedBytes: 371, textChars: 501, compressed: true },
    timeline: [
      { tMs: 0, kind: 'pc-created', detail: '' },
      { tMs: 3.2, kind: 'gathering:gathering', detail: '' },
      { tMs: 14.6, kind: 'candidate', detail: 'host/ipv4' },
      { tMs: 15.1, kind: 'candidate', detail: 'host/ipv6' },
      { tMs: 118.4, kind: 'gathering:complete', detail: '' },
      { tMs: 5230, kind: 'ice:checking', detail: '' },
      { tMs: 5262.5, kind: 'ice:connected', detail: '' },
      { tMs: 5290, kind: 'channel-open:state', detail: '' },
      { tMs: 5291, kind: 'channel-open:events', detail: '' },
    ],
    selectedPair: {
      localType: 'host',
      localProtocol: 'udp',
      localFamily: 'ipv4',
      localScope: 'global',
      remoteType: 'host',
      remoteFamily: 'ipv4',
      remoteScope: 'global',
      currentRttMs: 4,
    },
    sctpMaxMessageSize: 262144,
    hello: { remoteProtoV: 1, remoteBuildId: 'abc12345', versionMatch: true },
    ping: {
      state: { sent: 200, received: 197, lossPct: 1.5, minMs: 2.1, medianMs: 3.4, p95Ms: 9.25, maxMs: 31, outOfOrder: 2 },
      events: { sent: 200, received: 200, lossPct: 0, minMs: 2.3, medianMs: 3.6, p95Ms: 8, maxMs: 27.5, outOfOrder: 0 },
    },
    pairing: {
      offerShownAt: 0,
      offerScannedMs: 4200,
      answerShownAt: 5100,
      answerScannedMs: 8400,
      connectedMs: 11_000,
      projectedLobbyFullMs: 30_000,
    },
    qr: { backend: 'worker', offerChars: 704, answerChars: 521, decodeLatencyMs: 24.5, attempts: 7 },
    lockTest: null,
    failures: [],
    valid: true,
    invalidReason: null,
    notes: 'Beide Geräte im selben WLAN, Abstand 2 m.',
  };
  return { ...base, ...overrides };
}
