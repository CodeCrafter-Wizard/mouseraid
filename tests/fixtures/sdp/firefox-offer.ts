import { fakeFingerprint, fakeMdnsName, sdpFromLines } from './fakeValues';

// Firefox-Stil – von Hand nach dem bekannten Aufbau von Firefox-SDPs geschrieben, NICHT erfasst
// (Playwright-Firefox ist in diesem Projekt nicht installiert). Unterschiede zu Chromium, die der
// Codec aushalten muss: Fingerprint und ice-options auf SESSION-Ebene, Kandidaten VOR ufrag/pwd,
// Transport groß geschrieben, a=end-of-candidates, anderes max-message-size. Alle Werte sind erfunden.
export const firefoxOffer = sdpFromLines([
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 3000000000000000003 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=sendrecv',
  `a=fingerprint:sha-256 ${fakeFingerprint(0x40)}`,
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 50021 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 198.51.100.7',
  'a=candidate:0 1 UDP 2122252543 198.51.100.7 50021 typ host',
  'a=candidate:1 1 UDP 2122187007 2001:db8:2::7 50022 typ host',
  `a=candidate:2 1 UDP 2122121471 ${fakeMdnsName('3')} 50023 typ host`,
  'a=candidate:3 1 TCP 2105524479 198.51.100.7 9 typ host tcptype active',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:fa4e00fa4e00fa4e00fa4e00fa4e00fa',
  'a=ice-ufrag:fa4e0001',
  'a=mid:0',
  'a=setup:actpass',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
]);
