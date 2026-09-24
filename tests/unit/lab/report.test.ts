import { describe, expect, it } from 'vitest';
import {
  createReportStore,
  isRunValid,
  redactReport,
  redactText,
  REPORT_STORE_KEY,
  reportsToJson,
  reportToText,
  type CellLabel,
  type LabReport,
} from '../../../src/lab/report';
import type { LockTestRun } from '../../../src/lab/lockTest';
import type { ParsedCandidate } from '../../../src/net/candidates';
import type { PermissionSnapshot } from '../../../src/net/environment';
import { sampleAddresses, sampleCandidate, sampleLockRun, sampleReport } from '../../helpers/sampleReport';

const REASON_OFF_BUT_GRANTED = 'Kamera aus, aber Berechtigung ist erteilt (echte IPs trotz fehlender Kamera)';
const REASON_ON_NOT_GRANTED = 'Kamera an, aber Berechtigung ist nicht erteilt';

const cell = (overrides: Partial<CellLabel> = {}): CellLabel => ({
  role: 'host',
  hotspotOwner: 'router',
  camera: 'aus',
  path: 'text',
  device: 'Pixel-A',
  ...overrides,
});

const permissions = (camera: PermissionSnapshot['camera']): PermissionSnapshot => ({
  camera,
  localNetwork: 'unsupported',
  loopbackNetwork: 'unsupported',
});

