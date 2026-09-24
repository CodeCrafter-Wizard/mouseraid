import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBroadcastTransport } from '../../../src/net/broadcastTransport';
import type { EnvironmentInfo, PermissionSnapshot } from '../../../src/net/environment';
import { createMessageRouter } from '../../../src/net/messageRouter';
import { attachPongResponder } from '../../../src/net/pingTest';
import { PROTOCOL_VERSION, encodeMessage } from '../../../src/net/protocol';
import { createTimeline, type Timeline } from '../../../src/net/timeline';
import type { Transport } from '../../../src/net/transport';
import { recordLabEvent } from '../../../src/lab/labEvents';
import { attachLabLink, finishRun, makeReportId } from '../../../src/lab/labSession';
import { createReportStore, type CellLabel } from '../../../src/lab/report';
import { S, fmt } from '../../../src/ui/strings';

// Die Browser-Diagnose (navigator, matchMedia …) gibt es in Node nicht – sie wird ersetzt.
// Alles andere (Router, Ping, BroadcastChannel, Klassifikation, Report-Speicher) ist echt.
const probe = vi.hoisted(() => ({ camera: 'prompt' as 'granted' | 'denied' | 'prompt' | 'unsupported' }));

vi.mock('../../../src/net/environment', () => {
  const environment: EnvironmentInfo = {
    userAgent: 'Vitest', engine: 'chromium', displayMode: 'browser', secureContext: true, online: true, swControlled: false, buildId: 'test-build',
    features: { rtc: true, compressionStream: true, wakeLock: false, barcodeDetector: false, barcodeFormats: [], storagePersist: false, shareText: false, clipboardWrite: false },
  };
  return {
    collectEnvironment: (): Promise<EnvironmentInfo> => Promise.resolve(environment),
    queryPermissions: (): Promise<PermissionSnapshot> => Promise.resolve({ camera: probe.camera, localNetwork: 'unsupported', loopbackNetwork: 'unsupported' }),
    collectSelectedPair: (): Promise<null> => Promise.resolve(null),
    sctpMaxMessageSize: (): null => null,
  };
});

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

const now = (): number => performance.now();
const cell = (role: 'host' | 'client', camera: 'an' | 'aus' = 'aus'): CellLabel => ({ role, hotspotOwner: 'router', camera, path: 'broadcast', device: `Test-${role}` });
/** Erstes Byte eines kodierten Hello – so zählt der Test Hello-Rahmen, ohne eine interne Konstante zu kennen. */
const HELLO_TYPE_BYTE = encodeMessage({ type: 'hello', protoV: PROTOCOL_VERSION, buildId: 'x' })[0];

let roomCounter = 0;
const opened: Transport[] = [];

function pair(): { host: Transport; client: Transport } {
  roomCounter += 1;
  const room = `labsession-${roomCounter}-${Date.now().toString(36)}`;
  const host = createBroadcastTransport({ room, selfId: 'host', peerId: 'client-1' });
  const client = createBroadcastTransport({ room, selfId: 'client-1', peerId: 'host' });
  opened.push(host, client);
  return { host, client };
}

async function untilOpen(transport: Transport): Promise<void> {
  await vi.waitFor(() => { expect(transport.state).toBe('open'); }, { timeout: 5000, interval: 10 });
}

function run(transport: Transport, role: 'host' | 'client', timeline: Timeline = createTimeline(now), statuses: string[] = []) {
  return finishRun({
    cell: cell(role), transport, peer: null, timeline, artifacts: null, remoteSdp: null,
    gumCalledThisSession: false, hooks: { onStatus: (text) => statuses.push(text) }, now,
  });
}

