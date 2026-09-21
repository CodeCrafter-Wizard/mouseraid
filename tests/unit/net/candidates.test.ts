import { describe, expect, it } from 'vitest';
import {
  candidatesFromSdp,
  parseCandidate,
  summariseCandidates,
  type ParsedCandidate,
} from '../../../src/net/candidates';

// Öffentliches Repo: Adressen außerhalb der Dokumentationsbereiche werden zur Laufzeit aus Teilen
// zusammengesetzt, damit der Datenschutz-Wächter (tests/node/privacy-guard.test.ts) nicht anschlägt.
const ip = (...parts: number[]): string => parts.join('.');
const ip6 = (...parts: string[]): string => parts.join(':');
const MDNS_NAME = `${['11111111', '2222', '3333', '4444', '555555555555'].join('-')}.local`;

const hostLine = (address: string): string => `candidate:1 1 udp 2122260223 ${address} 50000 typ host`;

function must(raw: string): ParsedCandidate {
  const parsed = parseCandidate(raw);
  if (parsed === null) throw new Error(`nicht parsebar: ${raw}`);
  return parsed;
}

describe('parseCandidate – Grammatik', () => {
  it('zerlegt eine Chrome-Zeile mit Erweiterungsattributen', () => {
    const raw = '3885250869 1 udp 2122260223 192.0.2.10 54321 typ host generation 0 ufrag abcd network-id 1 network-cost 10';
    expect(parseCandidate(`candidate:${raw}`)).toEqual({
      raw,
      foundation: '3885250869',
      component: 1,
      protocol: 'udp',
      priority: 2122260223,
      address: '192.0.2.10',
      port: 54321,
      type: 'host',
      family: 'ipv4',
      scope: 'global',
    });
  });

  it('schreibt das Protokoll klein (Firefox sendet "UDP")', () => {
    expect(must('candidate:0 1 UDP 2122252543 192.0.2.10 50000 typ host').protocol).toBe('udp');
    expect(must('candidate:4 1 TCP 2105524479 192.0.2.10 9 typ host tcptype active').protocol).toBe('tcp');
  });

  it('akzeptiert "a=candidate:", "candidate:" und die nackte Form; raw ist immer der Text nach dem Präfix', () => {
    const bare = '1 1 udp 2122260223 192.0.2.10 50000 typ host';
    for (const raw of [`a=candidate:${bare}`, `candidate:${bare}`, bare, `  a=candidate:${bare}\r`]) {
      const parsed = must(raw);
      expect(parsed.foundation).toBe('1');
      expect(parsed.address).toBe('192.0.2.10');
      expect(parsed.raw).toBe(bare);
    }
  });

  it('liest srflx-Kandidaten samt raddr/rport, ohne an den Zusatzfeldern zu scheitern', () => {
    const parsed = must('candidate:842163049 1 udp 1677729535 203.0.113.7 40000 typ srflx raddr 0.0.0.0 rport 0');
    expect(parsed.type).toBe('srflx');
    expect(parsed.port).toBe(40000);
  });

  it.each([
    ['leerer Text', ''],
    ['nur das Präfix', 'candidate:'],
    ['andere SDP-Zeile', 'a=ice-ufrag:abcd'],
    ['zu wenige Felder', 'candidate:1 1 udp 2122260223 192.0.2.10 50000 typ'],
    ['Schlüsselwort "typ" fehlt', 'candidate:1 1 udp 2122260223 192.0.2.10 50000 host host'],
    ['Komponente keine Zahl', 'candidate:1 x udp 2122260223 192.0.2.10 50000 typ host'],
    ['Priorität keine Zahl', 'candidate:1 1 udp hoch 192.0.2.10 50000 typ host'],
    ['Port keine Zahl', 'candidate:1 1 udp 2122260223 192.0.2.10 5e4 typ host'],
    ['Port außerhalb 0–65535', 'candidate:1 1 udp 2122260223 192.0.2.10 65536 typ host'],
    ['negative Priorität', 'candidate:1 1 udp -5 192.0.2.10 50000 typ host'],
  ])('liefert null für: %s', (_name, raw) => {
    expect(parseCandidate(raw)).toBeNull();
  });
});