describe('isRunValid', () => {
  it('„Kamera aus“ ohne erteilte Berechtigung ist gültig', () => {
    for (const state of ['prompt', 'denied', 'unsupported'] as const) {
      expect(isRunValid(cell({ camera: 'aus' }), permissions(state))).toEqual({ valid: true, reason: null });
    }
  });

  it('„Kamera aus“ mit Status granted ist ungültig', () => {
    expect(isRunValid(cell({ camera: 'aus' }), permissions('granted'))).toEqual({ valid: false, reason: REASON_OFF_BUT_GRANTED });
  });

  it('„Kamera an“ zählt nur mit Status granted', () => {
    expect(isRunValid(cell({ camera: 'an' }), permissions('granted'))).toEqual({ valid: true, reason: null });
    for (const state of ['prompt', 'denied', 'unsupported'] as const) {
      expect(isRunValid(cell({ camera: 'an' }), permissions(state))).toEqual({ valid: false, reason: REASON_ON_NOT_GRANTED });
    }
  });

  it('die Kamera-Regel gilt für die Pfade text, qr und loopback – unabhängig von der Rolle', () => {
    for (const path of ['text', 'qr', 'loopback'] as const) {
      for (const role of ['host', 'client', 'selbsttest'] as const) {
        expect(isRunValid(cell({ path, role, camera: 'aus' }), permissions('granted')).valid).toBe(false);
        expect(isRunValid(cell({ path, role, camera: 'an' }), permissions('prompt')).valid).toBe(false);
        expect(isRunValid(cell({ path, role, camera: 'an' }), permissions('granted')).valid).toBe(true);
      }
    }
  });

  it('der Pfad broadcast hat kein ICE: die Kamera-Regel greift nicht', () => {
    expect(isRunValid(cell({ path: 'broadcast', camera: 'aus' }), permissions('granted'))).toEqual({ valid: true, reason: null });
    expect(isRunValid(cell({ path: 'broadcast', camera: 'an' }), permissions('denied'))).toEqual({ valid: true, reason: null });
  });

  it('der Gerätename muss nach dem Trimmen 1–24 Zeichen haben – auf jedem Pfad', () => {
    expect(isRunValid(cell({ device: 'x' }), permissions('prompt')).valid).toBe(true);
    expect(isRunValid(cell({ device: `  ${'x'.repeat(24)}  ` }), permissions('prompt')).valid).toBe(true);
    for (const device of ['', '   ', 'x'.repeat(25)]) {
      for (const path of ['text', 'broadcast'] as const) {
        const result = isRunValid(cell({ device, path }), permissions('prompt'));
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Gerätename fehlt oder ist länger als 24 Zeichen');
      }
    }
  });
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('redactReport', () => {
  it('ersetzt address und die Adresse in raw durch <familie>/<scope>#n – gleiche Adresse, gleiches Token', () => {
    const gathered = redactReport(sampleReport()).gather?.gathered ?? [];
    expect(gathered.map((candidate) => candidate.address)).toEqual([
      'ipv4/global#1',
      'ipv6/global#2',
      'mdns/mdns#3',
      'ipv4/global#1',
      'ipv4/global#4',
    ]);
    // Die Foundation wird je Report zum Ordinal f1, f2, … (Fix-Runde 2, M10) – im Feld wie am Anfang von raw.
    expect(gathered[0]?.raw).toBe('f1 1 udp 2122259222 ipv4/global#1 50001 typ host generation 0 network-cost 10');
    expect(gathered[3]?.raw).toBe('f4 1 tcp 2122259219 ipv4/global#1 9 typ host tcptype active generation 0 network-cost 10');
    // Alles außer Adresse, raw und Foundation bleibt, wie es war.
    expect(gathered[1]).toMatchObject({ foundation: 'f2', port: 50002, protocol: 'udp', type: 'host', family: 'ipv6', scope: 'global' });
  });

  it('das JSON des anonymisierten Reports enthält keine Adresse des Originals', () => {
    const json = JSON.stringify(redactReport(sampleReport())).toLowerCase();
    expect(sampleAddresses()).toHaveLength(4);
    for (const address of sampleAddresses()) expect(json).not.toContain(address.toLowerCase());
    expect(json).not.toContain('.local');
  });

  it('entfernt raddr-Werte und ufrag aus raw', () => {
    const host = sampleCandidate(1001, 'udp', '192.0.2.10', 50001, 'ipv4', 'global');
    const reflexive = {
      ...sampleCandidate(2001, 'udp', '203.0.113.9', 61000, 'ipv4', 'global'),
      type: 'srflx',
      raw: '2001 1 udp 1686052607 203.0.113.9 61000 typ srflx raddr 192.0.2.10 rport 50001 generation 0 ufrag AbCd network-cost 10',
    };
    const unknownBase = {
      ...sampleCandidate(2002, 'udp', '203.0.113.9', 61001, 'ipv4', 'global'),
      type: 'srflx',
      raw: 'candidate:2002 1 udp 1686052606 203.0.113.9 61001 typ srflx raddr 198.51.100.200 rport 50002',
    };
    const report = sampleReport({ gather: { durationMs: 10, timedOut: false, gathered: [host, reflexive, unknownBase], transmitted: 3 } });

    const raws = (redactReport(report).gather?.gathered ?? []).map((candidate) => candidate.raw);

    // Erstes Token ist seit Fix-Runde 2 das Foundation-Ordinal; ein „candidate:“-Präfix bleibt stehen.
    expect(raws[1]).toBe('f2 1 udp 1686052607 ipv4/global#2 61000 typ srflx raddr ipv4/global#1 rport 50001 generation 0 ufrag entfernt network-cost 10');
    expect(raws[2]).toBe('candidate:f3 1 udp 1686052606 ipv4/global#2 61001 typ srflx raddr ipv4/other#3 rport 50002');
  });

  it('säubert Zeitleisten-Details und Notizen vorsorglich von IPs und .local-Namen', () => {
    const mdns = `${['22222222', '2222', '2222', '2222', '222222222222'].join('-')}.local`;
    const report = sampleReport({
      gather: null,
      timeline: [
        { tMs: 1, kind: 'candidate', detail: 'host/ipv4' },
        { tMs: 2, kind: 'note', detail: 'lokal 203.0.113.5:4000 -> [2001:db8::99]:5000' },
        { tMs: 3, kind: 'note', detail: `Name ${mdns}, Link fe80::1%wlan0, wieder 203.0.113.5` },
        { tMs: 4, kind: 'note', detail: 'um 16:24:25 gathering:complete ice:checking:x' },
      ],
      notes: 'Router 203.0.113.1, Gegenstelle 203.0.113.5',
    });

    const redacted = redactReport(report);

    expect(redacted.timeline.map((event) => event.detail)).toEqual([
      'host/ipv4',
      'lokal ipv4/other#1:4000 -> [ipv6/other#2]:5000',
      'Name mdns/mdns#3, Link ipv6/other#4, wieder ipv4/other#1',
      'um 16:24:25 gathering:complete ice:checking:x',
    ]);
    expect(redacted.notes).toBe('Router ipv4/other#5, Gegenstelle ipv4/other#1');
    expect(redacted.gather).toBeNull();
  });

  it('benutzt in der Zeitleiste dasselbe Token wie für den gesammelten Kandidaten', () => {
    const report = sampleReport({ timeline: [{ tMs: 1, kind: 'note', detail: 'gewählt: 2001:DB8::10' }] });
    expect(redactReport(report).timeline[0]?.detail).toBe('gewählt: ipv6/global#2');
  });

  it('lässt userAgent, Build-ID, Größen, Statistik und gewähltes Paar unangetastet', () => {
    const original = sampleReport();
    const redacted = redactReport(original);
    // Der userAgent enthält mit „Chrome/140.0.0.0“ etwas, das wie eine IPv4-Adresse aussieht.
    expect(redacted.environment).toEqual(original.environment);
    expect(redacted.buildId).toBe(original.buildId);
    expect(redacted.payloadSizes).toEqual(original.payloadSizes);
    expect(redacted.ping).toEqual(original.ping);
    expect(redacted.selectedPair).toEqual(original.selectedPair);
    expect(redacted.cell).toEqual(original.cell);
    expect(redacted.gather?.transmitted).toBe(5);
  });

  it('kopiert tief und verändert die Eingabe nicht (tief eingefroren)', () => {
    const frozen = deepFreeze(sampleReport());
    const redacted = redactReport(frozen);
    expect(frozen).toEqual(sampleReport());
    expect(redacted.gather).not.toBe(frozen.gather);
    expect(redacted.timeline).not.toBe(frozen.timeline);
    expect(redacted.environment.features).not.toBe(frozen.environment.features);
    expect(Object.isFrozen(redacted)).toBe(false);
  });
});

describe('redactReport – Sicherheitsnetz gegen angeklebte Adressen', () => {
  const [KNOWN_IPV4, KNOWN_IPV6] = sampleAddresses();
  const KNOWN_MDNS = sampleAddresses()[2] ?? '';
  const UNKNOWN_IPV4 = '203.0.113.77';
  const KNOWN_IPV6_FULL = '2001:0db8:0000:0000:0000:0000:0000:0010';
  const UNKNOWN_IPV6_COMPRESSED = '2001:db8:9999::42';
  const UNKNOWN_IPV6_FULL = '2001:0db8:0000:0000:0000:0000:0000:0099';
  const KNOWN_IPV6_UPPER = (KNOWN_IPV6 ?? '').toUpperCase();
  const UNKNOWN_MDNS = `${['33333333', '3333', '3333', '3333', '333333333333'].join('-')}.local`;

  // Die Ziffer-Punkt-Präfixe ('1.' … '21.09.') verschieben ein Vier-Gruppen-Muster nach links (S5).
  const GLUE_PREFIXES = ['', 'x', '5', '_', '(', 'ä', 'Fehlercode', '1.', '1.2.', '1.2.3.', '21.09.'];
  const GLUE_SUFFIXES = ['', 'x', '_', '.', ')', 'war', '7'];
  const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  /** Reste einer IPv4-Adresse ab zwei Oktetten: aus „192.0.2.10“ werden „.0.2.10“ und „.2.10“. */
  const ipv4Tails = (address: string): string[] => {
    const octets = address.split('.');
    return DOTTED_QUAD.test(address) ? [`.${octets.slice(1).join('.')}`, `.${octets.slice(2).join('.')}`] : [];
  };
  const GLUE_ADDRESSES = [
    KNOWN_IPV4 ?? '',
    UNKNOWN_IPV4,
    KNOWN_IPV6_FULL,
    UNKNOWN_IPV6_COMPRESSED,
    UNKNOWN_IPV6_FULL,
    KNOWN_IPV6_UPPER,
    KNOWN_MDNS,
    UNKNOWN_MDNS,
  ];

  it('lässt keine angeklebte Adresse im serialisierten Report übrig (Präfix × Suffix × Adresse)', () => {
    const failures: string[] = [];
    for (const address of GLUE_ADDRESSES) {
      for (const prefix of GLUE_PREFIXES) {
        for (const suffix of GLUE_SUFFIXES) {
          const glued = `${prefix}${address}${suffix}`;
          const report = sampleReport({ notes: glued, timeline: [{ tMs: 1, kind: 'note', detail: glued }] });
          const redacted = redactReport(report);
          const json = JSON.stringify(redacted).toLowerCase();
          const freeTexts = [redacted.notes, redacted.timeline[0]?.detail ?? ''];
          const tailLeft = ipv4Tails(address).some((tail) => freeTexts.some((text) => text.includes(tail)));
          if (json.includes(address.toLowerCase()) || tailLeft) {
            failures.push(`prefix=${JSON.stringify(prefix)} address=${address} suffix=${JSON.stringify(suffix)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('eine nummerierte Liste mit angeklebten Adressen hinterlässt kein Oktett-Paar', () => {
    const redacted = redactReport(sampleReport({ notes: '1.192.0.2.10 2.198.51.100.7' }));
    for (const pair of ['192.0', '0.2', '2.10', '198.51', '51.100', '100.7']) expect(redacted.notes).not.toContain(pair);
    expect(redacted.notes).toBe('ipv4/other#5 ipv4/other#6');
  });

  it('bekannte Adresse bleibt auch mit angeklebter Ziffer unauffindbar (die Muster-Schicht erwischt sie)', () => {
    const known = KNOWN_IPV4 ?? '';
    const report = sampleReport({ notes: `${known}7 und 9${known}` });
    const json = JSON.stringify(redactReport(report)).toLowerCase();
    expect(json).not.toContain(known.toLowerCase());
  });

  it('Uhrzeit und Versionsnummern bleiben unangetastet; ein Chrome-Versionsstring in notes wird (bewusst zu viel) redigiert, userAgent bleibt bytegleich', () => {
    const original = sampleReport({
      notes: 'Uhrzeit 16:24:25, Version 1.2.3, Browser Chrome/128.0.0.0 gestartet',
      timeline: [{ tMs: 1, kind: 'note', detail: '16:24:25 und 1.2.3' }],
    });
    const redacted = redactReport(original);
    expect(redacted.notes).toContain('16:24:25');
    expect(redacted.notes).toContain('1.2.3');
    expect(redacted.notes).not.toContain('Chrome/128.0.0.0');
    expect(redacted.timeline[0]?.detail).toBe('16:24:25 und 1.2.3');
    expect(redacted.environment).toEqual(original.environment);
    expect(redacted.environment.userAgent).toBe(original.environment.userAgent);
  });

  it('dieselbe bekannte IPv6-Adresse in Großbuchstaben in notes bekommt dasselbe Token wie im gesammelten Kandidaten', () => {
    const report = sampleReport({ notes: `gesehen: ${KNOWN_IPV6_UPPER}` });
    expect(redactReport(report).notes).toBe('gesehen: ipv6/global#2');
  });
});

const gatherOf = (gathered: ParsedCandidate[]): LabReport['gather'] => ({
  durationMs: 10,
  timedOut: false,
  gathered,
  transmitted: gathered.length,
});

/** Kandidat der Familie „other“ (Hostname statt IP) – ausschließlich erfundene Namen. */
const otherCandidate = (foundation: number, address: string, port: number): ParsedCandidate =>
  sampleCandidate(foundation, 'udp', address, port, 'other', 'other');

const raws = (report: LabReport): string[] => (report.gather?.gathered ?? []).map((candidate) => candidate.raw);

describe('redactReport – Schicht 2 ersetzt bekannte Adressen wörtlich', () => {
  const SHORT_NAME = 'labor-pc';
  const LONG_NAME = 'labor-pc.example';

  // Der kurze Name steht ZUERST in gathered: ohne „längste zuerst“ zerschnitte er den langen.
  const hostNameReport = (): LabReport =>
    sampleReport({
      gather: gatherOf([
        otherCandidate(1, SHORT_NAME, 50001),
        otherCandidate(2, LONG_NAME, 50002),
        {
          ...sampleCandidate(3, 'udp', '203.0.113.9', 61000, 'ipv4', 'global'),
          type: 'srflx',
          raw: `3 1 udp 1686052607 203.0.113.9 61000 typ srflx raddr ${LONG_NAME} rport 50002`,
        },
        {
          ...sampleCandidate(4, 'udp', '198.51.100.7', 50004, 'ipv4', 'global'),
          raw: `4 1 udp  2122260219 198.51.100.7 50004 typ host x-name ${LONG_NAME.toUpperCase()} generation 0`,
        },
        {
          ...sampleCandidate(5, 'udp', '192.0.2.10', 50005, 'ipv4', 'global'),
          raw: ['5', '1', 'udp', '2122260218', '192.0.2.10', '50005', 'typ', 'host', 'x-name', 'Labor-PC.Example'].join('\t'),
        },
      ]),
      notes: 'xLABOR-PC.EXAMPLEy, allein: Labor-PC',
      timeline: [{ tMs: 1, kind: 'note', detail: 'xLABOR-PC.EXAMPLEy' }],
    });

  it('der serialisierte Report enthält den Hostnamen in keiner Schreibweise', () => {
    expect(JSON.stringify(redactReport(hostNameReport())).toLowerCase()).not.toContain(SHORT_NAME);
  });

  it('längste zuerst und ohne Rücksicht auf Groß-/Kleinschreibung: beide Namen bekommen verschiedene Tokens', () => {
    const redacted = redactReport(hostNameReport());
    expect(redacted.notes).toBe('xother/other#2y, allein: other/other#1');
    expect(redacted.timeline[0]?.detail).toBe('xother/other#2y');
  });

  it('gilt auch in raw: als raddr-Wert, hinter doppeltem Leerzeichen und in einer Tab-getrennten Zeile', () => {
    expect(raws(redactReport(hostNameReport())).slice(2)).toEqual([
      'f3 1 udp 1686052607 ipv4/global#3 61000 typ srflx raddr other/other#2 rport 50002',
      'f4 1 udp 2122260219 ipv4/global#4 50004 typ host x-name other/other#2 generation 0',
      'f5 1 udp 2122260218 ipv4/global#5 50005 typ host x-name other/other#2',
    ]);
  });

  it('sucht die bekannte Adresse WÖRTLICH: Regex-Zeichen darin passen auf nichts anderes und werfen nicht', () => {
    const dotted = sampleReport({ gather: gatherOf([otherCandidate(1, 'pc.example', 50001)]), notes: 'pcXexample bleibt, pc.example nicht' });
    expect(redactReport(dotted).notes).toBe('pcXexample bleibt, other/other#1 nicht');

    const weird = sampleReport({
      gather: gatherOf([otherCandidate(1, 'labor(pc', 50001), otherCandidate(2, 'a+b[c', 50002)]),
      notes: 'erst labor(pc, dann a+b[c, aber nicht aab[c',
    });
    expect(() => redactReport(weird)).not.toThrow();
    expect(redactReport(weird).notes).toBe('erst other/other#1, dann other/other#2, aber nicht aab[c');
  });

  it('ein Kandidat mit leerer Adresse macht aus dem Sicherheitsnetz keinen Alles-Ersetzer', () => {
    const report = sampleReport({ gather: gatherOf([otherCandidate(1, '', 50001)]), notes: 'abc' });
    expect(redactReport(report).notes).toBe('abc');
  });

  it('Familie und Scope gelangen nur von der Positivliste ins Token – „$&“ holt die Adresse nicht zurück (M5)', () => {
    const forged = { ...otherCandidate(1, 'geheim-host', 50001), family: '$&', scope: 'geheim-scope' } as unknown as ParsedCandidate;
    const redacted = redactReport(sampleReport({ gather: gatherOf([forged]), notes: 'Host war geheim-host heute' }));
    expect(redacted.gather?.gathered[0]?.address).toBe('other/other#1');
    expect(redacted.notes).toBe('Host war other/other#1 heute');
    expect(JSON.stringify(redacted)).not.toContain('geheim-host');
  });
});

describe('redactReport – Kandidatenzeile (raw)', () => {
  it('eine Adresse außerhalb von Feld 5 und raddr überlebt den Schlussdurchlauf nicht', () => {
    const report = sampleReport({
      gather: gatherOf([
        {
          ...sampleCandidate(1001, 'udp', '192.0.2.10', 50001, 'ipv4', 'global'),
          raw: '1001 1 udp 2122259222 192.0.2.10 50001 typ host x-ext 203.0.113.77 generation 0',
        },
      ]),
    });
    const redacted = redactReport(report);
    expect(raws(redacted)).toEqual(['f1 1 udp 2122259222 ipv4/global#1 50001 typ host x-ext ipv4/other#2 generation 0']);
    expect(JSON.stringify(redacted)).not.toContain('203.0.113.77');
  });

  it('verschobene Felder (doppeltes Leerzeichen, Tabs) lassen keine Adresse stehen', () => {
    const report = sampleReport({
      gather: gatherOf([
        { ...sampleCandidate(1, 'udp', '192.0.2.10', 50001, 'ipv4', 'global'), raw: '1 1 udp  2122260222 192.0.2.10 50001 typ host' },
        { ...sampleCandidate(2, 'udp', '198.51.100.7', 50002, 'ipv4', 'global'), raw: '2\t1\tudp\t\t2122260221\t198.51.100.7\t50002\ttyp\thost' },
      ]),
    });
    const redacted = redactReport(report);
    expect(raws(redacted)).toEqual(['f1 1 udp 2122260222 ipv4/global#1 50001 typ host', 'f2 1 udp 2122260221 ipv4/global#2 50002 typ host']);
    const json = JSON.stringify(redacted);
    expect(json).not.toContain('192.0.2.10');
    expect(json).not.toContain('198.51.100.7');
  });

  it('ein raddr-Wert ist der Position nach eine Adresse: auch ein unbekannter Hostname wird ersetzt', () => {
    const report = sampleReport({
      gather: gatherOf([
        {
          ...sampleCandidate(1, 'udp', '203.0.113.9', 61000, 'ipv4', 'global'),
          type: 'srflx',
          raw: '1 1 udp 1686052607 203.0.113.9 61000 typ srflx raddr fremder-host.example rport 9',
        },
        {
          ...sampleCandidate(2, 'udp', '203.0.113.9', 61001, 'ipv4', 'global'),
          type: 'srflx',
          raw: '2 1 udp 1686052606 203.0.113.9 61001 typ srflx raddr 198.51.100.200 rport 9',
        },
      ]),
    });
    const redacted = redactReport(report);
    expect(raws(redacted)).toEqual([
      'f1 1 udp 1686052607 ipv4/global#1 61000 typ srflx raddr other/other#2 rport 9',
      'f2 1 udp 1686052606 ipv4/global#1 61001 typ srflx raddr ipv4/other#3 rport 9',
    ]);
    // Ein zweiter Durchlauf erkennt das Token im raddr-Wert und vergibt kein neues („other/other#…“ statt „ipv4/other#3“).
    expect(redactReport(redacted)).toEqual(redacted);
  });

  it('ufrag verschwindet bei jeder Trennung, die der Parser akzeptiert (Tab, doppeltes Leerzeichen, NBSP)', () => {
    const SECRET = 'Qx9Kufrag';
    const line = (separator: string): string => `1 1 udp 2122260223 192.0.2.47 50000 typ host generation 0 ufrag${separator}${SECRET} network-id 1`;
    const variants = [line(' '), line('  '), line('\t'), line('\u00A0'), line(' ').split(' ').join('\t')];
    const report = sampleReport({
      gather: gatherOf(variants.map((raw, index) => ({ ...sampleCandidate(index + 1, 'udp', '192.0.2.47', 50000, 'ipv4', 'global'), raw }))),
    });
    const redacted = redactReport(report);
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    // Kontrollzeile mit einfachen Leerzeichen: bis auf Ordinal, Token und ufrag-Wert unverändert.
    expect(raws(redacted)[0]).toBe('f1 1 udp 2122260223 ipv4/global#1 50000 typ host generation 0 ufrag entfernt network-id 1');
    expect(raws(redacted).map((raw) => raw.replace(/^f\d /, 'f1 '))).toEqual(Array.from({ length: 5 }, () => raws(redacted)[0]));
  });

  it('ersetzt die Foundation je Report durch ein Ordinal – im Feld und als erstes Token von raw, Präfix bleibt', () => {
    const udp = sampleCandidate(7770001, 'udp', '192.0.2.10', 50001, 'ipv4', 'global');
    const tcp = sampleCandidate(7770001, 'tcp', '192.0.2.10', 9, 'ipv4', 'global');
    const second = sampleCandidate(7770002, 'udp', '198.51.100.7', 50002, 'ipv4', 'global');
    const report = sampleReport({
      gather: gatherOf([udp, { ...tcp, raw: `candidate:${tcp.raw}` }, { ...second, raw: `a=candidate:${second.raw}` }]),
    });
    const redacted = redactReport(report);
    expect((redacted.gather?.gathered ?? []).map((candidate) => candidate.foundation)).toEqual(['f1', 'f1', 'f2']);
    expect(raws(redacted).map((raw) => raw.split(' ')[0])).toEqual(['f1', 'candidate:f1', 'a=candidate:f2']);
    expect(JSON.stringify(redacted)).not.toContain('777000');
  });
});

describe('redactReport – Textformen', () => {
  const notesOf = (notes: string): string => redactReport(sampleReport({ gather: null, notes })).notes;

  it('Nicht-ASCII-Zeichen im .local-Namen: vom Namen bleibt nichts stehen', () => {
    expect(notesOf('Rechner müllers-läptop.local im WLAN')).toBe('Rechner mdns/mdns#1 im WLAN');
  });

  it('keine Bereichsprüfung: auch ein Oktett über 255 wird redigiert', () => {
    expect(notesOf('Gegenstelle 203.0.113.777 antwortet nicht')).toBe('Gegenstelle ipv4/other#1 antwortet nicht');
  });

  it('kurze „::“-Form mit angeklebter Ziffer wird redigiert', () => {
    // Gruppen sind auf vier Hex-Zeichen begrenzt: die angeklebte „5“ darf außerhalb bleiben, die Adresse nicht.
    const redacted = notesOf('Link 5fe80::1');
    expect(redacted).not.toContain('fe80');
    expect(redacted).not.toContain('::');
    expect(redacted).toBe('Link 5ipv6/other#1');
  });

  it('jedes Hex-Wort mit zwei Doppelpunkten wird redigiert – Präfix mit drei Gruppen, Adresshälften, MAC-Adresse', () => {
    expect(notesOf('Praefix 2001:db8:aaaa/48 x')).toBe('Praefix ipv6/other#1/48 x');
    expect(notesOf('2001:db8:aaaa\n:bbbb:cccc:dddd:eeee:ffff')).toBe('ipv6/other#1\nipv6/other#2');
    expect(notesOf('MAC aa:bb:cc:dd:ee:ff und aa:bb:cc')).toBe('MAC ipv6/other#1 und ipv6/other#2');
  });

  it('echte Uhrzeiten und Versionsnummern bleiben bytegleich', () => {
    const text = 'Uhrzeit 16:24:25, 9:05:07 und 1:02:03, Version 1.2.3, Verhältnis 3.4 ms';
    expect(notesOf(text)).toBe(text);
  });

  it('eine Uhrzeit mit angeklebter Zone ist keine Uhrzeit: dahinter bleibt keine Adressgruppe stehen', () => {
    expect(notesOf('Verlust 5%2001:db8::77')).toBe('Verlust 5%ipv6/other#1');
    const glued = notesOf('16:24:25%2001:db8::77');
    expect(glued).not.toContain('2001');
    expect(glued).not.toContain('db8');
  });
});

/** Schlüsselpfade, die laut Positivliste bytegleich bleiben. */
const EXEMPT_PATHS = new Set(['id', 'createdAt', 'buildId', 'environment.userAgent', 'environment.buildId']);

/** Hängt an JEDEN nicht ausgenommenen String des Reports eine eigene Dokumentationsadresse. */
function plantAddressInEveryString(report: unknown): { dirty: LabReport; planted: string[] } {
  const planted: string[] = [];
  const next = (): string => {
    const n = planted.length + 1;
    const address = n % 2 === 0 ? `198.51.100.${n}` : `2001:db8:${n.toString(16)}::${n.toString(16)}`;
    planted.push(address);
    return address;
  };
  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === 'string') return EXEMPT_PATHS.has(path) ? node : `${node} ${next()}`;
    if (Array.isArray(node)) return node.map((child) => walk(child, `${path}[]`));
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child, path === '' ? key : `${path}.${key}`)]));
    }
    return node;
  };
  return { dirty: walk(report, '') as LabReport, planted };
}

describe('redactReport – Positivliste: jeder String wird gesäubert', () => {
  // Die ausgenommenen Felder tragen absichtlich etwas Adressförmiges: nur so zeigt „bytegleich“ die Ausnahme.
  const EXEMPT_VALUES = { id: 'r-192.0.2.201', createdAt: '2026-09-21T10:00:00.000Z 192.0.2.202', buildId: 'abc12345-192.0.2.203' };
  const ENVIRONMENT_BUILD_ID = 'abc12345-192.0.2.204';

  const dirtyReport = (): { dirty: LabReport; planted: string[] } => {
    const base = sampleReport({ ...EXEMPT_VALUES, failures: ['F2', 'F3'], valid: false, invalidReason: 'Grund' });
    base.environment.buildId = ENVIRONMENT_BUILD_ID;
    // Felder, die das Typmodell (noch) nicht kennt – auch ein gleichnamiges „id“ weiter unten ist NICHT ausgenommen.
    const extra: unknown = JSON.parse('{"id":"tief","userAgent":"tief","liste":["a",["b",{"c":"d"}]],"__proto__":"e"}');
    return plantAddressInEveryString({ ...base, lockTest: extra, spaeter: { localSdp: 'c=IN IP4' } });
  };

  it('die Fixture erreicht wirklich jedes Feld, das der Auftrag nennt', () => {
    const { dirty, planted } = dirtyReport();
    expect(planted.length).toBeGreaterThan(60);
    for (const text of [dirty.hello?.remoteBuildId, dirty.timeline[0]?.kind, dirty.cell.device, dirty.invalidReason, dirty.notes]) {
      expect(planted.some((address) => text?.endsWith(` ${address}`))).toBe(true);
    }
  });

  it('keine der Adressen überlebt – weder im JSON noch im Textbericht', () => {
    const { dirty, planted } = dirtyReport();
    const redacted = redactReport(dirty);
    const json = JSON.stringify(redacted);
    const text = reportToText(redacted);
    const survivors = planted.filter((address) => json.includes(address) || text.includes(address));
    expect(survivors).toEqual([]);
  });

  it('id, createdAt, buildId, environment.userAgent und environment.buildId bleiben bytegleich', () => {
    const redacted = redactReport(dirtyReport().dirty);
    expect({ id: redacted.id, createdAt: redacted.createdAt, buildId: redacted.buildId }).toEqual(EXEMPT_VALUES);
    expect(redacted.environment.buildId).toBe(ENVIRONMENT_BUILD_ID);
    expect(redacted.environment.userAgent).toBe(sampleReport().environment.userAgent);
    expect(redacted.environment.userAgent).toContain('Chrome/140.0.0.0');
  });

  it('Schlüssel, Zahlen und Wahrheitswerte bleiben unangetastet', () => {
    const { dirty } = dirtyReport();
    const redacted = redactReport(dirty);
    const skeleton = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, child: unknown) => (typeof child === 'string' ? '' : child)));
    expect(skeleton(redacted)).toEqual(skeleton(dirty));
  });

  it('ist idempotent: ein zweiter Durchlauf ändert nichts mehr', () => {
    for (const report of [dirtyReport().dirty, sampleReport()]) {
      const once = redactReport(report);
      expect(redactReport(once)).toEqual(once);
    }
  });

  it('ist auch dann idempotent, wenn hinter einem Token Ziffern kleben', () => {
    const mdns = `${['44444444', '4444', '4444', '4444', '444444444444'].join('-')}.local`;
    const once = redactReport(sampleReport({ gather: null, notes: `${mdns}.0.2.10 und ${mdns}:aa:bb` }));
    expect(once.notes).not.toContain('.0.2.10');
    expect(redactReport(once)).toEqual(once);
  });

  it('verändert die Eingabe nicht (tief eingefroren)', () => {
    const frozen = deepFreeze(dirtyReport().dirty);
    redactReport(frozen);
    expect(frozen).toEqual(dirtyReport().dirty);
  });
});

const base64Url = (text: string): string => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Modus „p“ (unkomprimiert): der Rumpf ist base64url des kompakten JSON – frei erfundene Werte, Dokumentationsadressen.
const COMPACT_JSON = JSON.stringify({
  v: 1,
  u: 'abcd',
  w: 'erfundenespasswort000000',
  c: ['1 1 udp 2122260223 192.0.2.10 50000 typ host', '2 1 udp 2122260222 2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff 50001 typ host'],
});
/** Auf ein Vielfaches von 64 aufgefüllt (samt sechs Kopfzeichen): so ist JEDE Umbruchzeile 64 Zeichen lang. */
const PAYLOAD_BODY = ((raw: string): string => raw + 'A'.repeat((64 - ((raw.length + 6) % 64)) % 64))(base64Url(COMPACT_JSON));
const wrapAt = (text: string, width: number): string[] => text.match(new RegExp(`.{1,${width}}`, 'g')) ?? [];

describe('redactReport – Payload-Text und SDP-Geheimnisse', () => {
  const payload = `MB1.p.${PAYLOAD_BODY}`;
  // Fix-Runde 3: der Fortsetzungs-Läufer ist weg, ein umbrochener Payload verschwindet Zeile für
  // Zeile (jede ab 32 Zeichen). Der Rumpf ist deshalb so aufgefüllt, dass JEDE Zeile 64 Zeichen hat.
  const lines = wrapAt(payload, 64);
  const chunks = (PAYLOAD_BODY.match(/.{1,24}/g) ?? []).filter((chunk) => chunk.length >= 12);

  it('die Fixture ist ein mehrzeiliger Payload mit lauter 64-Zeichen-Zeilen', () => {
    expect(lines.length).toBeGreaterThan(3);
    expect(chunks.length).toBeGreaterThan(8);
    expect(lines.every((line) => line.length === 64)).toBe(true);
  });

  it('entfernt den eigenen Payload-Text – am Stück, angeklebt und mit Zeilenumbrüchen', () => {
    const report = sampleReport({
      notes: `Code vom Host: ${payload} Ende, angeklebt: x${payload.toLowerCase()}`,
      timeline: [{ tMs: 1, kind: 'note', detail: `${lines.join('\n')}\n\nDanach ging nichts mehr` }],
    });
    const redacted = redactReport(report);
    const json = JSON.stringify(redacted);
    expect(json.toLowerCase()).not.toContain('mb1.');
    for (const chunk of chunks) expect(json.toLowerCase()).not.toContain(chunk.toLowerCase());
    for (const line of lines) expect(json).not.toContain(line);
    expect(redacted.notes).toBe('Code vom Host: payload/entfernt Ende, angeklebt: xpayload/entfernt');
    expect(redacted.timeline[0]?.detail).toBe(`${lines.map(() => 'payload/entfernt').join('\n')}\n\nDanach ging nichts mehr`);
  });

  it('ein Payload ohne Umbruch reißt das folgende Wort nicht mit', () => {
    expect(redactReport(sampleReport({ notes: `${payload}\nDanach` })).notes).toBe('payload/entfernt\nDanach');
  });

  it('entfernt ufrag, pwd und Fingerprint aus eingefügten SDP-Zeilen', () => {
    const fingerprint = Array.from({ length: 32 }, () => 'AB').join(':');
    const sdp = ['a=ice-ufrag:abcd', 'a=ice-pwd:erfundenespasswort000000', `a=fingerprint:sha-256 ${fingerprint}`, 'a=setup:actpass'];
    for (const lineBreak of ['\n', '\r\n']) {
      const redacted = redactReport(sampleReport({ gather: null, notes: sdp.join(lineBreak) }));
      expect(redacted.notes).toBe(['a=ice-ufrag:entfernt', 'a=ice-pwd:entfernt', 'a=fingerprint:entfernt', 'a=setup:actpass'].join(lineBreak));
    }
  });
});

describe('redactReport – unsichtbare Zeichen und Breitformen', () => {
  const ZWSP = '\u200B';
  const ZWJ = '\u200D';
  const SOFT_HYPHEN = '\u00AD';
  /** ASCII-Ziffern, Punkt und Doppelpunkt als Fullwidth-Formen (U+FF10…, U+FF0E, U+FF1A). */
  const fullwidth = (text: string): string =>
    [...text].map((char) => (/[0-9.:]/.test(char) ? String.fromCodePoint(char.charCodeAt(0) + 0xfee0) : char)).join('');

  it('die Fixtures enthalten die Adresse wirklich nicht mehr im Klartext', () => {
    expect(fullwidth('203.0.113.77')).not.toMatch(/[0-9.]/);
    expect(`203.0.${ZWSP}113.77`).not.toContain('203.0.113.77');
  });

  it('redigiert IPv4 und IPv6 trotz ZWSP, weichem Trennstrich und Fullwidth-Ziffern', () => {
    const notesOf = (notes: string): string => redactReport(sampleReport({ gather: null, notes })).notes;
    expect(notesOf(`A 203.0.${ZWSP}113.77 B`)).toBe('A ipv4/other#1 B');
    expect(notesOf(`A 203.0.${SOFT_HYPHEN}113.77 B`)).toBe('A ipv4/other#1 B');
    expect(notesOf(`A ${fullwidth('203.0.113.77')} B`)).toBe('A ipv4/other#1 B');
    expect(notesOf(`A 2001:db8:${ZWSP}:77 B`)).toBe('A ipv6/other#1 B');
    expect(notesOf(`A 2001:${SOFT_HYPHEN}db8::77 B`)).toBe('A ipv6/other#1 B');
    expect(notesOf(`A ${fullwidth('2001:db8::77')} B`)).toBe('A ipv6/other#1 B');
  });

  it('eine bekannte Adresse bekommt auch mit unsichtbarem Zeichen ihr Token – im Text wie in gathered', () => {
    expect(redactReport(sampleReport({ notes: `gesehen: 192.0.${ZWJ}2.10` })).notes).toBe('gesehen: ipv4/global#1');
    const hidden = `labor${SOFT_HYPHEN}-pc.example`;
    const report = sampleReport({ gather: gatherOf([otherCandidate(1, hidden, 50001)]), notes: `erst ${hidden}, dann LABOR-PC.EXAMPLE` });
    const redacted = redactReport(report);
    expect(redacted.notes).toBe('erst other/other#1, dann other/other#1');
    expect(JSON.stringify(redacted).toLowerCase()).not.toContain('labor');
  });
});

describe('redactReport – lange Läufe ohne Leerraum', () => {
  const SIZE = 200_000;
  const run = (unit: string): string => unit.repeat(Math.ceil(SIZE / unit.length));
  // Ziffern+Punkte, Hex+Doppelpunkte, base64-artig, „.loca“-Beinahe-Treffer, reines Hex.
  const UNITS = ['1.', 'a:', 'QUJDREVGR0g0NTY3', 'x.loca', 'abcdef0123456789'];

  // Bewusst OHNE Adresse im Lauf: ein „.local“ HINTER dem Lauf ließe ein unbegrenztes mDNS-Muster den
  // ganzen Lauf in EINEM Treffer schlucken – dann wäre gerade der quadratische Fall nicht mehr im Test.
  it('fünf reine 200-kB-Läufe sind innerhalb des normalen Zeitlimits fertig', () => {
    for (const unit of UNITS) {
      const notes = run(unit);
      expect(notes.length).toBeGreaterThanOrEqual(SIZE);
      expect(() => redactReport(sampleReport({ gather: null, notes }))).not.toThrow();
    }
  });

  // Ein unbegrenztes IPv6-Wortmuster ist NUR auf reinem Hex/Ziffern quadratisch und bliebe bei 200 kB
  // (gemessen ~15 s) unter dem Zeitlimit von 30 s. Erst dieser größere Lauf macht die Grenze sichtbar.
  it('ein reiner Hex-Lauf von 800 kB ist innerhalb des normalen Zeitlimits fertig', () => {
    const notes = 'abcdef0123456789'.repeat(50_000);
    expect(notes.length).toBe(800_000);
    // Seit Fix-Runde 3 ist ein base64url-Lauf ab 32 Zeichen selbst ein Payload-Verdacht: vom Lauf
    // bleiben nur noch Tokens übrig. Der Zeitbeleg für die IPv6-Grenze hängt daran nicht – die
    // Adressmuster laufen VOR dem Payload-Durchlauf über den ganzen Text.
    const redacted = redactReport(sampleReport({ gather: null, notes })).notes;
    expect(redacted).not.toContain('abcdef');
    expect(redacted.replace(/payload\/entfernt/g, '')).toBe('');
  });

  // Die Gruppen-ANZAHL beider Adressmuster ist gedeckelt: ohne Deckel läuft bei rund 8 MB der
  // Backtracking-Stack der RegExp über (RangeError) – redactReport käme gar nicht erst zum Ergebnis.
  it('ein 8-MB-Lauf aus Ziffern und Punkten bzw. Hex und Doppelpunkten wirft nicht', () => {
    for (const unit of ['1.2.3.', 'ab:cd:']) {
      const notes = unit.repeat(Math.floor(8_000_000 / unit.length));
      expect(notes.length).toBeGreaterThanOrEqual(7_999_990);
      expect(() => redactReport(sampleReport({ gather: null, notes }))).not.toThrow();
    }
  });

  it('Adressen VOR einem 200-kB-Lauf sind trotzdem weg', () => {
    const mdns = `${['55555555', '5555', '5555', '5555', '555555555555'].join('-')}.local`;
    for (const unit of UNITS) {
      const notes = `${mdns}192.0.2.55 2001:db8::77 ${run(unit)}`;
      const json = JSON.stringify(redactReport(sampleReport({ gather: null, notes })));
      expect(json).not.toContain('192.0.2.55');
      expect(json).not.toContain(mdns);
      expect(json).not.toContain('2001:db8::77');
    }
  });
});

describe('reportToText', () => {
  it('beginnt mit Kopf: ID, Zeitpunkt, Build, Zellenlabel, Gültigkeit', () => {
    const lines = reportToText(sampleReport()).split('\n');
    expect(lines.slice(0, 6)).toEqual([
      'Mäusebau-Laborbericht',
      'ID: r-2026-09-21-0001',
      'Erstellt: 2026-09-21T10:00:00.000Z',
      'Build: abc12345 (Protokoll v1)',
      'Zelle: Rolle host · Hotspot dieses-geraet · Kamera an · Pfad text · Gerät Pixel-A',
      'Gültig: ja',
    ]);
  });

  it('nennt bei ungültigen Läufen den Grund', () => {
    const text = reportToText(sampleReport({ valid: false, invalidReason: 'Kamera an, aber Berechtigung ist nicht erteilt' }));
    expect(text).toContain('Gültig: NEIN – Kamera an, aber Berechtigung ist nicht erteilt');
  });

  it('enthält Umgebung und Berechtigungen', () => {
    const text = reportToText(sampleReport());
    expect(text).toContain('  Browser: Mozilla/5.0 (Linux; Android 14)');
    expect(text).toContain('  Engine: chromium · Anzeige: standalone · Seiten-Build: abc12345');
    expect(text).toContain('  Sicherer Kontext: ja · Online: nein · Service Worker steuert: ja');
    expect(text).toContain('BarcodeDetector ja (qr_code, ean_13)');
    expect(text).toContain('  Kamera: granted · Lokales Netzwerk: prompt · Loopback-Netzwerk: unsupported');
    expect(text).toContain('  getUserMedia in dieser Sitzung: ja');
  });

  it('fasst Kandidaten nach Familie/Scope mit Anzahl zusammen – ohne Adressen', () => {
    const text = reportToText(sampleReport());
    expect(text).toContain('  gesammelt 5, übertragen 5, Dauer 118.4 ms, Timeout nein');
    expect(text).toContain('  3× ipv4/global');
    expect(text).toContain('  1× ipv6/global');
    expect(text).toContain('  1× mdns/mdns');
    for (const address of sampleAddresses()) expect(text).not.toContain(address);
  });

  it('enthält Payload-Größen, gewähltes Paar, Hello, Ping je Kanal, Befunde und Zeitleiste', () => {
    const text = reportToText(sampleReport({ failures: ['F2', 'F3'] }));
    expect(text).toContain('  SDP 912 B → minimiert 498 B → gepackt 371 B → Text 501 Zeichen (komprimiert)');
    expect(text).toContain('  Paar: lokal host/udp ipv4/global ↔ entfernt host ipv4/global, RTT 4 ms');
    expect(text).toContain('  SCTP maxMessageSize: 262144');
    expect(text).toContain('  Hello: Gegenstelle Build abc12345, Protokoll v1, Versionen passen: ja');
    expect(text).toContain('  state: gesendet 200, empfangen 197, Verlust 1.5 %, RTT min 2.1 / Median 3.4 / p95 9.3 / max 31 ms, außer der Reihe 2');
    expect(text).toContain('  events: gesendet 200, empfangen 200, Verlust 0 %, RTT min 2.3 / Median 3.6 / p95 8 / max 27.5 ms, außer der Reihe 0');
    expect(text).toContain('Befunde: F2, F3');
    expect(text).toContain('  +0 ms pc-created');
    expect(text).toContain('  +14.6 ms candidate – host/ipv4');
    expect(text).toContain('Notizen: Beide Geräte im selben WLAN, Abstand 2 m.');
  });

  it('kommt mit leeren Abschnitten zurecht', () => {
    const text = reportToText(
      sampleReport({
        gather: null,
        payloadSizes: null,
        selectedPair: null,
        sctpMaxMessageSize: null,
        hello: null,
        ping: { state: null, events: null },
        pairing: null,
        qr: null,
        lockTest: null,
        failures: [],
        timeline: [],
        notes: '',
      }),
    );
    expect(text).toContain('  kein Gathering');
    expect(text).toContain('  Payload: keiner');
    expect(text).toContain('  Paar: keines gewählt');
    expect(text).toContain('  SCTP maxMessageSize: unbekannt');
    expect(text).toContain('  Hello: nicht ausgetauscht');
    expect(text).toContain('  state: nicht gemessen');
    expect(text).toContain('  events: nicht gemessen');
    expect(text).toContain('Befunde: keine');
    expect(text).toContain('  (leer)');
    expect(text).toContain('Notizen: –');
    expect(text).toContain('  keine Messung');
  });
});

describe('reportsToJson', () => {
  it('liefert hübsch formatiertes JSON, das sich verlustfrei zurücklesen lässt', () => {
    const reports = [sampleReport(), sampleReport({ id: 'r-2' })];
    const json = reportsToJson(reports);
    expect(json).toBe(JSON.stringify(reports, null, 2));
    expect(json).toContain('\n  {\n    "id": "r-2026-09-21-0001"');
    expect(JSON.parse(json)).toEqual(reports);
    expect(reportsToJson([])).toBe('[]');
  });
});

type FakeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> };

/** Speicher im Arbeitsspeicher; `capacity` ahmt das Quota nach (setItem wirft bei längeren Werten). */
function memoryStorage(capacity = Number.POSITIVE_INFINITY): FakeStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (value.length > capacity) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const ids = (reports: readonly LabReport[]): string[] => reports.map((report) => report.id);

/** Flache Kopie ohne den genannten Schlüssel. */
function without(value: object, key: string): unknown {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

describe('createReportStore', () => {
  it('benutzt den vereinbarten Schlüssel', () => {
    expect(REPORT_STORE_KEY).toBe('maeusebau.lab.reports.v1');
  });

  it('ist anfangs leer und liefert neue Reports zuerst', () => {
    const storage = memoryStorage();
    const store = createReportStore(storage);
    expect(store.list()).toEqual([]);

    store.add(sampleReport({ id: 'a' }));
    store.add(sampleReport({ id: 'b' }));

    expect(ids(store.list())).toEqual(['b', 'a']);
    expect(store.list()[1]).toEqual(sampleReport({ id: 'a' }));
    expect(JSON.parse(storage.data.get(REPORT_STORE_KEY) ?? 'null')).toHaveLength(2);
  });

  it('ein zweiter Store über demselben Speicher sieht dieselben Reports', () => {
    const storage = memoryStorage();
    createReportStore(storage).add(sampleReport({ id: 'a' }));
    expect(ids(createReportStore(storage).list())).toEqual(['a']);
  });

  it('behält höchstens 50 Reports und lässt die ältesten fallen', () => {
    const store = createReportStore(memoryStorage());
    for (let n = 1; n <= 55; n += 1) store.add(sampleReport({ id: `r${n}` }));
    const listed = ids(store.list());
    expect(listed).toHaveLength(50);
    expect(listed[0]).toBe('r55');
    expect(listed[49]).toBe('r6');
  });

  it('respektiert ein eigenes Maximum', () => {
    const store = createReportStore(memoryStorage(), 3);
    for (const id of ['a', 'b', 'c', 'd']) store.add(sampleReport({ id }));
    expect(ids(store.list())).toEqual(['d', 'c', 'b']);
  });

  it('ersetzt einen Report mit derselben ID, statt ihn doppelt zu führen', () => {
    const store = createReportStore(memoryStorage());
    store.add(sampleReport({ id: 'a', notes: 'alt' }));
    store.add(sampleReport({ id: 'b' }));
    store.add(sampleReport({ id: 'a', notes: 'neu' }));
    expect(ids(store.list())).toEqual(['a', 'b']);
    expect(store.list()[0]?.notes).toBe('neu');
  });

  it('defektes JSON ergibt eine leere Liste und wird beim nächsten add überschrieben', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, '{"kaputt":');
    const store = createReportStore(storage);
    expect(store.list()).toEqual([]);

    store.add(sampleReport({ id: 'a' }));

    expect(ids(store.list())).toEqual(['a']);
    expect(ids(JSON.parse(storage.data.get(REPORT_STORE_KEY) ?? '[]') as LabReport[])).toEqual(['a']);
  });

  it('eine falsche Form ergibt eine leere Liste; fremde Einträge in einer Liste werden aussortiert', () => {
    const storage = memoryStorage();
    const store = createReportStore(storage);
    for (const bad of ['{"id":"a"}', '42', 'null', '"text"']) {
      storage.data.set(REPORT_STORE_KEY, bad);
      expect(store.list()).toEqual([]);
    }
    storage.data.set(REPORT_STORE_KEY, JSON.stringify([null, 7, { id: 'halb' }, sampleReport({ id: 'gut' })]));
    expect(ids(store.list())).toEqual(['gut']);
  });

  it('add wirft nicht, wenn setItem scheitert', () => {
    const storage = memoryStorage(0);
    const store = createReportStore(storage);
    expect(() => store.add(sampleReport({ id: 'a' }))).not.toThrow();
    expect(store.list()).toEqual([]);
  });

  it('bei vollem Speicher weichen die ältesten Reports, der neue bleibt', () => {
    const oneReport = JSON.stringify([sampleReport({ id: 'r1' })]).length;
    const store = createReportStore(memoryStorage(Math.floor(oneReport * 3.5)));
    for (let n = 1; n <= 6; n += 1) store.add(sampleReport({ id: `r${n}` }));
    const listed = ids(store.list());
    expect(listed[0]).toBe('r6');
    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(listed.length).toBeLessThanOrEqual(3);
  });

  it('list und clear werfen nicht, wenn der Speicher gesperrt ist', () => {
    const blocked: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const store = createReportStore(blocked);
    expect(store.list()).toEqual([]);
    expect(() => store.add(sampleReport())).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });

  it('clear entfernt den Schlüssel', () => {
    const storage = memoryStorage();
    const store = createReportStore(storage);
    store.add(sampleReport());
    store.clear();
    expect(store.list()).toEqual([]);
    expect(storage.data.has(REPORT_STORE_KEY)).toBe(false);
  });
});

describe('createReportStore – verschachtelte Report-Form', () => {
  const malformed: Array<{ label: string; report: unknown }> = [
    { label: 'gather ist leeres Objekt', report: { ...sampleReport({ id: 'a' }), gather: {} } },
    {
      label: 'gather.gathered ist kein Array',
      report: { ...sampleReport({ id: 'b' }), gather: { durationMs: 1, timedOut: false, gathered: 'nope', transmitted: 1 } },
    },
    {
      label: 'gather.gathered-Eintrag ohne address/raw',
      report: { ...sampleReport({ id: 'c' }), gather: { durationMs: 1, timedOut: false, gathered: [{ foo: 1 }], transmitted: 1 } },
    },
    {
      label: 'gather.transmitted ist keine Zahl',
      report: { ...sampleReport({ id: 'd' }), gather: { durationMs: 1, timedOut: false, gathered: [], transmitted: 'x' } },
    },
    { label: 'payloadSizes ist kein Objekt/null', report: { ...sampleReport({ id: 'e' }), payloadSizes: 'nope' } },
    { label: 'selectedPair ist kein Objekt/null', report: { ...sampleReport({ id: 'f' }), selectedPair: 'nope' } },
    { label: 'hello ist kein Objekt/null', report: { ...sampleReport({ id: 'g' }), hello: 'nope' } },
    { label: 'ping.state ist kein Objekt/null', report: { ...sampleReport({ id: 'h' }), ping: { state: 'nope', events: null } } },
    { label: 'timeline-Eintrag ohne detail', report: { ...sampleReport({ id: 'i' }), timeline: [{ tMs: 1, kind: 'x' }] } },
    { label: 'notes ist keine Zeichenkette', report: { ...sampleReport({ id: 'j' }), notes: 42 } },
    { label: 'cell.device ist keine Zeichenkette', report: { ...sampleReport({ id: 'k' }), cell: { ...sampleReport().cell, device: 42 } } },
    {
      label: 'environment.features.barcodeFormats ist kein Array',
      report: {
        ...sampleReport({ id: 'l' }),
        environment: { ...sampleReport().environment, features: { ...sampleReport().environment.features, barcodeFormats: 'nope' } },
      },
    },
    // Re-Review S9: jede dieser Zeilen bricht genau EINE Klausel.
    {
      label: 'gather.gathered-Eintrag ohne raw',
      report: { ...sampleReport({ id: 'm' }), gather: { durationMs: 1, timedOut: false, gathered: [without(sampleCandidate(1, 'udp', '192.0.2.77', 9, 'ipv4', 'global'), 'raw')], transmitted: 1 } },
    },
    {
      label: 'gather.gathered-Eintrag ohne address',
      report: { ...sampleReport({ id: 'n' }), gather: { durationMs: 1, timedOut: false, gathered: [without(sampleCandidate(1, 'udp', '192.0.2.77', 9, 'ipv4', 'global'), 'address')], transmitted: 1 } },
    },
    { label: 'ping ohne events', report: { ...sampleReport({ id: 'o' }), ping: { state: null } } },
    { label: 'ping ist null', report: { ...sampleReport({ id: 'p' }), ping: null } },
    { label: 'permissions ist null', report: { ...sampleReport({ id: 'q' }), permissions: null } },
    { label: 'failures ist kein Array', report: { ...sampleReport({ id: 'r' }), failures: 'F1' } },
    { label: 'timeline ist kein Array', report: { ...sampleReport({ id: 's' }), timeline: 'x' } },
    { label: 'cell ist ein Array', report: { ...sampleReport({ id: 't' }), cell: [] } },
    { label: 'hello ist ein Array', report: { ...sampleReport({ id: 'u' }), hello: [] } },
    { label: 'protoV ist ein Objekt', report: { ...sampleReport({ id: 'v' }), protoV: { toString: 1 } } },
    { label: 'cell.role ist ein Objekt', report: { ...sampleReport({ id: 'w' }), cell: { ...sampleReport().cell, role: { toString: 1, valueOf: 1 } } } },
  ];
  const validReport = sampleReport({ id: 'gut' });

  type Path = ReadonlyArray<string | number>;
  type Change = { set: unknown } | 'fehlt';

  /** Beispiel-Report als reines JSON, an GENAU einer Stelle verändert. */
  function changedAt(path: Path, change: Change): unknown {
    const report: unknown = JSON.parse(JSON.stringify(sampleReport({ id: 'kaputt' })));
    let node = report as Record<string, unknown>;
    for (const key of path.slice(0, -1)) node = node[String(key)] as Record<string, unknown>;
    const last = String(path[path.length - 1]);
    if (change === 'fehlt') delete node[last];
    else node[last] = change.set;
    return report;
  }

  const FIRST_CANDIDATE: Path = ['gather', 'gathered', 0];
  const FIRST_EVENT: Path = ['timeline', 0];
  const PING_FIELDS = ['sent', 'received', 'lossPct', 'minMs', 'medianMs', 'p95Ms', 'maxMs', 'outOfOrder'];
  const FEATURE_FLAGS = ['rtc', 'compressionStream', 'wakeLock', 'barcodeDetector', 'storagePersist', 'shareText', 'clipboardWrite'];
  const PAIR_STRINGS = ['localType', 'localProtocol', 'localFamily', 'localScope', 'remoteType', 'remoteFamily', 'remoteScope'];
  const PAIRING_MARKS = ['offerShownAt', 'offerScannedMs', 'answerShownAt', 'answerScannedMs', 'connectedMs', 'projectedLobbyFullMs'];
  const QR_NUMBERS = ['offerChars', 'answerChars', 'decodeLatencyMs', 'attempts'];

  // Jede Klausel von looksLikeReport: Pfad plus die Werte, die dort NICHT stehen dürfen.
  const CLAUSES: Array<{ kind: string; paths: Path[]; wrong: unknown[] }> = [
    {
      kind: 'Zeichenkette',
      paths: [
        ['id'], ['createdAt'], ['buildId'], ['notes'],
        ...['role', 'hotspotOwner', 'camera', 'path', 'device'].map((key) => ['cell', key]),
        ...['userAgent', 'engine', 'displayMode', 'buildId'].map((key) => ['environment', key]),
        ...['camera', 'localNetwork', 'loopbackNetwork'].map((key) => ['permissions', key]),
        ...['address', 'raw', 'foundation', 'family', 'scope'].map((key) => [...FIRST_CANDIDATE, key]),
        ...['kind', 'detail'].map((key) => [...FIRST_EVENT, key]),
        ...PAIR_STRINGS.map((key) => ['selectedPair', key]),
        ['hello', 'remoteBuildId'],
        ['qr', 'backend'],
      ],
      wrong: [42, null, true, { a: 1 }, { toString: 1 }, ['x']],
    },
    {
      kind: 'Zahl',
      paths: [
        ['protoV'], ['gather', 'durationMs'], ['gather', 'transmitted'], [...FIRST_EVENT, 'tMs'], ['hello', 'remoteProtoV'],
        ...['sdpBytes', 'minimisedBytes', 'packedBytes', 'textChars'].map((key) => ['payloadSizes', key]),
        ...PING_FIELDS.map((key) => ['ping', 'state', key]),
        ...PING_FIELDS.map((key) => ['ping', 'events', key]),
        ...QR_NUMBERS.map((key) => ['qr', key]),
      ],
      wrong: ['7', null, true, { a: 1 }, { valueOf: 1 }, [1]],
    },
    {
      kind: 'Wahrheitswert',
      paths: [
        ['valid'], ['gumCalledThisSession'], ['gather', 'timedOut'], ['payloadSizes', 'compressed'], ['hello', 'versionMatch'],
        ...['secureContext', 'online', 'swControlled'].map((key) => ['environment', key]),
        ...FEATURE_FLAGS.map((key) => ['environment', 'features', key]),
      ],
      wrong: ['ja', 0, null, { a: 1 }, [true]],
    },
    { kind: 'Zeichenkette oder null', paths: [['invalidReason']], wrong: [42, true, { a: 1 }, ['x']] },
    {
      kind: 'Zahl oder null',
      paths: [['sctpMaxMessageSize'], ['selectedPair', 'currentRttMs'], ...PAIRING_MARKS.map((key) => ['pairing', key])],
      wrong: ['7', true, { a: 1 }, [1]],
    },
    {
      kind: 'Objekt',
      paths: [['cell'], ['environment'], ['environment', 'features'], ['permissions'], ['ping'], FIRST_CANDIDATE, FIRST_EVENT],
      wrong: [null, 'x', 42, true, [], [{}]],
    },
    {
      kind: 'Objekt oder null',
      paths: [['gather'], ['payloadSizes'], ['selectedPair'], ['hello'], ['ping', 'state'], ['ping', 'events']],
      wrong: ['x', 42, true, [], {}],
    },
    {
      kind: 'Liste von Zeichenketten',
      paths: [['failures'], ['environment', 'features', 'barcodeFormats']],
      wrong: ['F1', 42, null, {}, [42], [null], [{}], ['F1', { toString: 1 }]],
    },
    { kind: 'Liste von Objekten', paths: [['timeline'], ['gather', 'gathered']], wrong: ['x', 42, null, {}, ['x'], [null], [[]]] },
  ];
  // `pairing` und `qr` DÜRFEN fehlen (M1-Reports, absentOrNullOr) – deshalb stehen sie nicht in
  // CLAUSES, wo jede Zeile auch eine „fehlt"-Variante erzeugt, sondern hier nur mit falschen Werten.
  const ABSENT_OK: Array<{ kind: string; paths: Path[]; wrong: unknown[] }> = [
    { kind: 'Objekt, null oder fehlend', paths: [['pairing'], ['qr']], wrong: ['x', 42, true, [], {}] },
  ];
  const clauseRows: Array<{ label: string; report: unknown }> = [
    ...CLAUSES.flatMap(({ kind, paths, wrong }) =>
      paths.flatMap((path) => [
        { label: `${path.join('.')} fehlt (${kind})`, report: changedAt(path, 'fehlt') },
        ...wrong.map((value) => ({ label: `${path.join('.')} = ${JSON.stringify(value)} (${kind})`, report: changedAt(path, { set: value }) })),
      ]),
    ),
    ...ABSENT_OK.flatMap(({ kind, paths, wrong }) =>
      paths.flatMap((path) => wrong.map((value) => ({ label: `${path.join('.')} = ${JSON.stringify(value)} (${kind})`, report: changedAt(path, { set: value }) }))),
    ),
  ];

  /**
   * Gespeicherter Text eines Reports mit einem UNBEKANNTEN Feld, das `depth` Ebenen tief verschachtelt
   * ist: unbekannte Zusatzfelder ignoriert die Formprüfung, die Tiefenprüfung nicht. (Bis M1 trug
   * `lockTest` diese Rolle – seit M2 hat es eine eigene Form und taugt dafür nicht mehr.)
   */
  const nestedEntry = (id: string, depth: number): string =>
    `{"tiefe":${'['.repeat(depth)}${']'.repeat(depth)},${JSON.stringify(sampleReport({ id })).slice(1)}`;
  const storedList = (entries: readonly string[]): string => `[${entries.join(',')}]`;

  it('filtert Einträge mit richtigen Top-Level-Feldern, aber falscher verschachtelter Form aus', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, JSON.stringify([validReport, ...malformed.map((entry) => entry.report)]));
    const store = createReportStore(storage);
    expect(ids(store.list())).toEqual(['gut']);
  });

  it('jede Klausel der Formprüfung für sich: ein einzelner falscher oder fehlender Wert sortiert den Eintrag aus', () => {
    expect(clauseRows.length).toBeGreaterThan(500);
    const storage = memoryStorage();
    const store = createReportStore(storage);
    const accepted: string[] = [];
    for (const { label, report } of [...malformed, ...clauseRows]) {
      storage.data.set(REPORT_STORE_KEY, JSON.stringify([report]));
      if (store.list().length > 0) accepted.push(label);
    }
    expect(accepted).toEqual([]);
  });

  it('die Formprüfung ist nicht überstreng: leere Abschnitte, ein anonymisierter Report und ein mäßig verschachteltes Zusatzfeld bleiben', () => {
    const empty = sampleReport({
      id: 'leer',
      gather: null,
      payloadSizes: null,
      selectedPair: null,
      sctpMaxMessageSize: null,
      hello: null,
      ping: { state: null, events: null },
      timeline: [],
    });
    const pair = sampleReport().selectedPair;
    const noRtt = sampleReport({ id: 'ohne-rtt', selectedPair: pair === null ? null : { ...pair, currentRttMs: null }, valid: false, invalidReason: 'Grund' });
    const storage = memoryStorage();
    storage.data.set(
      REPORT_STORE_KEY,
      storedList([JSON.stringify(empty), JSON.stringify(noRtt), JSON.stringify(redactReport(sampleReport({ id: 'anonym' }))), nestedEntry('flach', 4)]),
    );
    expect(ids(createReportStore(storage).list())).toEqual(['leer', 'ohne-rtt', 'anonym', 'flach']);
  });

  it('ein zu tief verschachtelter Eintrag wird aussortiert – knapp über der Grenze wie bei 5000 Ebenen', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, storedList([nestedEntry('tief', 9), nestedEntry('sehr-tief', 5000), JSON.stringify(validReport)]));
    expect(ids(createReportStore(storage).list())).toEqual(['gut']);
  });

  it('für alles, was list() zurückgibt, werfen reportToText, reportsToJson und redactReport nicht – und der Text enthält keinen Datenmüll', () => {
    const storage = memoryStorage();
    storage.data.set(
      REPORT_STORE_KEY,
      storedList([JSON.stringify(validReport), nestedEntry('sehr-tief', 5000), ...[...malformed, ...clauseRows].map((entry) => JSON.stringify(entry.report))]),
    );
    const store = createReportStore(storage);
    const listed = store.list();
    expect(listed.length).toBeGreaterThan(0);
    for (const report of listed) {
      expect(() => redactReport(report)).not.toThrow();
      for (const text of [reportToText(report), reportToText(redactReport(report))]) {
        for (const garbage of ['undefined', 'NaN', '[object Object]']) expect(text).not.toContain(garbage);
      }
    }
    expect(() => reportsToJson(listed)).not.toThrow();
  });

  it('ein vergifteter Eintrag im Speicher kostet beim nächsten add() keinen gesunden Report (M12)', () => {
    const healthy = Array.from({ length: 10 }, (_, index) => `g${index + 1}`);
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, storedList([nestedEntry('gift', 5000), ...healthy.map((id) => JSON.stringify(sampleReport({ id })))]));
    const store = createReportStore(storage);

    store.add(sampleReport({ id: 'neu' }));

    expect(ids(store.list())).toEqual(['neu', ...healthy]);
    expect(storage.data.get(REPORT_STORE_KEY)).not.toContain('"gift"');
  });

  it('add() wirft auch dann nicht, wenn sich der neue Report nicht serialisieren lässt – der Verlauf bleibt', () => {
    const storage = memoryStorage();
    const store = createReportStore(storage, 3);
    for (const id of ['a', 'b', 'c']) store.add(sampleReport({ id }));
    const unserialisable = { ...sampleReport({ id: 'zyklus' }), lockTest: 1n } as unknown as LabReport;

    expect(() => store.add(unserialisable)).not.toThrow();

    expect(ids(store.list())).toEqual(['c', 'b', 'a']);
  });
});

// ───────── Fix-Runde 3 (T12–T17) ─────────

describe('redactReport – Payload-Schwaerzung laeuft HINTER dem Adress-Durchlauf (T12)', () => {
  const UNKNOWN_IPV4 = '203.0.113.77';
  const KNOWN_IPV4 = '192.0.2.10';
  const UNKNOWN_IPV6 = '2001:db8:9999::42';
  const unknownMdns = (): string => `${['66666666', '6666', '6666', '6666', '666666666666'].join('-')}.local`;
  const HEADS = ['MB1.d.', 'MB1.p.', 'mb1.d.'];
  const WIDTHS = [21, 25, 32, 40, 64, 76];
  /** Zeilenumbruch, Leerzeichen, Leerzeile, direkt angeklebt. */
  const GAPS = ['\n', ' ', '\n\n', ''];

  /** Was von der Adresse nirgends mehr stehen darf: zwei Oktette bzw. erkennbare Gruppen. */
  const fragmentsOf = (address: string): string[] => {
    if (address.endsWith('.local')) return ['6666'];
    if (address.includes(':')) return ['db8', '9999', '::'];
    const octets = address.split('.');
    return [`.${octets.slice(1).join('.')}`, `.${octets.slice(2).join('.')}`];
  };

  it('kein Adressrest ueberlebt einen Payload davor – Kopf × Breite × Abstand × Adresse', () => {
    const failures: string[] = [];
    for (const head of HEADS) {
      for (const width of WIDTHS) {
        for (const gap of GAPS) {
          for (const address of [UNKNOWN_IPV4, KNOWN_IPV4, UNKNOWN_IPV6, unknownMdns()]) {
            const notes = `${wrapAt(`${head}${PAYLOAD_BODY}`, width).join('\n')}${gap}${address} ist das Handy`;
            const redacted = redactReport(sampleReport({ notes }));
            const json = JSON.stringify(redacted).toLowerCase();
            const left = fragmentsOf(address).filter((fragment) => redacted.notes.toLowerCase().includes(fragment.toLowerCase()));
            if (json.includes(address.toLowerCase()) || left.length > 0) {
              failures.push(`${head} ${width} ${JSON.stringify(gap)} ${address} -> ${JSON.stringify(redacted.notes.slice(-40))}`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('ein auf 64 Zeichen umbrochener Rumpf ueberlebt nicht – auch ohne Kopf, mit geteiltem Kopf und zitiert', () => {
    const chunks = (PAYLOAD_BODY.match(/.{1,32}/g) ?? []).filter((chunk) => chunk.length === 32);
    expect(chunks.length).toBeGreaterThan(5);
    for (const notes of [
      wrapAt(`MB1.d.${PAYLOAD_BODY}`, 64).join('\n'),
      wrapAt(PAYLOAD_BODY, 64).join('\n'),
      `MB1.\nd.${PAYLOAD_BODY}`,
      `Code: ${PAYLOAD_BODY}`,
      `MB1.p.${wrapAt(PAYLOAD_BODY, 64).join('\n> ')}`,
    ]) {
      const json = JSON.stringify(redactReport(sampleReport({ gather: null, notes })));
      for (const chunk of chunks) expect(json).not.toContain(chunk);
    }
  });

  it('jeder Modus-Kopf verschwindet – „MB1.d.“ wie „MB1.p.“, auch klein geschrieben', () => {
    for (const head of ['MB1.d.', 'MB1.p.', 'mb1.d.', 'MB1.D.']) {
      expect(redactReport(sampleReport({ gather: null, notes: `Code: ${head}${PAYLOAD_BODY} Ende` })).notes).toBe('Code: payload/entfernt Ende');
    }
  });

  it('die ausgenommenen Felder bleiben bytegleich, auch mit einem langen base64url-Lauf darin', () => {
    const long = 'r-2026-09-21-0001-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
    expect(long).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const original = sampleReport({ id: long, createdAt: `${long}-erstellt`, buildId: `${long}-build` });
    original.environment = { ...original.environment, userAgent: `${long}-ua`, buildId: `${long}-env` };
    const redacted = redactReport(original);
    expect(redacted.id).toBe(original.id);
    expect(redacted.createdAt).toBe(original.createdAt);
    expect(redacted.buildId).toBe(original.buildId);
    expect(redacted.environment.userAgent).toBe(original.environment.userAgent);
    expect(redacted.environment.buildId).toBe(original.environment.buildId);
  });

  it('ein 2-MB-base64url-Lauf ist innerhalb des normalen Zeitlimits fertig und laesst nichts uebrig', () => {
    const notes = 'QUJDREVGR0g0NTY3'.repeat(125_000);
    expect(notes.length).toBe(2_000_000);
    const redacted = redactReport(sampleReport({ gather: null, notes })).notes;
    expect(redacted).not.toContain('QUJD');
    expect(redacted.replace(/payload\/entfernt/g, '')).toBe('');
  });
});

describe('redactReport – Kandidaten-Geheimnisse ueberall, nicht nur in raw (T13)', () => {
  const SECRET = 'Zq7Kgeheim';
  const FOUNDATION = '7771234';
  const FORMS: Array<{ label: string; text: string; secret: string }> = [
    { label: 'ufrag <wert>', text: `generation 0 ufrag ${SECRET} network-id 1`, secret: SECRET },
    { label: 'UFRAG<tab><wert>', text: `generation 0 UFRAG\t${SECRET} network-id 1`, secret: SECRET },
    { label: 'usernameFragment":"x"', text: `{"candidate":"1 1 udp 1 203.0.113.77 1 typ host","usernameFragment":"${SECRET}"}`, secret: SECRET },
    { label: 'usernameFragment=x', text: `usernameFragment=${SECRET}`, secret: SECRET },
    { label: 'usernameFragment: x', text: `usernameFragment: ${SECRET}`, secret: SECRET },
    { label: 'candidate:<foundation>', text: `candidate:${FOUNDATION} 1 udp 2122260223 203.0.113.77 50001 typ host generation 0`, secret: FOUNDATION },
    { label: 'A=CANDIDATE: <foundation>', text: `A=CANDIDATE: ${FOUNDATION} 1 udp 2122260223 203.0.113.77 50001 typ host`, secret: FOUNDATION },
  ];

  it('jede Form verliert ihren Wert – in notes, in einem Zeitleisten-Detail und in einem unbekannten Listenfeld', () => {
    for (const { label, text, secret } of FORMS) {
      const report = {
        ...sampleReport({ gather: null, notes: text, timeline: [{ tMs: 1, kind: 'note', detail: text }] }),
        remoteCandidates: [text],
      } as unknown as LabReport;
      expect(JSON.stringify(redactReport(report)), label).not.toContain(secret);
    }
  });

  it('die allgemeine Foundation-Regel ueberschreibt das Ordinal in raw nicht – mit und ohne Praefix', () => {
    const report = sampleReport({
      gather: gatherOf([
        sampleCandidate(7771234, 'udp', '192.0.2.10', 50001, 'ipv4', 'global'),
        { ...sampleCandidate(7775678, 'udp', '198.51.100.7', 50002, 'ipv4', 'global'), raw: 'candidate:7775678 1 udp 2122260222 198.51.100.7 50002 typ host' },
        { ...sampleCandidate(7779999, 'udp', '203.0.113.9', 50003, 'ipv4', 'global'), raw: 'a=candidate:7779999 1 udp 2122260221 203.0.113.9 50003 typ host' },
      ]),
    });
    const redacted = redactReport(report);
    expect(raws(redacted).map((raw) => raw.split(' ')[0])).toEqual(['f1', 'candidate:f2', 'a=candidate:f3']);
    expect(JSON.stringify(redacted)).not.toContain('777');
  });

  it('ein Nullbreiten-Zeichen am ufrag-Schluesselwort rettet den Wert nicht (raw wird erst normalisiert)', () => {
    const raw = `1 1 udp 2122260223 192.0.2.47 50000 typ host generation 0 ufrag\u200B ${SECRET} network-id 1`;
    const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(1, 'udp', '192.0.2.47', 50000, 'ipv4', 'global'), raw }]) });
    const redacted = redactReport(report);
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(raws(redacted)[0]).toBe('f1 1 udp 2122260223 ipv4/global#1 50000 typ host generation 0 ufrag entfernt network-id 1');
  });

  it('ein Leerzeichen hinter „candidate:“ verschiebt die Felder nicht', () => {
    const raw = 'candidate: 8889991 1 udp 2122260222 192.0.2.10 50001 typ host';
    const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(8889991, 'udp', '192.0.2.10', 50001, 'ipv4', 'global'), raw }]) });
    const redacted = redactReport(report);
    expect(raws(redacted)[0]).toBe('candidate:f1 1 udp 2122260222 ipv4/global#1 50001 typ host');
    expect(JSON.stringify(redacted)).not.toContain('8889991');
  });
});

describe('redactReport – die ganze Klasse unsichtbarer Formatzeichen (T14)', () => {
  /** Ein Vertreter je Bereich der Klasse – ausschliesslich als \u-Escape geschrieben. */
  const REPRESENTATIVES: Array<{ label: string; char: string }> = [
    { label: 'U+00AD', char: '\u00AD' },
    { label: 'U+034F', char: '\u034F' },
    { label: 'U+061C', char: '\u061C' },
    { label: 'U+115F', char: '\u115F' },
    { label: 'U+17B4', char: '\u17B4' },
    { label: 'U+180E', char: '\u180E' },
    { label: 'U+200B', char: '\u200B' },
    { label: 'U+202A', char: '\u202A' },
    { label: 'U+2066', char: '\u2066' },
    { label: 'U+3164', char: '\u3164' },
    { label: 'U+FE0F', char: '\uFE0F' },
    { label: 'U+FEFF', char: '\uFEFF' },
    { label: 'U+FFA0', char: '\uFFA0' },
    { label: 'U+E0020', char: '\uDB40\uDC20' },
  ];
  const notesOf = (notes: string): string => redactReport(sampleReport({ gather: null, notes })).notes;

  it('die Vertreter sind wirklich unsichtbar und zerlegen die Fixture-Adresse', () => {
    for (const { label, char } of REPRESENTATIVES) {
      expect(char, label).not.toMatch(/[0-9a-z.:]/i);
      expect(`203.0.${char}113.77`, label).not.toContain('203.0.113.77');
    }
  });

  it('jedes Formatzeichen mitten in IPv4, IPv6 und einem .local-Namen hilft nicht', () => {
    const mdns = `${['77777777', '7777', '7777', '7777', '777777777777'].join('-')}.local`;
    for (const { label, char } of REPRESENTATIVES) {
      expect(notesOf(`A 203.0.${char}113.77 B`), `IPv4 ${label}`).toBe('A ipv4/other#1 B');
      expect(notesOf(`A 2001:db${char}8::77 B`), `IPv6 ${label}`).toBe('A ipv6/other#1 B');
      expect(notesOf(`A ${mdns.replace('.local', `.lo${char}cal`)} B`), `mDNS ${label}`).toBe('A mdns/mdns#1 B');
    }
  });
});

describe('redactReport – Gross-/Kleinschreibung in jedem Muster (T15)', () => {
  it('ein unbekannter .LOCAL-Name in Grossbuchstaben wird redigiert', () => {
    const mdns = `${['88888888', '8888', '8888', '8888', '888888888888'].join('-')}.LOCAL`;
    expect(redactReport(sampleReport({ gather: null, notes: `A ${mdns} B` })).notes).toBe('A mdns/mdns#1 B');
  });

  it('SDP-Zeilen in Grossbuchstaben verlieren ihren Wert', () => {
    const notes = 'A=ICE-PWD:geheimeswort\nA=ICE-UFRAG:abcd';
    expect(redactReport(sampleReport({ gather: null, notes })).notes).toBe('A=ICE-PWD:entfernt\nA=ICE-UFRAG:entfernt');
  });

  it('UFRAG und RADDR in Grossbuchstaben innerhalb von raw', () => {
    // Der raddr-Wert ist ein erfundener Hostname: nur die POSITION verrät ihn, kein Adressmuster.
    const raw = '1 1 udp 1686052607 203.0.113.9 61000 typ srflx RADDR fremder-host.example rport 50001 generation 0 UFRAG GeheimWert';
    const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(1, 'udp', '203.0.113.9', 61000, 'ipv4', 'global'), raw, type: 'srflx' }]) });
    const redacted = redactReport(report);
    expect(raws(redacted)[0]).toBe('f1 1 udp 1686052607 ipv4/global#1 61000 typ srflx RADDR other/other#2 rport 50001 generation 0 UFRAG entfernt');
    expect(JSON.stringify(redacted)).not.toContain('GeheimWert');
    expect(JSON.stringify(redacted)).not.toContain('fremder-host');
  });

  it('eine raw-Zeile, die mit A=CANDIDATE: beginnt, behaelt das Praefix und bekommt das Ordinal', () => {
    const raw = 'A=CANDIDATE:9990001 1 udp 2122260222 192.0.2.10 50001 typ host';
    const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(9990001, 'udp', '192.0.2.10', 50001, 'ipv4', 'global'), raw }]) });
    const redacted = redactReport(report);
    expect(raws(redacted)[0]).toBe('A=CANDIDATE:f1 1 udp 2122260222 ipv4/global#1 50001 typ host');
    expect(JSON.stringify(redacted)).not.toContain('9990001');
  });
});

describe('redactReport – vom Programm erzeugte Zeitleisten-Eintraege bleiben bytegleich (T16)', () => {
  // Jede Art/Detail-Paarung, die src/net/rtcTransport.ts heute und Plan-Task 8/9 morgen schreibt.
  const PAIRS: Array<[string, string]> = [
    ['pc-created', ''],
    ['gathering:new', ''],
    ['gathering:gathering', ''],
    ['gathering:complete', ''],
    ['ice:new', ''],
    ['ice:checking', ''],
    ['ice:connected', ''],
    ['ice:completed', ''],
    ['ice:disconnected', ''],
    ['ice:failed', ''],
    ['ice:closed', ''],
    ['connection:new', ''],
    ['connection:connecting', ''],
    ['connection:connected', ''],
    ['connection:disconnected', ''],
    ['connection:failed', ''],
    ['connection:closed', ''],
    ['candidate', 'host/ipv4'],
    ['candidate', 'host/ipv6'],
    ['candidate', 'host/mdns'],
    ['candidate', 'srflx/ipv4'],
    ['candidate', 'relay/ipv6'],
    ['candidate', 'unparsed'],
    ['channel-open:state', ''],
    ['channel-open:events', ''],
    ['channel-close:state', ''],
    ['channel-close:events', ''],
    ['transport:connecting', ''],
    ['transport:open', ''],
    ['transport:closed', ''],
    ['transport:failed', ''],
    ['camera:running', ''],
    ['camera-error', 'NotAllowedError'],
    ['camera-error', 'NotReadableError'],
    ['permissions:handshake', 'camera=granted gum=yes lna=denied'],
    ['selftest', ''],
    ['run:start', ''],
    ['run:hello', ''],
    ['run:ping:state', '197/200'],
    ['run:ping:events', '200/200'],
    ['run:diagnose', 'F2, F3'],
  ];

  it('keine dieser Paarungen wird von der Anonymisierung angefasst', () => {
    const timeline = PAIRS.map(([kind, detail], index) => ({ tMs: index * 10, kind, detail }));
    expect(redactReport(sampleReport({ timeline })).timeline).toEqual(timeline);
  });
});

describe('redactReport und createReportStore – Ausnahmen, Token-Integritaet, Verlaufsschutz (T17)', () => {
  it('ein Schluessel, der woertlich „environment.userAgent“ heisst, ist NICHT ausgenommen', () => {
    const report = { ...sampleReport({ gather: null }), 'environment.userAgent': 'x 203.0.113.201' } as unknown as LabReport;
    const redacted = redactReport(report) as unknown as Record<string, unknown>;
    expect(redacted['environment.userAgent']).toBe('x ipv4/other#1');
    expect(JSON.stringify(redacted)).not.toContain('203.0.113.201');
  });

  it('eine bekannte Adresse, die wie ein Token-Wort aussieht, zerstoert die Tokens nicht', () => {
    for (const address of ['other', 'f1', '1', 'ab', 'entfernt', 'payload', 'global']) {
      const report = sampleReport({ gather: gatherOf([otherCandidate(1, address, 50001)]), notes: `Host war ${address} heute` });
      const once = redactReport(report);
      expect(once.gather?.gathered[0]?.address, address).toBe('other/other#1');
      expect(raws(once)[0]?.split(' ')[4], address).toBe('other/other#1');
      expect(once.notes, address).toBe(`Host war ${address} heute`);
      expect(redactReport(once), address).toEqual(once);
    }
  });

  it('ein raddr-Wert, der wie ein Geheimnis aussieht, bleibt nach dem ersten Durchlauf stabil', () => {
    for (const value of ['fingerprint:x', 'ice-ufrag:abcd', 'MB1.p.AAAA']) {
      const raw = `1 1 udp 1686052607 203.0.113.9 61000 typ srflx raddr ${value} rport 9`;
      const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(1, 'udp', '203.0.113.9', 61000, 'ipv4', 'global'), raw, type: 'srflx' }]) });
      const once = redactReport(report);
      expect(redactReport(once), value).toEqual(once);
    }
  });

  it('list() sortiert eine 40.000 Zeichen lange Adresse und ein gespeichertes 1e999 aus', () => {
    const storage = memoryStorage();
    const long = JSON.stringify(sampleReport({ id: 'lang' })).replace('"192.0.2.10"', JSON.stringify('x'.repeat(40_000)));
    const infinite = JSON.stringify(sampleReport({ id: 'unendlich' })).replace('"protoV":1', '"protoV":1e999');
    expect(infinite).toContain('1e999');
    storage.data.set(REPORT_STORE_KEY, `[${long},${infinite},${JSON.stringify(sampleReport({ id: 'gut' }))}]`);
    const store = createReportStore(storage);
    expect(ids(store.list())).toEqual(['gut']);
    for (const report of store.list()) expect(() => redactReport(report)).not.toThrow();
  });

  it('wirft getItem waehrend add(), bleibt der gespeicherte Verlauf unangetastet', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, `[${['g1', 'g2', 'g3'].map((id) => JSON.stringify(sampleReport({ id }))).join(',')}]`);
    const before = storage.data.get(REPORT_STORE_KEY);
    let calls = 0;
    const flaky = {
      ...storage,
      getItem: (key: string): string | null => {
        calls += 1;
        if (calls === 1) throw new Error('SecurityError');
        return storage.getItem(key);
      },
    };
    const store = createReportStore(flaky);

    expect(() => store.add(sampleReport({ id: 'neu' }))).not.toThrow();

    expect(storage.data.get(REPORT_STORE_KEY)).toBe(before);
    expect(ids(store.list())).toEqual(['g1', 'g2', 'g3']);
  });
});

describe('redactReport – die Geheimnis-Regeln schneiden keine Adresse an (T18)', () => {
  const KNOWN_IPV4 = '192.0.2.10';
  const UNKNOWN_IPV4 = '203.0.113.77';
  const KNOWN_IPV6 = '2001:db8::10';
  const UNKNOWN_IPV6 = '2001:db8:9999::42';
  const KNOWN_MDNS = sampleAddresses()[2] ?? '';
  const UNKNOWN_MDNS = `${['44444444', '4444', '4444', '4444', '444444444444'].join('-')}.local`;
  const ADDRESSES = [KNOWN_IPV4, UNKNOWN_IPV4, KNOWN_IPV6, UNKNOWN_IPV6, KNOWN_MDNS, UNKNOWN_MDNS];
  /** Die vier Geheimnis-Regeln, jede mit der Wertgrenze, an der ihr Fenster vor dieser Runde endete. */
  const RULES: Array<{ label: string; limit: number }> = [
    { label: 'a=fingerprint:', limit: 512 },
    { label: 'ufrag ', limit: 256 },
    { label: 'usernameFragment":"', limit: 256 },
    { label: 'candidate:', limit: 64 },
  ];
  /** Adresse angeklebt, hinter einem Leerzeichen, hinter einem Doppelpunkt. */
  const SEPARATORS = ['', ' ', ':'];
  const FILLER = 'x';

  /** Jedes Endstück ab vier Zeichen, in dem noch ein Trennzeichen steckt – also ab zwei Oktetten bzw. zwei Gruppen. */
  const fragmentsOf = (address: string): string[] => {
    const fragments: string[] = [];
    for (let start = 0; start + 4 <= address.length; start += 1) {
      const tail = address.slice(start);
      if (tail.includes('.') || tail.includes(':')) fragments.push(tail);
    }
    return fragments;
  };

  it('die Fixture schneidet wirklich in die Adresse hinein', () => {
    expect(fragmentsOf(KNOWN_IPV4)).toContain('2.10');
    expect(fragmentsOf(UNKNOWN_IPV4)).toContain('113.77');
    expect(fragmentsOf(UNKNOWN_IPV6)).toContain('::42');
    expect(ADDRESSES.every((address) => address.length >= 10)).toBe(true);
    expect(sampleAddresses()).toContain(KNOWN_MDNS);
  });

  it('kein Adressrest und kein Geheimnis ueberlebt einen Schnitt an der alten Wertgrenze', () => {
    const failures: string[] = [];
    for (const { label, limit } of RULES) {
      for (const separator of SEPARATORS) {
        for (const address of ADDRESSES) {
          // Schnittstelle innerhalb der Adresse: der Wert endet „cut“ Zeichen hinter ihrem Anfang.
          for (let cut = 0; cut < Math.min(address.length, 13); cut += 1) {
            const text = `${label}${FILLER.repeat(Math.max(1, limit - separator.length - cut))}${separator}${address} Rest`;
            const report = {
              ...sampleReport({ notes: text, timeline: [{ tMs: 1, kind: 'note', detail: text }] }),
              remoteCandidates: [text],
            } as unknown as LabReport;
            const redacted = redactReport(report) as unknown as LabReport & { remoteCandidates: string[] };
            const fields = [redacted.notes, redacted.timeline[0]?.detail ?? '', redacted.remoteCandidates[0] ?? ''];
            const left = fragmentsOf(address).filter((fragment) => fields.some((field) => field.includes(fragment)));
            const secretLeft = fields.some((field) => field.includes(FILLER.repeat(4)));
            if (left.length > 0 || secretLeft) {
              failures.push(`${label} ${JSON.stringify(separator)} ${address} cut=${cut} -> ${JSON.stringify(fields[0]?.slice(0, 48))}`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('kein Adressrest, wenn der Fuellauf selbst bis an die NEUE 4096-Grenze heranreicht', () => {
    // Die alte Wertgrenze (limit) ist hier irrelevant - dieser Test prueft, dass die REIHENFOLGE
    // (Adressen vor den Geheimnis-Regeln) auch dann schuetzt, wenn ein einzeiliges SDP-Paste
    // selbst mehrere Kilobyte lang ist und der 4096-Zeichen-Deckel greift. Nur die Reihenfolge
    // kann das leisten: ein Deckel auf einen einzelnen Wert kann bei genuegend langem Fuelltext
    // immer irgendwo enden.
    const WINDOW = 4096;
    const failures: string[] = [];
    for (const { label } of RULES) {
      for (const separator of SEPARATORS) {
        for (const address of ADDRESSES) {
          for (const cut of [0, 1, 3, 6, 12]) {
            if (cut >= Math.min(address.length, 13)) continue;
            const text = `${label}${FILLER.repeat(Math.max(1, WINDOW - separator.length - cut))}${separator}${address} Rest`;
            const redacted = redactReport(sampleReport({ gather: null, notes: text })).notes;
            const left = fragmentsOf(address).filter((fragment) => redacted.includes(fragment));
            if (left.length > 0) failures.push(`${label} ${JSON.stringify(separator)} ${address} cut=${cut} -> ${JSON.stringify(redacted.slice(-40))}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('ein Wert jenseits der alten Grenze hinterlaesst bei keiner der vier Regeln einen Rest', () => {
    for (const { label, limit } of RULES) {
      const secret = 'Q'.repeat(limit + 10);
      expect(redactReport(sampleReport({ gather: null, notes: `Vorher ${label}${secret} Nachher` })).notes, label).not.toMatch(/Q/);
    }
  });

  it('ein ueberlanger ufrag-Wert laesst weder in notes noch in raw einen Rest', () => {
    for (const length of [266, 5000]) {
      const secret = 'Q'.repeat(length);
      const notes = `generation 0 ufrag ${secret} network-id 1`;
      expect(redactReport(sampleReport({ gather: null, notes })).notes, `notes ${length}`).not.toMatch(/Q/);
      const raw = `1 1 udp 2122260223 192.0.2.47 50000 typ host ufrag ${secret} network-id 1`;
      const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(1, 'udp', '192.0.2.47', 50000, 'ipv4', 'global'), raw }]) });
      expect(JSON.stringify(redactReport(report)), `raw ${length}`).not.toMatch(/Q/);
    }
  });

  it('ein ufrag-Wert jenseits der 4096-Grenze verschwindet auch ohne langen base64url-Lauf', () => {
    // Die allgemeine ufrag-Regel schneidet bei 4096 Zeichen ab; der Rest darf nur deshalb nicht
    // stehen bleiben, weil redactRaw den Wert nach Position ersetzt – ein Punkt alle 20 Zeichen
    // verhindert, dass die Payload-Regel (≥ 32 base64url-Zeichen) den Rest zufällig mitnimmt.
    const value = 'Q'.repeat(4096) + `.${'Q'.repeat(20)}`.repeat(5);
    const raw = `1 1 udp 2122260223 192.0.2.47 50000 typ host ufrag ${value} network-id 1`;
    const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(1, 'udp', '192.0.2.47', 50000, 'ipv4', 'global'), raw }]) });
    expect(raws(redactReport(report))[0]).toBe('f1 1 udp 2122260223 ipv4/global#1 50000 typ host ufrag entfernt network-id 1');
  });

  it('ein angeklebter base64url-Lauf vor einem Geheimnis-Schluesselwort rettet den Wert nicht', () => {
    // Pinnt die Reihenfolge „Geheimnis-Regeln VOR dem Payload-Durchlauf“: liefe der Payload-Durchlauf
    // zuerst, fräße der Lauf das Schlüsselwort mit, und die Geheimnis-Regel träfe nicht mehr.
    const notesOf = (notes: string): string => redactReport(sampleReport({ gather: null, notes })).notes;
    const glue = 'A'.repeat(40);
    expect(notesOf(`${glue}usernameFragment":"Zq7Kgeheim"`), 'usernameFragment').not.toContain('Zq7Kgeheim');
    expect(notesOf(`${glue}ice-ufrag:Zq7Kgeheim`), 'ice-ufrag').not.toContain('Zq7Kgeheim');
    expect(notesOf(`${glue}candidate:7771234 1 udp 1 203.0.113.77 1 typ host`), 'candidate').not.toContain('7771234');
  });
});