describe('labSession', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    probe.camera = 'prompt';
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    for (const transport of opened.splice(0)) transport.close();
    vi.unstubAllGlobals();
  });

  it('makeReportId: Build-ID, Zeit in Base36 und vier Zufallszeichen', () => {
    expect(makeReportId('abc12345', 1_700_000_000_000, Uint8Array.of(0, 35, 36, 255))).toBe(`abc12345-${(1_700_000_000_000).toString(36)}-0z03`);
  });

  it('beide Seiten gleichzeitig: Hello passt, 20 Pings je Kanal ohne Verlust, Report gespeichert', async () => {
    const { host, client } = pair();
    await Promise.all([untilOpen(host), untilOpen(client)]);
    const progress: string[] = [];
    const [hostRun, clientRun] = await Promise.all([
      finishRun({
        cell: cell('host'), transport: host, peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null, gumCalledThisSession: true,
        hooks: { onStatus: () => undefined, onPingProgress: (channel, stats) => progress.push(`${channel}:${stats.sent}`) }, now, notes: 'Notiz',
      }),
      run(client, 'client'),
    ]);

    expect(hostRun.rawSdp).toBeNull();
    expect(progress).toEqual(['events:20', 'state:20']);
    for (const { report } of [hostRun, clientRun]) {
      expect(report.id).toMatch(/^test-build-[0-9a-z]+-[0-9a-z]{4}$/);
      expect(report.buildId).toBe('test-build');
      expect(report.hello).toEqual({ remoteProtoV: 1, remoteBuildId: 'test-build', versionMatch: true });
      expect(report.ping.events).toMatchObject({ sent: 20, received: 20, lossPct: 0 });
      expect(report.ping.state).toMatchObject({ sent: 20, received: 20 });
      expect(report.gather).toBeNull();
      expect(report.payloadSizes).toBeNull();
      expect(report.selectedPair).toBeNull();
      expect(report.sctpMaxMessageSize).toBeNull();
      expect(report.lockTest).toBeNull();
      expect(report.failures).toEqual([]);
      expect(report.valid).toBe(true);
      expect(Number.isNaN(Date.parse(report.createdAt))).toBe(false);
    }
    expect(hostRun.report.gumCalledThisSession).toBe(true);
    expect(hostRun.report.notes).toBe('Notiz');
    expect(clientRun.report.notes).toBe('');
    expect(hostRun.report.timeline.map((event) => event.kind)).toEqual(expect.arrayContaining(['run:start', 'run:diagnose']));
    // Die Einträge von finishRun selbst – vollständig und in dieser Reihenfolge.
    expect(hostRun.report.timeline.map((event) => event.kind).filter((kind) => kind.startsWith('run:')))
      .toEqual(['run:start', 'run:hello', 'run:ping:events', 'run:ping:state', 'run:diagnose']);
    expect(createReportStore(storage).list().map((report) => report.id).sort()).toEqual([hostRun.report.id, clientRun.report.id].sort());
  });

  it('versetzter Start: der Host antwortet dank attachLabLink schon vor seinem eigenen Lauf', async () => {
    const { host, client } = pair();
    attachLabLink(host);
    await Promise.all([untilOpen(host), untilOpen(client)]);

    const clientRun = await run(client, 'client');
    expect(clientRun.report.hello?.versionMatch).toBe(true);
    expect(clientRun.report.ping.events).toMatchObject({ sent: 20, lossPct: 0 });

    // Das Hello des Clients liegt dem Host schon vor – sein späterer Lauf wartet nicht 3 s darauf:
    // gemessen wird nur die Hello-Phase (bis zur ersten Ping-Statusmeldung).
    const startedAt = now();
    let helloPhaseMs = Number.POSITIVE_INFINITY;
    const hostRun = await finishRun({
      cell: cell('host'), transport: host, peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null, gumCalledThisSession: false, now,
      hooks: { onStatus: (text) => { if (text === fmt(S.lab.run.ping, { channel: 'events' })) helloPhaseMs = now() - startedAt; } },
    });
    expect(hostRun.report.hello?.remoteBuildId).toBe('test-build');
    expect(hostRun.report.ping.events).toMatchObject({ sent: 20, lossPct: 0 });
    expect(helloPhaseMs).toBeLessThan(1000);
  });

  /** Offen, aber stumm: die Gegenstelle antwortet nie – weder auf Hello noch auf Pings. */
  function muteOpen(): Transport {
    return { peerId: 'stumm', state: 'open', send: () => true, onMessage: null, onStateChange: null, close: () => undefined };
  }

  it('offene Verbindung ohne Antwort: Hello läuft in den Timeout, alle Pings zählen als Verlust', async () => {
    const startedAt = now();
    let helloPhaseMs = Number.POSITIVE_INFINITY;
    const result = await finishRun({
      cell: cell('host'), transport: muteOpen(), peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null,
      gumCalledThisSession: false, now,
      hooks: { onStatus: (text) => { if (text === fmt(S.lab.run.ping, { channel: 'events' })) helloPhaseMs = now() - startedAt; } },
    });
    expect(result.report.hello).toBeNull();
    expect(result.report.timeline.find((event) => event.kind === 'run:hello')?.detail).toBe('keine Antwort');
    expect(result.report.ping.events).toMatchObject({ sent: 20, received: 0, lossPct: 100 });
    expect(result.report.ping.state).toMatchObject({ sent: 20, received: 0, lossPct: 100 });
    // Zugesagt sind höchstens 3 s Hello-Wartezeit; eine höhere Grenze macht genau diese Zeile rot.
    expect(helloPhaseMs).toBeLessThan(4000);
  }, 15_000);

  it('genau eine automatische Hello-Antwort, egal wie oft die Gegenstelle misst', async () => {
    const { host, client } = pair();
    // Hello-Rahmen der passiven Seite zählen, ohne ihr Verhalten zu verändern.
    const original = client.send.bind(client);
    let helloFrames = 0;
    client.send = (channel, data) => {
      if (data[0] === HELLO_TYPE_BYTE) helloFrames += 1;
      return original(channel, data);
    };
    attachLabLink(client);
    await Promise.all([untilOpen(host), untilOpen(client)]);

    await run(host, 'host');
    await run(host, 'host');
    expect(helloFrames).toBe(1);
  }, 20_000);

  it('die passive Seite antwortet auch dann, wenn sie selbst schon ein Hello gesendet hat', async () => {
    const { host, client } = pair();
    await Promise.all([untilOpen(host), untilOpen(client)]);
    // Der Client misst zuerst – der Host hört zu diesem Zeitpunkt noch gar nicht zu.
    const clientRun = await run(client, 'client');
    expect(clientRun.report.hello).toBeNull();

    // Erst jetzt hängt sich der Host ein: sein Hello muss der Client trotzdem beantworten.
    attachLabLink(host);
    const hostRun = await run(host, 'host');
    expect(hostRun.report.hello?.versionMatch).toBe(true);
    expect(hostRun.report.ping.events).toMatchObject({ sent: 20, lossPct: 0 });
  }, 25_000);

  it('Versionskonflikt im Hello wird als F5 klassifiziert', async () => {
    const { host, client } = pair();
    // Eigener Router auf der Gegenstelle (ihr einziger): antwortet mit einem fremden Build.
    const peerRouter = createMessageRouter(client);
    attachPongResponder(peerRouter);
    peerRouter.on('hello', () => { peerRouter.send('events', { type: 'hello', protoV: PROTOCOL_VERSION, buildId: 'fremder-build' }); });
    await Promise.all([untilOpen(host), untilOpen(client)]);

    const result = await run(host, 'host');
    expect(result.report.hello).toEqual({ remoteProtoV: PROTOCOL_VERSION, remoteBuildId: 'fremder-build', versionMatch: false });
    expect(result.report.failures).toContain('F5');
    expect(result.report.timeline.find((event) => event.kind === 'run:hello')?.detail).toBe('Versionskonflikt');
  }, 15_000);

  /** Ein Transport ohne Gegenstelle bleibt 'connecting' – Läufe darauf brauchen keine Ping-Zeit. */
  function lonely(): Transport {
    roomCounter += 1;
    const transport = createBroadcastTransport({ room: `labsession-allein-${roomCounter}-${Date.now().toString(36)}`, selfId: 'host', peerId: 'client-1' });
    opened.push(transport);
    return transport;
  }

  it('ohne offene Verbindung: keine Pings, aber Diagnose-Report mit Status-Hinweis', async () => {
    // „Kamera aus“ bei erteilter Erlaubnis misst nicht, was das Label behauptet → ungültig.
    probe.camera = 'granted';
    const statuses: string[] = [];
    const result = await finishRun({
      cell: { ...cell('host'), path: 'text' }, transport: lonely(), peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null,
      gumCalledThisSession: false, hooks: { onStatus: (text) => statuses.push(text) }, now,
    });
    expect(result.report.valid).toBe(false);
    expect(result.report.invalidReason).not.toBeNull();
    expect(result.report.hello).toBeNull();
    expect(result.report.ping).toEqual({ state: null, events: null });
    expect(statuses).toContain(S.lab.run.notOpen);
    expect(statuses[statuses.length - 1]).toBe(S.lab.run.saved);
    expect(createReportStore(storage).list()).toHaveLength(1);
  });

  it('ein Kamera-Fehler in der Zeitleiste ergibt F9', async () => {
    const timeline = createTimeline(now);
    timeline.push('camera-error', 'NotAllowedError');
    const result = await run(lonely(), 'host', timeline);
    expect(result.report.failures).toEqual(['F9']);
  });

  it('ein qr:error in der Zeitleiste ergibt F9 – auch ohne Kamera-Fehler', async () => {
    const timeline = createTimeline(now);
    timeline.push('qr:error', 'scan-timeout');
    const result = await run(lonely(), 'host', timeline);
    expect(result.report.failures).toEqual(['F9']);
  });

  it('andere qr-Einträge sind kein Befund', async () => {
    const timeline = createTimeline(now);
    timeline.push('qr:backend', 'worker');
    timeline.push('qr:shown', 'offer 704 Zeichen, 101 Module, 4 px/Modul');
    timeline.push('qr:decoded', 'worker 24ms 7');
    timeline.push('qr:fallback-text', 'answer');
    const result = await run(lonely(), 'host', timeline);
    expect(result.report.failures).toEqual([]);
  });

  it('ohne Angabe stehen pairing und qr im Report auf null', async () => {
    const result = await run(lonely(), 'host');
    expect(result.report.pairing).toBeNull();
    expect(result.report.qr).toBeNull();
    expect(result.report.lockTest).toBeNull();
  });

  it('übergebene Paarungs- und QR-Fakten landen unverändert im Report', async () => {
    const pairing = {
      offerShownAt: 0, offerScannedMs: 4200, answerShownAt: 5100, answerScannedMs: 8400,
      connectedMs: 11_000, projectedLobbyFullMs: 30_000,
    };
    const qr = { backend: 'worker' as const, offerChars: 704, answerChars: 521, decodeLatencyMs: 24.5, attempts: 7 };
    const result = await finishRun({
      cell: { ...cell('host'), path: 'qr' }, transport: lonely(), peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null,
      gumCalledThisSession: true, hooks: { onStatus: () => undefined }, now, pairing, qr,
    });
    expect(result.report.pairing).toEqual(pairing);
    expect(result.report.qr).toEqual(qr);
    expect(result.report.cell.path).toBe('qr');
    // Ein gespeicherter Report muss die Formprüfung bestehen, sonst wäre er beim Zurücklesen weg.
    expect(createReportStore(storage).list()[0]?.qr).toEqual(qr);
  });

  it('ausdrücklich null übergeben ist dasselbe wie nichts übergeben', async () => {
    const result = await finishRun({
      cell: cell('host'), transport: lonely(), peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null,
      gumCalledThisSession: false, hooks: { onStatus: () => undefined }, now, pairing: null, qr: null,
    });
    expect(result.report.pairing).toBeNull();
    expect(result.report.qr).toBeNull();
  });

  it('meldet, wenn der Report nicht gespeichert werden kann', async () => {
    vi.stubGlobal('localStorage', { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } });
    const statuses: string[] = [];
    await run(lonely(), 'host', createTimeline(now), statuses);
    expect(statuses[statuses.length - 1]).toBe(S.lab.run.saveFailed);
  });

  // F9 aus der Kamera hängt am LETZTEN Kamera-Eintrag, nicht an irgendeinem: die Seiten-Ereignisse
  // gelten für den ganzen Seitenaufruf, also auch für Läufe NACH einem erfolgreichen „Kamera neu
  // starten". Ein Befund, der nicht mehr besteht, gehörte sonst für immer in jeden weiteren Report.
  // (Diese beiden Tests stehen am Ende: der Ereignis-Puffer ist Seiten-Zustand und wirkt vorwärts.)
  it('ein Kamera-Fehler, auf den ein erfolgreicher Neustart folgt, ist kein F9 mehr', async () => {
    recordLabEvent('camera:track:ended');
    recordLabEvent('camera-error', 'track-ended');
    recordLabEvent('camera:track:live');
    const result = await run(lonely(), 'host');
    expect(result.report.timeline.map((event) => event.kind)).toEqual(expect.arrayContaining(['camera-error', 'camera:track:live']));
    expect(result.report.failures).toEqual([]);
  });

  it('ist der Kamera-Fehler der letzte Kamera-Eintrag, bleibt F9 stehen', async () => {
    recordLabEvent('camera:track:live');
    recordLabEvent('camera:track:ended');
    recordLabEvent('camera-error', 'track-ended');
    const result = await run(lonely(), 'host');
    expect(result.report.failures).toEqual(['F9']);
  });
});
