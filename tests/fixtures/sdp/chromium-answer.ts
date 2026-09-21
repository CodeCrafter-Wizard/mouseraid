import { fakeFingerprint, fakeMdnsName, sdpFromLines } from './fakeValues';

// Zeilenstruktur 1:1 aus Headless-Chromium 153 erfasst (Antwort auf ein data-channel-only-Angebot).
// Variante „Kamera aus": Chrome verschleiert Host-Adressen als mDNS-Namen; m=/c= bleiben 9 / 0.0.0.0.
// Session-ID, mDNS-Namen, Ports, Foundations, ufrag, pwd und Fingerprint sind erfunden.
export const chromiumAnswer = sdpFromLines([
  'v=0',
  'o=- 2000000000000000002 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  `a=candidate:1212121212 1 udp 2113937151 ${fakeMdnsName('1')} 50011 typ host generation 0 network-cost 999`,
  `a=candidate:343434343 1 udp 2113939711 ${fakeMdnsName('2')} 50012 typ host generation 0 network-cost 999`,
  'a=ice-ufrag:ANSW',
  'a=ice-pwd:ANSWpwdANSWpwdANSWpwd345',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${fakeFingerprint(0x20)}`,
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
]);