describe('redactReport – eine zu grosse RegExp bringt redactReport nicht zum Werfen (T19)', () => {
  it('eine 40.000 Zeichen lange bekannte Adresse wird woertlich ersetzt statt zu werfen', () => {
    const address = 'x'.repeat(40_000);
    const report = sampleReport({
      gather: gatherOf([sampleCandidate(1, 'udp', address, 50001, 'ipv4', 'global')]),
      notes: `Host war ${address} heute`,
    });
    const run = (): LabReport => redactReport(report);

    expect(run).not.toThrow();

    const json = JSON.stringify(run());
    expect(json).not.toContain(address);
    expect(json).not.toMatch(/x{32}/);
    expect(run().notes).toBe('Host war ipv4/global#1 heute');
  });
});

describe('redactReport – redactRaw normalisiert VOR dem Zerlegen (T20)', () => {
  it('ein Nullbreiten-Zeichen im raddr-Schluesselwort rettet den fremden Hostnamen nicht', () => {
    const raw = `1 1 udp 1686052607 203.0.113.9 61000 typ srflx r\u200Baddr fremder-host.example rport 9 generation 0`;
    const report = sampleReport({
      gather: gatherOf([{ ...sampleCandidate(1, 'udp', '203.0.113.9', 61000, 'ipv4', 'global'), raw, type: 'srflx' }]),
    });
    const redacted = redactReport(report);
    expect(JSON.stringify(redacted)).not.toContain('fremder-host');
    expect(raws(redacted)[0]).toBe('f1 1 udp 1686052607 ipv4/global#1 61000 typ srflx raddr other/other#2 rport 9 generation 0');
  });

  it('ein Nullbreiten-Zeichen im „a=“-Praefix kostet weder das Praefix noch das Ordinal', () => {
    const raw = `a\u200B=candidate:7771234 1 udp 2122260222 192.0.2.10 50001 typ host`;
    const report = sampleReport({ gather: gatherOf([{ ...sampleCandidate(7771234, 'udp', '192.0.2.10', 50001, 'ipv4', 'global'), raw }]) });
    const redacted = redactReport(report);
    expect(raws(redacted)[0]).toBe('a=candidate:f1 1 udp 2122260222 ipv4/global#1 50001 typ host');
    expect(JSON.stringify(redacted)).not.toContain('7771234');
  });
});

