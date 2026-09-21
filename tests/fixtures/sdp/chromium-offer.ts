import { fakeFingerprint, sdpFromLines } from './fakeValues';

// Zeilenstruktur 1:1 aus Headless-Chromium 153 erfasst (nur DataChannels, negotiated-IDs 0/1,
// iceServers: []). Variante „Kamera erlaubt": Host-Kandidaten mit IP-Adressen, UDP und TCP.
// Session-ID, Adressen, Ports, Foundations, ufrag, pwd und Fingerprint sind erfunden.
export const chromiumOffer = sdpFromLines([
  'v=0',
  'o=- 1000000000000000001 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 50001 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.0.2.10',
  'a=candidate:1111111111 1 udp 2121998079 192.0.2.10 50001 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:2222222222 1 udp 2122265343 2001:db8:1::10 50002 typ host generation 0 network-id 2 network-cost 10',
  'a=candidate:3333333333 1 tcp 1518018303 192.0.2.10 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
  'a=candidate:4444444444 1 tcp 1518285567 2001:db8:1::10 9 typ host tcptype active generation 0 network-id 2 network-cost 10',
  'a=ice-ufrag:FAKE',
  'a=ice-pwd:FAKEpwdFAKEpwdFAKEpwd012',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${fakeFingerprint(0x00)}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
]);