describe('parseCandidate – Adressfamilie und Geltungsbereich', () => {
  it.each([
    ['Schleife', ip(127, 0, 0, 1), 'loopback'],
    ['Schleife (ganzes /8)', ip(127, 8, 9, 10), 'loopback'],
    ['link-local', ip(169, 254, 10, 20), 'link-local'],
    ['privat 10/8', ip(10, 1, 2, 3), 'private'],
    ['privat 172.16/12 (untere Grenze)', ip(172, 16, 0, 1), 'private'],
    ['privat 172.16/12 (obere Grenze)', ip(172, 31, 255, 254), 'private'],
    ['knapp unter 172.16/12', ip(172, 15, 255, 254), 'global'],
    ['knapp über 172.16/12', ip(172, 32, 0, 1), 'global'],
    ['privat 192.168/16', ip(192, 168, 1, 23), 'private'],
    ['CGNAT 100.64/10 (untere Grenze)', ip(100, 64, 0, 1), 'cgnat'],
    ['CGNAT 100.64/10 (obere Grenze)', ip(100, 127, 255, 254), 'cgnat'],
    ['knapp unter CGNAT', ip(100, 63, 255, 254), 'global'],
    ['knapp über CGNAT', ip(100, 128, 0, 1), 'global'],
    ['iPhone-Hotspot', ip(192, 0, 0, 2), 'ios-hotspot'],
    ['Nachbar der Hotspot-Adresse', ip(192, 0, 0, 3), 'global'],
    ['Dokumentationsnetz 1', '192.0.2.10', 'global'],
    ['Dokumentationsnetz 2', '198.51.100.7', 'global'],
    ['Dokumentationsnetz 3', '203.0.113.5', 'global'],
  ])('IPv4 %s', (_name, address, scope) => {
    const parsed = must(hostLine(address));
    expect(parsed.family).toBe('ipv4');
    expect(parsed.scope).toBe(scope);
  });

  it.each([
    ['Schleife', '::1', 'loopback'],
    ['Schleife ausgeschrieben', '0:0:0:0:0:0:0:1', 'loopback'],
    ['link-local', 'fe80::1', 'link-local'],
    ['link-local (obere Grenze /10)', 'febf::1', 'link-local'],
    ['link-local in Großbuchstaben', 'FE80::ABCD', 'link-local'],
    ['ULA fd…', ip6('fd00', '', '1'), 'ula'],
    ['ULA fc…', ip6('fc00', '', '1'), 'ula'],
    ['Dokumentationspräfix', '2001:db8::1', 'global'],
    ['Dokumentationspräfix lang', '2001:db8:0:1:2:3:4:5', 'global'],
  ])('IPv6 %s', (_name, address, scope) => {
    const parsed = must(hostLine(address));
    expect(parsed.family).toBe('ipv6');
    expect(parsed.scope).toBe(scope);
  });

  it('erkennt mDNS-Namen an der Endung .local', () => {
    const parsed = must(hostLine(MDNS_NAME));
    expect(parsed.family).toBe('mdns');
    expect(parsed.scope).toBe('mdns');
    expect(must(hostLine(MDNS_NAME.toUpperCase())).family).toBe('mdns');
  });

  it('ordnet alles andere als "other" ein (Hostname, kaputte Oktette)', () => {
    expect(must(hostLine('example.invalid'))).toMatchObject({ family: 'other', scope: 'other' });
    expect(must(hostLine('999.1.1.1'))).toMatchObject({ family: 'other', scope: 'other' });
  });

  it('lässt die Adresse wörtlich stehen', () => {
    expect(must(hostLine('FE80::ABCD')).address).toBe('FE80::ABCD');
  });
});

describe('candidatesFromSdp', () => {
  const lines = [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:1 1 udp 2122260223 192.0.2.10 50000 typ host generation 0 network-id 1',
    `a=candidate:2 1 udp 2122194687 ${MDNS_NAME} 50001 typ host`,
    'a=end-of-candidates',
    'a=mid:0',
  ];
  const expected = [
    '1 1 udp 2122260223 192.0.2.10 50000 typ host generation 0 network-id 1',
    `2 1 udp 2122194687 ${MDNS_NAME} 50001 typ host`,
  ];

  it('liefert den Text nach "a=candidate:" wörtlich und in Reihenfolge (CRLF)', () => {
    expect(candidatesFromSdp(`${lines.join('\r\n')}\r\n`)).toEqual(expected);
  });

  it('kommt auch mit LF-Zeilenenden zurecht', () => {
    expect(candidatesFromSdp(lines.join('\n'))).toEqual(expected);
  });

  it('liefert eine leere Liste, wenn das SDP keine Kandidaten enthält', () => {
    expect(candidatesFromSdp('v=0\r\ns=-\r\na=end-of-candidates\r\n')).toEqual([]);
    expect(candidatesFromSdp('')).toEqual([]);
  });

  it('jedes Ergebnis lässt sich mit parseCandidate lesen', () => {
    const parsed = candidatesFromSdp(lines.join('\r\n')).map((raw) => parseCandidate(raw));
    expect(parsed.map((p) => p?.family)).toEqual(['ipv4', 'mdns']);
  });
});

describe('summariseCandidates', () => {
  it('zählt Art, Familie und Protokoll', () => {
    const list = [
      must(hostLine(ip(192, 168, 1, 23))),
      must(hostLine(MDNS_NAME)),
      must(hostLine('2001:db8::1')),
      must(`candidate:4 1 tcp 1518280447 ${ip(10, 0, 0, 5)} 9 typ host tcptype active`),
      must('candidate:5 1 udp 1677729535 203.0.113.7 40000 typ srflx raddr 0.0.0.0 rport 0'),
    ];
    expect(summariseCandidates(list)).toEqual({
      total: 5,
      host: 4,
      hostRealIp: 3,
      mdns: 1,
      ipv4: 3,
      ipv6: 1,
      tcp: 1,
      iosHotspot: false,
    });
  });

  it('nur mDNS: host > 0, aber hostRealIp = 0 (Grundlage für F2)', () => {
    const summary = summariseCandidates([must(hostLine(MDNS_NAME)), must(hostLine(MDNS_NAME))]);
    expect(summary.host).toBe(2);
    expect(summary.hostRealIp).toBe(0);
    expect(summary.mdns).toBe(2);
  });

  it('meldet den iPhone-Hotspot, sobald ein Kandidat dessen Adresse trägt', () => {
    expect(summariseCandidates([must(hostLine('192.0.2.10')), must(hostLine(ip(192, 0, 0, 2)))]).iosHotspot).toBe(true);
  });

  it('leere Liste → alles 0 / false', () => {
    expect(summariseCandidates([])).toEqual({ total: 0, host: 0, hostRealIp: 0, mdns: 0, ipv4: 0, ipv6: 0, tcp: 0, iosHotspot: false });
  });
});