describe('redactReport – Leerraum hinter dem Praefix in jeder Schreibweise (T21)', () => {
  const FOUNDATION = '8889991';
  const PRIORITY = '2122260222';

  it('ein Leerzeichen hinter „candidate:“ verschiebt die Felder in keiner Schreibweise', () => {
    for (const prefix of ['candidate: ', 'A=CANDIDATE: ', 'a=candidate: ']) {
      const raw = `${prefix}${FOUNDATION} 1 udp ${PRIORITY} 192.0.2.10 50001 typ host`;
      const report = sampleReport({
        gather: gatherOf([{ ...sampleCandidate(Number(FOUNDATION), 'udp', '192.0.2.10', 50001, 'ipv4', 'global'), raw }]),
      });
      const fields = (raws(redactReport(report))[0] ?? '').split(' ');
      expect(fields, prefix).toHaveLength(raw.split(' ').length - 1);
      expect(fields[0], prefix).toBe(`${prefix.trim()}f1`);
      expect(fields[3], prefix).toBe(PRIORITY);
      expect(fields[4], prefix).toBe('ipv4/global#1');
      expect(JSON.stringify(redactReport(report)), prefix).not.toContain(FOUNDATION);
    }
  });
});

describe('redactReport – die Uhrzeit-Ausnahme endet bei zwei Ziffern je Gruppe (T22)', () => {
  const notesOf = (notes: string): string => redactReport(sampleReport({ gather: null, notes })).notes;
  /** Alle Vergleichswerte stammen aus EINER Dokumentationsadresse (RFC 3849), zur Laufzeit zerlegt. */
  const GROUPS = '2001:db8:1234:5678:9012:3456:7890:0001'.split(':');

  it('drei Gruppen mit mehr als zwei Ziffern sind keine Uhrzeit, sondern eine Adresshaelfte', () => {
    for (const parts of [GROUPS.slice(0, 3), GROUPS.slice(2, 5), GROUPS.slice(4, 7)]) {
      const word = parts.join(':');
      expect(word.split(':'), word).toHaveLength(3);
      expect(notesOf(`Rest ${word} Ende`), word).toBe('Rest ipv6/other#1 Ende');
    }
  });

  it('drei Gruppen mit genau drei Ziffern sind keine Uhrzeit, sondern eine Adresshaelfte', () => {
    // Die Grenze der Ausnahme liegt bei zwei Ziffern je Gruppe – die Nachbarstelle (drei) muss geschwärzt werden.
    const word = '2001:db8:100:200:300:400:500:600'.split(':').slice(2, 5).join(':');
    expect(word.split(':')).toHaveLength(3);
    expect(notesOf(`Rest ${word} Ende`)).toBe('Rest ipv6/other#1 Ende');
  });

  it('echte Uhrzeiten mit ein- und zweistelligen Gruppen bleiben bytegleich', () => {
    for (const time of ['16:24:25', '9:05:07', '1:02:03']) expect(notesOf(`um ${time} Uhr`), time).toBe(`um ${time} Uhr`);
  });
});

