import { describe, expect, it } from 'vitest';
import {
  createReportStore,
  isRunValid,
  redactReport,
  REPORT_STORE_KEY,
  reportsToJson,
  reportToText,
  type CellLabel,
  type LabReport,
} from '../../../src/lab/report';
import type { PermissionSnapshot } from '../../../src/net/environment';
import { sampleAddresses, sampleCandidate, sampleReport } from '../../helpers/sampleReport';

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
    expect(gathered[0]?.raw).toBe('1001 1 udp 2122259222 ipv4/global#1 50001 typ host generation 0 network-cost 10');
    expect(gathered[3]?.raw).toBe('1004 1 tcp 2122259219 ipv4/global#1 9 typ host tcptype active generation 0 network-cost 10');
    // Alles außer Adresse und raw bleibt, wie es war.
    expect(gathered[1]).toMatchObject({ foundation: '1002', port: 50002, protocol: 'udp', type: 'host', family: 'ipv6', scope: 'global' });
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

    expect(raws[1]).toBe('2001 1 udp 1686052607 ipv4/global#2 61000 typ srflx raddr ipv4/global#1 rport 50001 generation 0 ufrag entfernt network-cost 10');
    expect(raws[2]).toBe('candidate:2002 1 udp 1686052606 ipv4/global#2 61001 typ srflx raddr ipv4/other#3 rport 50002');
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

  const GLUE_PREFIXES = ['', 'x', '5', '_', '(', 'ä', 'Fehlercode'];
  const GLUE_SUFFIXES = ['', 'x', '_', '.', ')', 'war'];
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
          const json = JSON.stringify(redactReport(report)).toLowerCase();
          if (json.includes(address.toLowerCase())) {
            failures.push(`prefix=${JSON.stringify(prefix)} address=${address} suffix=${JSON.stringify(suffix)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('bekannte Adresse bleibt auch mit angeklebter Ziffer unauffindbar (Sicherheitsnetz greift)', () => {
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
  ];
  const validReport = sampleReport({ id: 'gut' });

  it('filtert Einträge mit richtigen Top-Level-Feldern, aber falscher verschachtelter Form aus', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, JSON.stringify([validReport, ...malformed.map((entry) => entry.report)]));
    const store = createReportStore(storage);
    expect(ids(store.list())).toEqual(['gut']);
  });

  it('für alles, was list() zurückgibt, werfen reportToText, reportsToJson und redactReport nicht', () => {
    const storage = memoryStorage();
    storage.data.set(REPORT_STORE_KEY, JSON.stringify([validReport, ...malformed.map((entry) => entry.report)]));
    const store = createReportStore(storage);
    const listed = store.list();
    for (const report of listed) {
      expect(() => reportToText(report)).not.toThrow();
      expect(() => redactReport(report)).not.toThrow();
    }
    expect(() => reportsToJson(listed)).not.toThrow();
  });
});
