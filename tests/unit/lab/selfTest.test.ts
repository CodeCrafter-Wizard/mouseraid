import { describe, expect, it, vi } from 'vitest';
import { parseCandidate, type ParsedCandidate } from '../../../src/net/candidates';
import type { ClientJoin, ConnectorDeps, HandshakeArtifacts, HostLobby, HostSlotEntry } from '../../../src/net/connector';
import type { RtcPeer } from '../../../src/net/rtcTransport';
import type { Timeline } from '../../../src/net/timeline';
import type { Transport, TransportState } from '../../../src/net/transport';
import type { LabRunResult } from '../../../src/lab/labSession';
import type { LabReport } from '../../../src/lab/report';
import { SELFTEST_OPEN_TIMEOUT_MS, normaliseDevice, runSelfTest, selfTestShareText, summariseRun, type SelfTestDeps, type SelfTestProgress, type SelfTestRun } from '../../../src/lab/selfTest';
import { S, fmt } from '../../../src/ui/strings';

// Der Selbsttest wird hier komplett gegen Attrappen gefahren: Reihenfolge (A vor getUserMedia, B danach),
// Zellenlabel, Code-Weitergabe, Kamera-Fehler und Abbrüche. Echte PeerConnections prüft tests/e2e/lab-rtc.spec.ts.

type FinishInput = Parameters<SelfTestDeps['finishRun']>[0];
type FakeTransport = Transport & { set(next: TransportState): void };

// Nur Dokumentationsadressen (RFC 5737); der mDNS-Name entsteht zur Laufzeit (Datenschutz-Wächter).
const DOC_IPV4 = '192.0.2.10';
const MDNS_NAME = `${['22222222', '2222', '2222', '2222', '222222222222'].join('-')}.local`;

function candidate(address: string): ParsedCandidate {
  const parsed = parseCandidate(`1 1 udp 2122260223 ${address} 50001 typ host generation 0`);
  if (parsed === null) throw new Error('Testkandidat unlesbar');
  return parsed;
}

function makeReport(overrides: Partial<LabReport> = {}): LabReport {
  return {
    id: 'r-1', createdAt: '2026-09-21T10:00:00.000Z', buildId: 'test-build', protoV: 1,
    cell: { role: 'selbsttest', hotspotOwner: 'unbekannt', camera: 'an', path: 'loopback', device: 'Pixel-Test' },
    environment: {
      userAgent: 'Vitest', engine: 'chromium', displayMode: 'browser', secureContext: true, online: true, swControlled: false, buildId: 'test-build',
      features: { rtc: true, compressionStream: true, wakeLock: false, barcodeDetector: false, barcodeFormats: [], storagePersist: false, shareText: false, clipboardWrite: false },
    },
    permissions: { camera: 'granted', localNetwork: 'unsupported', loopbackNetwork: 'unsupported' },
    gumCalledThisSession: true,
    gather: { durationMs: 40, timedOut: false, gathered: [candidate(DOC_IPV4), candidate(MDNS_NAME)], transmitted: 2 },
    payloadSizes: null, timeline: [],
    selectedPair: { localType: 'host', localProtocol: 'udp', localFamily: 'ipv4', localScope: 'private', remoteType: 'host', remoteFamily: 'ipv4', remoteScope: 'private', currentRttMs: 1 },
    sctpMaxMessageSize: 262144,
    hello: { remoteProtoV: 1, remoteBuildId: 'test-build', versionMatch: true },
    ping: {
      state: { sent: 50, received: 49, lossPct: 2, minMs: 0.2, medianMs: 0.4, p95Ms: 1.1, maxMs: 2, outOfOrder: 0 },
      events: { sent: 50, received: 50, lossPct: 0, minMs: 0.2, medianMs: 0.44, p95Ms: 1.25, maxMs: 2, outOfOrder: 0 },
    },
    lockTest: null, failures: [], valid: true, invalidReason: null, notes: '',
    ...overrides,
  };
}

interface WorldOptions {
  /** Zustand, den beide Transporte nach dem Handshake annehmen; 'never' = bleibt „connecting". */
  settle?: TransportState | 'never';
  cameraError?: string;
  /** Nummer des Laufs (1 = A, 2 = B), in dem `acceptAnswer` wie der Connector mit F5 scheitert. */
  failAnswerInRun?: number;
}