describe('redactReport – Randfaelle der mDNS- und usernameFragment-Regel (T23)', () => {
  const notesOf = (notes: string): string => redactReport(sampleReport({ gather: null, notes })).notes;

  it('ein .local-Name mit einem Umlaut am Anfang verliert auch sein erstes Zeichen', () => {
    expect(notesOf('Rechner Ärztehaus.local im WLAN')).toBe('Rechner mdns/mdns#1 im WLAN');
  });

  it('USERNAMEFRAGMENT in Grossbuchstaben verliert seinen Wert', () => {
    expect(notesOf('USERNAMEFRAGMENT="Zq7Kgeheim"')).toBe('USERNAMEFRAGMENT="entfernt"');
  });
});

describe('redactText – einzelner Text ohne Report (T24)', () => {
  /** Dokumentationsadressen (RFC 5737); der mDNS-Name entsteht zur Laufzeit (Datenschutz-Waechter). */
  const DOC_IPV4 = '192.0.2.10';
  const OTHER_IPV4 = '198.51.100.7';
  const MDNS_NAME = `${['33333333', '3333', '3333', '3333', '333333333333'].join('-')}.local`;

  it('ersetzt jede Adresse durch ihr Token – dieselben Regeln wie in redactReport', () => {
    expect(redactText(`Host ${DOC_IPV4} und ${MDNS_NAME} antworten nicht`)).toBe('Host ipv4/other#1 und mdns/mdns#2 antworten nicht');
  });

  it('laesst eine Uhrzeit und gewoehnlichen Text bytegleich', () => {
    expect(redactText('F5: apply answer um 16:24:25 fehlgeschlagen')).toBe('F5: apply answer um 16:24:25 fehlgeschlagen');
  });

  it('zaehlt je Aufruf neu – ein Text erbt nie das Ordinal eines anderen', () => {
    expect(redactText(DOC_IPV4)).toBe('ipv4/other#1');
    expect(redactText(OTHER_IPV4)).toBe('ipv4/other#1');
  });

  it('nimmt auch Kandidaten-Geheimnisse mit, nicht nur Adressen', () => {
    expect(redactText(`a=candidate:2999745851 1 udp 2122260223 ${DOC_IPV4} 50001 typ host ufrag Zq7K`))
      .toBe('a=candidate:entfernt 1 udp 2122260223 ipv4/other#1 50001 typ host ufrag entfernt');
  });
});

