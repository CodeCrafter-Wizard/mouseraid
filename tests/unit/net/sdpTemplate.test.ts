import { describe, expect, it } from 'vitest';
import { renderSdp, type SdpParts } from '../../../src/net/sdpTemplate';
import { fakeFingerprint } from '../../fixtures/sdp/fakeValues';

const parts: SdpParts = {
  sessionId: 4_000_000_001,
  ufrag: 'FAKE',
  pwd: 'FAKEpwdFAKEpwdFAKEpwd012',
  fingerprint: fakeFingerprint(0x00),
  setup: 'actpass',
  sctpPort: 5000,
  maxMessageSize: 262144,
  candidates: [
    '1111111111 1 udp 2121998079 192.0.2.10 50001 typ host generation 0 network-id 1 network-cost 10',
    '2222222222 1 udp 2122265343 2001:db8:1::10 50002 typ host generation 0 network-id 2 network-cost 10',
  ],
};

describe('renderSdp', () => {
  it('rendert genau die Chromium-Zeilenfolge eines data-channel-only-SDP', () => {
    expect(renderSdp(parts).split('\r\n')).toEqual([
      'v=0',
      'o=- 4000000001 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      `a=candidate:${parts.candidates[0]}`,
      `a=candidate:${parts.candidates[1]}`,
      'a=ice-ufrag:FAKE',
      'a=ice-pwd:FAKEpwdFAKEpwdFAKEpwd012',
      'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${fakeFingerprint(0x00)}`,
      'a=setup:actpass',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
      '',
    ]);
  });

  it('benutzt nur CRLF-Zeilenenden und endet mit CRLF', () => {
    const sdp = renderSdp(parts);
    expect(sdp.endsWith('\r\n')).toBe(true);
    expect(sdp.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('lässt a=max-message-size weg, wenn der Wert null ist', () => {
    const sdp = renderSdp({ ...parts, maxMessageSize: null, setup: 'active' });
    expect(sdp).not.toContain('a=max-message-size');
    expect(sdp).toContain('a=setup:active\r\n');
    expect(sdp.endsWith('a=sctp-port:5000\r\n')).toBe(true);
  });

  it('kommt ohne Kandidaten aus', () => {
    const sdp = renderSdp({ ...parts, candidates: [] });
    expect(sdp).not.toContain('a=candidate:');
    expect(sdp).toContain('c=IN IP4 0.0.0.0\r\na=ice-ufrag:FAKE\r\n');
  });
});