function makeWorld(options: WorldOptions = {}) {
  const log: string[] = [];
  const statuses: string[] = [];
  const runs: SelfTestRun[] = [];
  const finishInputs: FinishInput[] = [];
  const timelineAtFinish: string[][] = [];
  const settle = options.settle ?? 'open';
  let runNumber = 0;
  let clock = 0;
  let gumCalled = false;
  let pending: FakeTransport[] = [];

  function fakeTransport(peerId: string): FakeTransport {
    let state: TransportState = 'connecting';
    const transport: FakeTransport = {
      peerId,
      get state() { return state; },
      send: () => false,
      onMessage: null,
      onStateChange: null,
      close: () => undefined,
      set(next) {
        state = next;
        transport.onStateChange?.(next);
      },
    };
    pending.push(transport);
    return transport;
  }

  function fakePeer(transport: Transport): RtcPeer {
    const unused = (): Promise<never> => Promise.reject(new Error('in der Attrappe unbenutzt'));
    return { pc: {} as RTCPeerConnection, transport, createOffer: unused, acceptOffer: unused, acceptAnswer: unused, close: () => undefined };
  }

  function artifacts(payload: string): HandshakeArtifacts {
    return {
      payload, localSdp: `sdp-von-${payload}`,
      sizes: { sdpBytes: 500, minimisedBytes: 200, packedBytes: 150, textChars: 210, compressed: true },
      desc: {
        codecV: 1, protoV: 1, role: 'offer', slot: 1, nonce: 7, ufrag: 'u', pwd: 'p', fingerprint: 'AA', setup: 'actpass',
        sctpPort: 5000, maxMessageSize: null, candidates: [],
      },
      gather: { durationMs: 40, timedOut: false, gathered: 2, transmitted: 2 },
    };
  }

  const createHostLobby = (connector: ConnectorDeps): HostLobby => {
    runNumber += 1;
    const run = runNumber;
    const entries = new Map<number, HostSlotEntry>();
    return {
      createOffer(slot) {
        log.push(`offer:${run}:slot${slot}`);
        const offer = artifacts(`OFFER-${run}`);
        entries.set(slot, { slot, peer: fakePeer(fakeTransport(`slot-${slot}`)), timeline: connector.makeTimeline(), offer, remoteSdp: null });
        return Promise.resolve(offer);
      },
      acceptAnswer(slot, payloadText) {
        log.push(`accept:${run}:slot${slot}:${payloadText}`);
        const entry = entries.get(slot);
        if (entry === undefined) return Promise.reject(new Error('Slot unbekannt'));
        if (options.failAnswerInRun === run) return Promise.reject(Object.assign(new Error('Nonce passt nicht'), { failure: 'F5' }));
        entry.remoteSdp = `remote-sdp-${run}`;
        if (settle !== 'never') {
          const transports = pending;
          setTimeout(() => { for (const transport of transports) transport.set(settle); }, 0);
        }
        pending = [];
        return Promise.resolve(entry.peer);
      },
      entries: () => entries,
      closeSlot: () => undefined,
      closeAll: () => { log.push(`close-host:${run}`); },
    };
  };

  const createClientJoin = (connector: ConnectorDeps): ClientJoin => {
    const run = runNumber;
    let peer: RtcPeer | null = null;
    let timeline: Timeline | null = null;
    return {
      acceptOffer(payloadText) {
        log.push(`answer:${run}:${payloadText}`);
        peer = fakePeer(fakeTransport('host'));
        timeline = connector.makeTimeline();
        return Promise.resolve(artifacts(`ANSWER-${run}`));
      },
      get peer() { return peer; },
      get timeline() { return timeline; },
      get slot() { return peer === null ? null : 1; },
      get remoteSdp() { return peer === null ? null : 'offer-sdp'; },
      close: () => { log.push(`close-client:${run}`); },
    };
  };

  const deps: SelfTestDeps = {
    createHostLobby,
    createClientJoin,
    finishRun(input) {
      log.push(`finish:${input.cell.camera}:${input.transport.state}`);
      finishInputs.push(input);
      timelineAtFinish.push(input.timeline.events().map((event) => (event.detail === '' ? event.kind : `${event.kind}=${event.detail}`)));
      input.hooks.onStatus('Diagnose wird gesammelt …');
      return Promise.resolve({ report: makeReport({ id: `r-${finishInputs.length}`, cell: input.cell, gumCalledThisSession: input.gumCalledThisSession, notes: input.notes ?? '' }), rawSdp: null });
    },
    attachLabLink: (transport) => { log.push(`link:${transport.peerId}`); },
    openCamera() {
      log.push('camera:open');
      gumCalled = true; // wie camera.ts: schon der Aufruf zählt, nicht erst der Erfolg
      if (options.cameraError !== undefined) {
        const error = new Error('Permission denied');
        error.name = options.cameraError;
        return Promise.reject(error);
      }
      return Promise.resolve({ stop: () => { log.push('camera:stop'); } });
    },
    now: () => { clock += 1; return clock; },
    randomNonce: () => 7,
    openTimeoutMs: 30,
    gumCalled: () => gumCalled,
  };

  const results: (LabRunResult | null)[] = [];
  const progress: SelfTestProgress = {
    onStatus: (text) => { statuses.push(text); },
    onRun: (run, result) => { runs.push(run); results.push(result); },
  };
  return { log, statuses, runs, results, finishInputs, timelineAtFinish, deps, progress };
}