// ───────── M2 Task 4: Report-Felder `pairing` und `qr` ─────────

describe('reportToText – Paarung und QR', () => {
  const pairing = {
    offerShownAt: 0, offerScannedMs: 4200, answerShownAt: 5100, answerScannedMs: 8400,
    connectedMs: 11_000, projectedLobbyFullMs: 30_000,
  };
  const qr = { backend: 'worker' as const, offerChars: 704, answerChars: 521, decodeLatencyMs: 24.5, attempts: 7 };

  it('nennt Marken und Hochrechnung in einem eigenen Block', () => {
    const text = reportToText(sampleReport({ pairing, qr }));
    expect(text).toContain('Paarung');
    expect(text).toContain('  Angebot: gezeigt 0 ms · gescannt 4200 ms');
    expect(text).toContain('  Antwort: gezeigt 5100 ms · gescannt 8400 ms');
    expect(text).toContain('  Verbunden 11000 ms · Hochrechnung „Lobby voll“ 30000 ms');
  });

  it('nennt Backend, Zeichenzahlen, Latenz und Versuche in einem eigenen Block', () => {
    const text = reportToText(sampleReport({ pairing, qr }));
    expect(text).toContain('QR');
    expect(text).toContain('  Backend worker · Angebot 704 Zeichen · Antwort 521 Zeichen · Dekodierung 24.5 ms · Versuche 7');
  });

  it('einzelne Marken ohne Wert erscheinen als Gedankenstrich, nicht als undefined', () => {
    const text = reportToText(sampleReport({ pairing: { ...pairing, answerScannedMs: null, projectedLobbyFullMs: null } }));
    expect(text).toContain('  Antwort: gezeigt 5100 ms · gescannt –');
    expect(text).toContain('Hochrechnung „Lobby voll“ –');
    expect(text).not.toContain('undefined');
  });

  it('null und ein FEHLENDES Feld ergeben dieselbe Zeile „keine Messung“', () => {
    const withNull = reportToText(sampleReport({ pairing: null, qr: null }));
    const m1Shaped = JSON.parse(JSON.stringify(sampleReport())) as Record<string, unknown>;
    delete m1Shaped['pairing'];
    delete m1Shaped['qr'];
    expect(withNull).toBe(reportToText(m1Shaped as unknown as LabReport));
    // Zweimal „keine Messung“ – einmal für Paarung, einmal für QR.
    expect(withNull.split('keine Messung')).toHaveLength(3);
  });
});

