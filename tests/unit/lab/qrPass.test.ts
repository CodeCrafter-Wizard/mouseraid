import { describe, expect, it } from 'vitest';
import { parseCandidate, qrPassCriterion, type ParsedCandidate } from '../../../src/net/candidates';

// Nur Dokumentationsadressen (RFC 5737 / RFC 3849); der mDNS-Name wird zur Laufzeit gebaut,
// damit der Datenschutz-Wächter (tests/node/privacy-guard.test.ts) nicht anschlägt.
const DOC_IPV4 = '192.0.2.10';
const DOC_IPV6 = '2001:db8::10';
const mdnsName = (digit: string): string => `${[digit.repeat(8), digit.repeat(4), digit.repeat(4), digit.repeat(4), digit.repeat(12)].join('-')}.local`;

function candidate(address: string, type: 'host' | 'srflx' = 'host'): ParsedCandidate {
  const parsed = parseCandidate(`1 1 udp 2122260223 ${address} 50001 typ ${type} generation 0`);
  if (parsed === null) throw new Error('Testkandidat unlesbar');
  return parsed;
}

describe('qrPassCriterion', () => {
  it('echte Host-IP und kein mDNS-Name → tauglich', () => {
    expect(qrPassCriterion([candidate(DOC_IPV4), candidate(DOC_IPV6)])).toEqual({ pass: true, realIp: 2, mdns: 0 });
  });

  it('ein einziger mDNS-Name kippt das Kriterium, auch neben echten IPs', () => {
    expect(qrPassCriterion([candidate(DOC_IPV4), candidate(mdnsName('3'))])).toEqual({ pass: false, realIp: 1, mdns: 1 });
  });

  it('nur mDNS-Namen → nicht tauglich', () => {
    expect(qrPassCriterion([candidate(mdnsName('3')), candidate(mdnsName('4'))])).toEqual({ pass: false, realIp: 0, mdns: 2 });
  });

  it('eine leere Liste ist nicht tauglich', () => {
    expect(qrPassCriterion([])).toEqual({ pass: false, realIp: 0, mdns: 0 });
  });

  it('zählt nur HOST-Kandidaten als echte IP – ein srflx allein reicht nicht', () => {
    expect(qrPassCriterion([candidate(DOC_IPV4, 'srflx')])).toEqual({ pass: false, realIp: 0, mdns: 0 });
  });

  it('mDNS zählt über ALLE Kandidaten, nicht nur über die Host-Kandidaten', () => {
    expect(qrPassCriterion([candidate(DOC_IPV4), candidate(mdnsName('5'), 'srflx')])).toEqual({ pass: false, realIp: 1, mdns: 1 });
  });

  it('ist rein: dieselbe Liste ergibt dasselbe Ergebnis und bleibt unverändert', () => {
    const list = Object.freeze([candidate(DOC_IPV4)]);
    expect(qrPassCriterion(list)).toEqual(qrPassCriterion(list));
    expect(list).toHaveLength(1);
  });
});