describe('Selbsttest – Ablauf', () => {
  it('fährt Lauf A VOR getUserMedia und Lauf B danach; der Stream bleibt während B offen', async () => {
    const world = makeWorld();
    const result = await runSelfTest('Pixel-Test', world.deps, world.progress);

    expect(world.log).toEqual([
      'offer:1:slot1', 'answer:1:OFFER-1', 'link:host', 'accept:1:slot1:ANSWER-1', 'finish:aus:open', 'close-host:1', 'close-client:1',
      'camera:open',
      'offer:2:slot1', 'answer:2:OFFER-2', 'link:host', 'accept:2:slot1:ANSWER-2', 'finish:an:open', 'close-host:2', 'close-client:2',
      'camera:stop',
    ]);
    expect(result.map((run) => [run.key, run.camera, run.cameraError, run.abortReason])).toEqual([['A', 'aus', null, null], ['B', 'an', null, null]]);
    expect(world.runs).toEqual(result);
    // Jeder fertige Lauf wird samt LabRunResult gemeldet – damit füttert die Oberfläche die Report-Liste des Labors.
    expect(world.results.map((entry) => entry?.report.id)).toEqual(['r-1', 'r-2']);
  });

  it('übergibt finishRun das Selbsttest-Zellenlabel, die Host-Seite und den ehrlichen getUserMedia-Stand', async () => {
    const world = makeWorld();
    await runSelfTest('Pixel-Test', world.deps, world.progress);
    const [a, b] = world.finishInputs;

    expect(a?.cell).toEqual({ role: 'selbsttest', hotspotOwner: 'unbekannt', camera: 'aus', path: 'loopback', device: 'Pixel-Test' });
    expect(b?.cell).toEqual({ role: 'selbsttest', hotspotOwner: 'unbekannt', camera: 'an', path: 'loopback', device: 'Pixel-Test' });
    expect(a?.gumCalledThisSession).toBe(false);
    expect(b?.gumCalledThisSession).toBe(true);
    expect(a?.artifacts?.payload).toBe('OFFER-1');
    expect(a?.remoteSdp).toBe('remote-sdp-1');
    expect(a?.peer?.transport).toBe(a?.transport);
    expect(a?.transport.peerId).toBe('slot-1');
    expect(a?.notes).toBe('Selbsttest Lauf A (ohne getUserMedia)');
    expect(b?.notes).toBe('Selbsttest Lauf B (nach getUserMedia, Stream offen)');
    expect(world.timelineAtFinish[0]).toEqual(['selftest=Lauf A, Kamera aus', 'transport:open']);
    expect(world.timelineAtFinish[1]).toEqual(['selftest=Lauf B, Kamera an', 'transport:open']);
  });

  it('meldet den Fortschritt: eigene Schritte und die durchgereichten Statuszeilen von finishRun', async () => {
    const world = makeWorld();
    await runSelfTest('Pixel-Test', world.deps, world.progress);
    expect(world.statuses).toEqual([
      S.lab.selfTest.statusRunA,
      fmt(S.lab.selfTest.statusStep, { run: 'A', text: 'Diagnose wird gesammelt …' }),
      S.lab.selfTest.statusCamera,
      S.lab.selfTest.statusRunB,
      fmt(S.lab.selfTest.statusStep, { run: 'B', text: 'Diagnose wird gesammelt …' }),
      S.lab.selfTest.statusDone,
    ]);
  });

  it('Kamera verweigert: Lauf B läuft trotzdem, trägt cameraError und das Zeitleisten-Ereignis für F9', async () => {
    const world = makeWorld({ cameraError: 'NotAllowedError' });
    const result = await runSelfTest('Pixel-Test', world.deps, world.progress);

    expect(result[1]?.cameraError).toBe('NotAllowedError');
    expect(result[1]?.report).not.toBeNull();
    expect(world.timelineAtFinish[1]).toEqual(['selftest=Lauf B, Kamera an', 'camera-error=NotAllowedError', 'transport:open']);
    expect(world.finishInputs[1]?.notes).toBe('Selbsttest Lauf B (getUserMedia fehlgeschlagen: NotAllowedError)');
    expect(world.finishInputs[1]?.gumCalledThisSession).toBe(true);
    expect(world.log).not.toContain('camera:stop');
  });

  it('Handshake-Fehler bricht nur den betroffenen Lauf ab, räumt auf und wirft nicht', async () => {
    const world = makeWorld({ failAnswerInRun: 1 });
    const result = await runSelfTest('Pixel-Test', world.deps, world.progress);

    expect(result[0]).toEqual({ key: 'A', camera: 'aus', report: null, abortReason: 'F5: Nonce passt nicht', cameraError: null });
    expect(result[1]?.report).not.toBeNull();
    expect(world.results[0]).toBeNull();
    expect(world.log.filter((line) => line.startsWith('close-'))).toEqual(['close-host:1', 'close-client:1', 'close-host:2', 'close-client:2']);
    expect(world.log.filter((line) => line.startsWith('finish:'))).toEqual(['finish:an:open']);
  });

  it('öffnet die Verbindung nie, entsteht nach dem Zeitlimit trotzdem ein Diagnose-Report', async () => {
    const world = makeWorld({ settle: 'never' });
    const result = await runSelfTest('Pixel-Test', world.deps, world.progress);
    expect(world.log.filter((line) => line.startsWith('finish:'))).toEqual(['finish:aus:connecting', 'finish:an:connecting']);
    expect(result.every((run) => run.report !== null)).toBe(true);
  });

  it('wartet bei „failed" nicht das Zeitlimit ab und vermerkt den Zustand in der Zeitleiste', async () => {
    const world = makeWorld({ settle: 'failed' });
    world.deps.openTimeoutMs = 60_000;
    await runSelfTest('Pixel-Test', world.deps, world.progress);
    expect(world.timelineAtFinish[0]).toEqual(['selftest=Lauf A, Kamera aus', 'transport:failed']);
  });

  it('zweiter Durchgang ohne Neuladen: Lauf A kennt den früheren getUserMedia-Aufruf', async () => {
    const world = makeWorld();
    await runSelfTest('Pixel-Test', world.deps, world.progress);
    await runSelfTest('Pixel-Test', world.deps, world.progress);
    expect(world.finishInputs[2]?.cell.camera).toBe('aus');
    expect(world.finishInputs[2]?.gumCalledThisSession).toBe(true);
    expect(world.finishInputs[2]?.notes).toBe('Selbsttest Lauf A (ohne getUserMedia; getUserMedia lief in dieser Sitzung aber schon – für einen sauberen Lauf A die Seite neu laden)');
  });

  it('ein Programmfehler in Lauf B stoppt den Kamera-Stream trotzdem', async () => {
    // Kein erwartbarer Fehlschlag, sondern ein echter Programmfehler VOR dem try von runPair:
    // er darf durchschlagen, aber die Kamera des Geräts nicht offen lassen.
    const world = makeWorld();
    const lobbyFor = world.deps.createHostLobby;
    let calls = 0;
    world.deps.createHostLobby = (connector) => {
      calls += 1;
      if (calls === 2) throw new Error('Programmfehler in Lauf B');
      return lobbyFor(connector);
    };

    await expect(runSelfTest('Pixel-Test', world.deps, world.progress)).rejects.toThrow('Programmfehler in Lauf B');
    expect(world.log).toContain('camera:stop');
  });

  it('ein werfender Statusrückruf vor Lauf B stoppt den Kamera-Stream trotzdem', async () => {
    // Die Statuszeile von Lauf B steht MIT im try, das den Stream schließt (Ruling C aus Task 9):
    // wirft die Oberfläche genau dort, darf die Kamera des Geräts nicht offen bleiben.
    const world = makeWorld();
    const progress: SelfTestProgress = {
      onStatus: (text) => {
        if (text === S.lab.selfTest.statusRunB) throw new Error('Oberfläche kaputt');
        world.progress.onStatus(text);
      },
      onRun: world.progress.onRun,
    };

    await expect(runSelfTest('Pixel-Test', world.deps, progress)).rejects.toThrow('Oberfläche kaputt');
    expect(world.log).toContain('camera:stop');
    // Lauf B kam nie zustande – nur Lauf A hat gemessen.
    expect(world.log.filter((line) => line.startsWith('finish:'))).toEqual(['finish:aus:open']);
  });

  it('räumt die Zeitgeber beider Läufe auf – ein Abbruch lässt keinen 20-s-Wecker stehen', async () => {
    vi.useFakeTimers();
    try {
      // Lauf A läuft durch, Lauf B bricht ab: dessen beide Wächter müssen trotzdem entschärft werden.
      const world = makeWorld({ failAnswerInRun: 2 });
      world.deps.openTimeoutMs = 60_000;
      const done = runSelfTest('Pixel-Test', world.deps, world.progress);
      // Nur eine Millisekunde: genug für den 0-ms-Wecker von Lauf A, viel zu wenig für die 60-s-Wächter.
      await vi.advanceTimersByTimeAsync(1);
      const result = await done;
      expect(result[1]?.abortReason).toBe('F5: Nonce passt nicht');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Selbsttest – Gerätename', () => {
  it('leer oder fehlend wird zu „unbenannt", sonst getrimmt und auf 24 Zeichen gekürzt', () => {
    expect(normaliseDevice(null)).toBe('unbenannt');
    expect(normaliseDevice('   ')).toBe('unbenannt');
    expect(normaliseDevice('  iPhone von Kim ')).toBe('iPhone von Kim');
    expect(normaliseDevice('x'.repeat(40))).toBe('x'.repeat(24));
  });

  it('lässt nach dem Kürzen kein Leerzeichen am Ende stehen (zweites trim)', () => {
    expect(normaliseDevice(`${'x'.repeat(23)} yz`)).toBe('x'.repeat(23));
  });
});

describe('Selbsttest – Zeitlimit', () => {
  it('wartet 20 s je Lauf: Chromium meldet einen nie verbundenen ICE-Lauf erst nach ≈ 15 s als „failed"', () => {
    expect(SELFTEST_OPEN_TIMEOUT_MS).toBe(20_000);
  });
});

describe('Selbsttest – Ergebniszeile', () => {
  const run = (overrides: Partial<SelfTestRun>): SelfTestRun => ({ key: 'B', camera: 'an', report: makeReport(), abortReason: null, cameraError: null, ...overrides });

  it('gültiger Lauf: Kandidaten gesamt / echte IP / mDNS, Paar, Ping „events", keine Fehlercodes', () => {
    expect(summariseRun(run({}))).toEqual({
      key: 'B', state: 'valid', reason: '',
      camera: S.lab.selfTest.cameraOn,
      valid: S.lab.selfTest.valid,
      candidates: '2 / 1 / 1',
      pair: 'private → private',
      ping: fmt(S.lab.selfTest.pingValue, { median: '0,4', p95: '1,3', loss: '0' }),
      failures: S.lab.selfTest.none,
    });
  });

  it('ungültiger Lauf A nennt den Grund aus dem Report', () => {
    const reason = 'Kamera aus, aber Berechtigung ist erteilt';
    const row = summariseRun(run({ key: 'A', camera: 'aus', report: makeReport({ valid: false, invalidReason: reason }) }));
    expect(row.state).toBe('invalid');
    expect(row.reason).toBe(reason);
    expect(row.valid).toBe(fmt(S.lab.selfTest.invalid, { reason }));
    expect(row.camera).toBe(S.lab.selfTest.cameraOff);
  });

  it('Kamera verweigert: die Kamera-Zelle sagt es, die Fehlercodes stehen in Report-Reihenfolge', () => {
    const row = summariseRun(run({ cameraError: 'NotAllowedError', report: makeReport({ failures: ['F2', 'F9'], ping: { state: null, events: null }, selectedPair: null, gather: null }) }));
    expect(row.camera).toBe(fmt(S.lab.selfTest.cameraDenied, { error: 'NotAllowedError' }));
    expect(row.failures).toBe('F2, F9');
    expect(row.candidates).toBe(S.lab.selfTest.none);
    expect(row.pair).toBe(S.lab.selfTest.none);
    expect(row.ping).toBe(S.lab.selfTest.none);
  });

  it('abgebrochener Lauf ohne Report nennt den Fehlercode im Klartext statt des Browser-Textes', () => {
    // Der technische Grund stammt vom Browser und kann eine Adresse mitbringen – auf dem Schirm steht der Klartext.
    const row = summariseRun(run({ report: null, abortReason: `F5: Nonce passt nicht (${DOC_IPV4})` }));
    expect(row.state).toBe('aborted');
    expect(row.reason).toBe(S.failures.F5.title);
    expect(row.valid).toBe(fmt(S.lab.selfTest.aborted, { reason: S.failures.F5.title }));
    expect(row.valid).not.toContain(DOC_IPV4);
    expect(row.candidates).toBe(S.lab.selfTest.none);
  });

  it('der zweistellige Code F1S wird nicht als F1 gelesen', () => {
    const row = summariseRun(run({ report: null, abortReason: 'F1S: keine Adresse' }));
    expect(row.reason).toBe(S.failures.F1S.title);
  });

  it('ein Abbruch ohne bekannten Fehlercode zeigt den geschwaerzten Text', () => {
    const row = summariseRun(run({ report: null, abortReason: `Der Client hat keinen Peer angelegt (${DOC_IPV4})` }));
    expect(row.reason).toBe('Der Client hat keinen Peer angelegt (ipv4/other#1)');
    expect(row.reason).not.toContain(DOC_IPV4);
    expect(row.valid).not.toContain(DOC_IPV4);
  });
});

describe('Selbsttest – Text zum Kopieren/Teilen', () => {
  it('enthält beide Reports als JSON, aber keine Adresse mehr', () => {
    const runs: SelfTestRun[] = [
      { key: 'A', camera: 'aus', report: makeReport({ id: 'r-a' }), abortReason: null, cameraError: null },
      { key: 'B', camera: 'an', report: makeReport({ id: 'r-b' }), abortReason: null, cameraError: null },
    ];
    const text = selfTestShareText(runs);
    const parsed = JSON.parse(text) as LabReport[];
    expect(parsed.map((report) => report.id)).toEqual(['r-a', 'r-b']);
    expect(text).not.toContain(DOC_IPV4);
    expect(text).not.toContain(MDNS_NAME);
    // Token-Form laut Vertrag: <familie>/<scope>#n – welcher Scope es ist, entscheidet candidates.ts.
    expect(parsed[0]?.gather?.gathered[0]?.address).toMatch(/^ipv4\/[a-z-]+#1$/);
    // Das Original bleibt unangetastet – im localStorage des Geräts liegen weiter die echten Adressen.
    expect(runs[0]?.report?.gather?.gathered[0]?.address).toBe(DOC_IPV4);
  });

  it('hängt abgebrochene Läufe als Klartextzeile an, damit auch sie beim Entwickler ankommen', () => {
    const text = selfTestShareText([
      { key: 'A', camera: 'aus', report: null, abortReason: 'F5: Nonce passt nicht', cameraError: null },
      { key: 'B', camera: 'an', report: makeReport({ id: 'r-b' }), abortReason: null, cameraError: null },
    ]);
    expect(text).toContain('"id": "r-b"');
    expect(text.endsWith('Selbsttest Lauf A (Kamera aus) abgebrochen: F5: Nonce passt nicht')).toBe(true);
  });

  it('schwaerzt auch den Abbruchgrund – ein Browser-Fehlertext zitiert die fehlerhafte Zeile samt Adresse', () => {
    const reason = `F5: apply answer: Failed to parse a=candidate:1 1 udp 2122260223 ${DOC_IPV4} 50001 typ host, ${MDNS_NAME} unbekannt`;
    const text = selfTestShareText([
      { key: 'A', camera: 'aus', report: null, abortReason: reason, cameraError: null },
      { key: 'B', camera: 'an', report: makeReport({ id: 'r-b' }), abortReason: null, cameraError: null },
    ]);
    expect(text).not.toContain(DOC_IPV4);
    expect(text).not.toContain(MDNS_NAME);
    // Die Zeile bleibt lesbar: „abgebrochen" und der Fehlercode müssen beim Entwickler ankommen.
    expect(text).toContain('Selbsttest Lauf A (Kamera aus) abgebrochen: F5:');
    expect(text).toContain('ipv4/other#');
    expect(text).toContain('mdns/mdns#');
  });
});