describe('redactReport – die neuen Felder brauchen keine eigene Regel', () => {
  const pairing = { offerShownAt: 0, offerScannedMs: 4200, answerShownAt: null, answerScannedMs: null, connectedMs: 9000, projectedLobbyFullMs: 52_200 };
  const qr = { backend: 'native' as const, offerChars: 704, answerChars: 0, decodeLatencyMs: 18, attempts: 3 };

  it('Zahlen und Aufzählungswerte bleiben unverändert', () => {
    const redacted = redactReport(sampleReport({ pairing, qr }));
    expect(redacted.pairing).toEqual(pairing);
    expect(redacted.qr).toEqual(qr);
  });

  it('wirft auch dann nicht, wenn die Felder ganz fehlen (M1-Report)', () => {
    const m1Shaped = JSON.parse(JSON.stringify(sampleReport())) as Record<string, unknown>;
    delete m1Shaped['pairing'];
    delete m1Shaped['qr'];
    delete m1Shaped['lockTest'];
    const redacted = redactReport(m1Shaped as unknown as LabReport);
    expect(JSON.stringify(redacted)).not.toContain('undefined');
    expect(reportToText(redacted)).not.toContain('undefined');
  });
});

describe('createReportStore – Aufwaertskompatibilitaet der M1-Reports (R1)', () => {
  /** Ein gespeicherter Report in M1-Form: OHNE die Schlüssel pairing, qr und lockTest. */
  function m1Stored(id: string): string {
    const value = JSON.parse(JSON.stringify(sampleReport({ id }))) as Record<string, unknown>;
    delete value['pairing'];
    delete value['qr'];
    delete value['lockTest'];
    return JSON.stringify(value);
  }

  it('die Fixture trägt die drei Schlüssel wirklich nicht', () => {
    const stored = m1Stored('m1');
    for (const key of ['pairing', 'qr', 'lockTest']) expect(stored).not.toContain(`"${key}"`);
  });

  it('kommt durch list(), lässt sich rendern, schwärzen und als JSON schreiben – ohne Datenmüll', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, `[${m1Stored('m1')}]`);
    const listed = createReportStore(storage).list();

    expect(ids(listed)).toEqual(['m1']);
    const report = listed[0];
    expect(report).toBeDefined();
    if (report === undefined) return;
    for (const text of [reportToText(report), reportToText(redactReport(report)), reportsToJson(listed)]) {
      for (const garbage of ['undefined', 'NaN', '[object Object]']) expect(text).not.toContain(garbage);
    }
  });

  it('ein M1-Report überlebt auch das nächste add() eines M2-Reports', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, `[${m1Stored('m1')}]`);
    const store = createReportStore(storage);
    store.add(sampleReport({ id: 'm2' }));
    expect(ids(store.list())).toEqual(['m2', 'm1']);
  });

  it('null und ein fehlender Schlüssel kommen beide durch, ein falscher Wert nicht', () => {
    const storage = memoryStorage();
    const store = createReportStore(storage);
    const rows: Array<{ id: string; value: unknown; accepted: boolean }> = [
      { id: 'null', value: sampleReport({ id: 'null', pairing: null, qr: null }), accepted: true },
      { id: 'voll', value: sampleReport({ id: 'voll' }), accepted: true },
      { id: 'pairing-text', value: { ...sampleReport({ id: 'pairing-text' }), pairing: 'nope' }, accepted: false },
      { id: 'qr-liste', value: { ...sampleReport({ id: 'qr-liste' }), qr: [] }, accepted: false },
      { id: 'qr-leer', value: { ...sampleReport({ id: 'qr-leer' }), qr: {} }, accepted: false },
    ];
    for (const row of rows) {
      storage.data.set(REPORT_STORE_KEY, JSON.stringify([row.value]));
      expect(store.list().length > 0, row.id).toBe(row.accepted);
    }
  });
});

