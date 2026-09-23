import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBroadcastTransport } from '../../../src/net/broadcastTransport';
import type { EnvironmentInfo, PermissionSnapshot } from '../../../src/net/environment';
import { createTimeline, type Timeline } from '../../../src/net/timeline';
import type { Transport } from '../../../src/net/transport';
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

  it('meldet, wenn der Report nicht gespeichert werden kann', async () => {
    vi.stubGlobal('localStorage', { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } });
    const statuses: string[] = [];
    await run(lonely(), 'host', createTimeline(now), statuses);
    expect(statuses[statuses.length - 1]).toBe(S.lab.run.saveFailed);
  });
});
