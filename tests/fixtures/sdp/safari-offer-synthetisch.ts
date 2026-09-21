import { fakeFingerprint, sdpFromLines } from './fakeValues';

// SYNTHETISCH – nicht von einem echten Safari erfasst (kein Apple-Gerät verfügbar). Safari benutzt
// libwebrtc, der Aufbau folgt deshalb dem Chromium-Angebot. Bewusst eingebaute Härtefälle:
// LF statt CRLF, kein a=sctp-port und kein a=max-message-size (Vorgaben 5000 bzw. null greifen),
// Fingerprint in Kleinbuchstaben, nur EIN Host-Kandidat. Ein echtes Safari-SDP ersetzt diese Datei
// nach der Leihgeräte-Sitzung. Alle Werte sind erfunden.
export const safariOfferSynthetic = sdpFromLines([
  'v=0',
  'o=- 5000000000000000005 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 50041 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.20',
  'a=candidate:5555555555 1 udp 2113937151 203.0.113.20 50041 typ host generation 0 network-cost 999',
  'a=ice-ufrag:SAFA',
  'a=ice-pwd:SAFApwdSAFApwdSAFApwd678',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${fakeFingerprint(0x80).toLowerCase()}`,
  'a=setup:actpass',
  'a=mid:0',
]).replace(/\r\n/g, '\n');