// ───────── Sperrbildschirm-Test im Report (M2, Task 5) ─────────

/** Die Zeilen des Blocks „Sperrbildschirm" (ohne Überschrift, bis zur nächsten Leerzeile). */
function lockLines(report: LabReport): string[] {
  const lines = reportToText(report).split('\n');
  const start = lines.indexOf('Sperrbildschirm');
  expect(start).toBeGreaterThan(0);
  const end = lines.indexOf('', start + 1);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** Flache Kopie des Beispiel-Reports OHNE den Schlüssel `lockTest` – so liegen M1-Reports im Speicher. */
function reportWithoutLockTest(id: string): unknown {
  const report = JSON.parse(JSON.stringify(sampleReport({ id }))) as Record<string, unknown>;
  delete report.lockTest;
  return report;
}

describe('reportToText – Block „Sperrbildschirm"', () => {
  it('eine Zeile je Lauf: geplant, gemessen, beide Zustandspaare, Ping je Kanal, neu verbunden', () => {
    expect(lockLines(sampleReport())).toEqual([
      '  1: geplant 30 s, verdeckt 31240 ms · Transport open → open · Spur live → unmuted · Ping events 20/20, state 19/20 · neu verbunden: nein',
    ]);
  });

  it('nummeriert mehrere Läufe durch; ohne Ping-Serie steht „nicht gemessen"', () => {
    const runs = [
      sampleLockRun(),
      sampleLockRun({ plannedSeconds: 60, hiddenMs: 61_002, transportAfter: 'failed', trackAfter: 'ended', pingAfter: null, reconnected: true }),
    ];
    expect(lockLines(sampleReport({ lockTest: { runs } }))).toEqual([
      lockLines(sampleReport())[0],
      '  2: geplant 60 s, verdeckt 61002 ms · Transport open → failed · Spur live → ended · Ping nicht gemessen · neu verbunden: ja',
    ]);
  });

  it('ein fehlendes Feld, null und eine leere Liste ergeben dieselbe eine Zeile', () => {
    expect(lockLines(reportWithoutLockTest('m1') as LabReport)).toEqual(['  keine Messung']);
    expect(lockLines(sampleReport({ lockTest: null }))).toEqual(['  keine Messung']);
    expect(lockLines(sampleReport({ lockTest: { runs: [] } }))).toEqual(['  keine Messung']);
  });

  it('trägt keinen Datenmüll, wenn ein fremder Report etwas anderes unter lockTest führt', () => {
    for (const lockTest of [{ runs: 'nein' }, { andere: 1 }, 42, 'x']) {
      const text = reportToText({ ...sampleReport(), lockTest } as unknown as LabReport);
      for (const garbage of ['undefined', 'NaN', '[object Object]']) expect(text, JSON.stringify(lockTest)).not.toContain(garbage);
    }
  });
});

describe('redactReport – lockTest', () => {
  it('lässt Zahlen, Zustandswörter und Wahrheitswerte unangetastet', () => {
    expect(redactReport(sampleReport()).lockTest).toEqual(sampleReport().lockTest);
  });

  it('säubert eine in einen Zustandswert geschmuggelte Adresse trotzdem (Positivliste über JEDEN String)', () => {
    const run = { ...sampleLockRun(), transportAfter: 'failed 203.0.113.7' } as unknown as LockTestRun;
    const redacted = redactReport(sampleReport({ lockTest: { runs: [run] } }));
    expect(JSON.stringify(redacted)).not.toContain('203.0.113.7');
    expect(redacted.lockTest?.runs[0]?.transportAfter).toMatch(/^failed ipv4\/other#\d+$/);
  });
});

describe('createReportStore – Form von lockTest', () => {
  /** Ein einzelner gespeicherter Eintrag, durch die Formprüfung gelesen. */
  const stored = (report: unknown): LabReport[] => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, JSON.stringify([report]));
    return createReportStore(storage).list();
  };

  it('ein M1-Report OHNE den Schlüssel bleibt gültig – sonst verlöre jedes Gerät beim Update seinen Verlauf', () => {
    expect(ids(stored(reportWithoutLockTest('m1')))).toEqual(['m1']);
  });

  it('nimmt null und eine befüllte Liste an', () => {
    expect(ids(stored(sampleReport({ id: 'null-wert', lockTest: null })))).toEqual(['null-wert']);
    expect(stored(sampleReport({ id: 'gefuellt' }))[0]?.lockTest?.runs).toHaveLength(1);
  });

  it('sortiert jede kaputte Form aus', () => {
    const broken: unknown[] = [
      'x',
      42,
      [],
      {},
      { runs: 'nein' },
      { runs: [42] },
      { runs: [{ ...sampleLockRun(), hiddenMs: '7' }] },
      { runs: [{ ...sampleLockRun(), plannedSeconds: null }] },
      { runs: [{ ...sampleLockRun(), reconnected: 'ja' }] },
      { runs: [{ ...sampleLockRun(), transportAfter: 42 }] },
      { runs: [{ ...sampleLockRun(), trackBefore: null }] },
      { runs: [{ ...sampleLockRun(), pingAfter: 'kurz' }] },
      { runs: [{ ...sampleLockRun(), pingAfter: { events: {}, state: null } }] },
      { runs: [{ ...sampleLockRun(), pingAfter: { events: null } }] },
      { runs: [without(sampleLockRun(), 'pingAfter')] },
      { runs: [without(sampleLockRun(), 'trackAfter')] },
    ];
    const accepted = broken.filter((lockTest) => stored({ ...sampleReport({ id: 'kaputt' }), lockTest }).length > 0);
    expect(accepted).toEqual([]);
  });

  it('für einen gelesenen Report mit lockTest werfen Text, JSON und Schwärzung nicht', () => {
    const [report] = stored(sampleReport({ id: 'gut' }));
    expect(report).toBeDefined();
    if (report === undefined) return;
    expect(() => reportsToJson([report])).not.toThrow();
    expect(() => redactReport(report)).not.toThrow();
    expect(reportToText(redactReport(report))).toContain('Sperrbildschirm');
  });
});
