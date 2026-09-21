import { fakeFingerprint, sdpFromLines } from './fakeValues';

// Firefox-Stil – von Hand geschrieben, nicht erfasst (siehe firefox-offer.ts): Antwort mit
// setup:active und Fingerprint auf Session-Ebene. Alle Werte sind erfunden.
export const firefoxAnswer = sdpFromLines([
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 4000000000000000004 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=sendrecv',
  `a=fingerprint:sha-256 ${fakeFingerprint(0x60)}`,
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 50031 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.5',
  'a=candidate:0 1 UDP 2122252543 203.0.113.5 50031 typ host',
  'a=candidate:1 1 UDP 2122187007 2001:db8:3::5 50032 typ host',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:fa4e11fa4e11fa4e11fa4e11fa4e11fa',
  'a=ice-ufrag:fa4e0002',
  'a=mid:0',
  'a=setup:active',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
]);
