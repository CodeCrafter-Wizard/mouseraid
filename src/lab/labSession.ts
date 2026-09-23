import { candidatesFromSdp, parseCandidate, summariseCandidates, type ParsedCandidate } from '../net/candidates';
import type { HandshakeArtifacts } from '../net/connector';
import { collectEnvironment, collectSelectedPair, queryPermissions, sctpMaxMessageSize, type SelectedPair } from '../net/environment';
import { classifyFailures } from '../net/failureCodes';
import { createMessageRouter, type MessageRouter } from '../net/messageRouter';
import { attachPongResponder, runPingSeries, type PingStats } from '../net/pingTest';
import { PROTOCOL_VERSION, type NetMessage } from '../net/protocol';
import type { RtcPeer } from '../net/rtcTransport';
import type { Timeline, TimelineEvent } from '../net/timeline';
import type { Channel, Transport } from '../net/transport';
import { BUILD_ID } from '../platform/buildInfo';
import { S, fmt } from '../ui/strings';
import { pingCountFor } from './labQuery';
import { createReportStore, isRunValid, type CellLabel, type LabReport } from './report';

export interface LabRunResult { report: LabReport; rawSdp: { local: string; remote: string } | null; }
export interface LabRunHooks { onStatus(text: string): void; onPingProgress?(channel: Channel, stats: PingStats): void; }

const HELLO_TIMEOUT_MS = 3000;
const PING_INTERVAL_MS = 33;
const PING_TIMEOUT_MS = 2000;
/** Reihenfolge laut Plan: erst der zuverlässige Kanal, dann der unzuverlässige. */
const PING_CHANNELS: readonly Channel[] = ['events', 'state'];
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

type Hello = Extract<NetMessage, { type: 'hello' }>;

/** Ein Router je Transport: `createMessageRouter` belegt `transport.onMessage`, ein zweiter würde den ersten abklemmen. */
interface LabLink { router: MessageRouter; remoteHello: Hello | null; helloSent: boolean; waiters: ((hello: Hello | null) => void)[]; }
const links = new WeakMap<Transport, LabLink>();

function sendHello(link: LabLink): void {
  if (link.router.send('events', { type: 'hello', protoV: PROTOCOL_VERSION, buildId: BUILD_ID })) link.helloSent = true;
}

function linkFor(transport: Transport): LabLink {
  const existing = links.get(transport);
  if (existing !== undefined) return existing;
  const router = createMessageRouter(transport);
  attachPongResponder(router);
  const link: LabLink = { router, remoteHello: null, helloSent: false, waiters: [] };
  router.on('hello', (message) => {
    link.remoteHello = message;
    // Genau eine automatische Antwort: Startet die Gegenstelle ihren Lauf früher als wir, bekommt sie
    // trotzdem unser Hello. Nach dem ersten eigenen Hello nie wieder – sonst Ping-Pong ohne Ende.
    if (!link.helloSent) sendHello(link);
    for (const waiter of link.waiters.splice(0)) waiter(message);
  });
  links.set(transport, link);
  return link;
}

/**
 * Früh aufrufen (sobald der Transport existiert): beantwortet ab dann Pings und merkt sich das Hello der
 * Gegenstelle – auch wenn der eigene `finishRun` erst später per Knopfdruck startet.
 */
export function attachLabLink(transport: Transport): void {
  linkFor(transport);
}

function waitForHello(link: LabLink, timeoutMs: number): Promise<Hello | null> {
  if (link.remoteHello !== null) return Promise.resolve(link.remoteHello);
  return new Promise((resolve) => {
    const done = (hello: Hello | null): void => {
      clearTimeout(timer);
      link.waiters = link.waiters.filter((waiter) => waiter !== done);
      resolve(hello);
    };
    const timer = setTimeout(() => { done(null); }, timeoutMs);
    link.waiters.push(done);
  });
}

/** id = Build-ID + '-' + Zeit (Base36) + '-' + vier Zufallszeichen. */
export function makeReportId(buildId: string, epochMs: number, randomBytes: Uint8Array): string {
  let suffix = '';
  for (const byte of randomBytes.subarray(0, 4)) suffix += ID_ALPHABET.charAt(byte % ID_ALPHABET.length);
  return `${buildId}-${Math.floor(epochMs).toString(36)}-${suffix}`;
}

function parsedCandidates(artifacts: HandshakeArtifacts): ParsedCandidate[] {
  const list: ParsedCandidate[] = [];
  for (const raw of candidatesFromSdp(artifacts.localSdp)) {
    const parsed = parseCandidate(raw);
    if (parsed !== null) list.push(parsed);
  }
  return list;
}

/** Zeit seit „ICE verbunden", gemessen in Zeitleisten-Zeit bis zum jüngsten Ereignis. */
function msSinceIceConnected(events: readonly TimelineEvent[]): number | null {
  const connected = events.find((event) => event.kind === 'ice:connected' || event.kind === 'ice:completed');
  const last = events[events.length - 1];
  return connected === undefined || last === undefined ? null : last.tMs - connected.tMs;
}

async function selectedPairOf(peer: RtcPeer | null): Promise<SelectedPair | null> {
  if (peer === null) return null;
  try {
    return await collectSelectedPair(peer.pc);
  } catch {
    return null;
  }
}

function storeReport(report: LabReport): boolean {
  try {
    const store = createReportStore(localStorage);
    store.add(report);
    // `add` wirft nie (Task 7 schluckt Quota und gesperrten Speicher) – ob der Report wirklich liegt, zeigt nur das Zurücklesen.
    return store.list().some((stored) => stored.id === report.id);
  } catch {
    return false;
  }
}

/**
 * Schließt einen Lauf ab: Hello-Austausch, Ping auf beiden Kanälen, Diagnose, Klassifikation, Validität –
 * und speichert den Report. Ohne offene Verbindung entfallen Hello und Ping; die Diagnose entsteht trotzdem,
 * denn gerade der Fehlschlag soll als Report teilbar sein.
 *
 * Zeitleisten-Konvention der Aufrufer: `transport:<state>` bei jedem Zustandswechsel, `camera-error`
 * (detail = Fehlername), wenn die Kamera-Anforderung scheiterte → F9, `camera:running`, `permissions:handshake`.
 */
export async function finishRun(input: {
  cell: CellLabel; transport: Transport; peer: RtcPeer | null; timeline: Timeline; artifacts: HandshakeArtifacts | null; remoteSdp: string | null;
  gumCalledThisSession: boolean; hooks: LabRunHooks; now: () => number; notes?: string;
}): Promise<LabRunResult> {
  const { cell, transport, peer, timeline, artifacts, hooks } = input;
  const link = linkFor(transport);
  timeline.push('run:start', transport.state);

  let hello: LabReport['hello'] = null;
  const ping: LabReport['ping'] = { state: null, events: null };
  if (transport.state === 'open') {
    hooks.onStatus(S.lab.run.hello);
    sendHello(link);
    const remote = await waitForHello(link, HELLO_TIMEOUT_MS);
    if (remote !== null) {
      hello = { remoteProtoV: remote.protoV, remoteBuildId: remote.buildId, versionMatch: remote.protoV === PROTOCOL_VERSION && remote.buildId === BUILD_ID };
    }
    timeline.push('run:hello', hello === null ? 'keine Antwort' : hello.versionMatch ? 'passt' : 'Versionskonflikt');
    const count = pingCountFor(cell.path, typeof location === 'undefined' ? '' : location.search);
    for (const channel of PING_CHANNELS) {
      hooks.onStatus(fmt(S.lab.run.ping, { channel }));
      const stats = await runPingSeries(link.router, channel, { count, intervalMs: PING_INTERVAL_MS, timeoutMs: PING_TIMEOUT_MS, now: input.now });
      ping[channel] = stats;
      timeline.push(`run:ping:${channel}`, `${stats.received}/${stats.sent}`);
      hooks.onPingProgress?.(channel, stats);
    }
  } else {
    hooks.onStatus(S.lab.run.notOpen);
  }

  hooks.onStatus(S.lab.run.collecting);
  const [environment, permissions, selectedPair] = await Promise.all([collectEnvironment(), queryPermissions(), selectedPairOf(peer)]);
  const gathered = artifacts === null ? null : parsedCandidates(artifacts);
  timeline.push('run:diagnose', transport.state);
  const events = [...timeline.events()];

  const failures = classifyFailures({
    secureContext: environment.secureContext,
    rtcAvailable: environment.features.rtc,
    engine: environment.engine,
    cameraPermission: permissions.camera,
    localNetworkPermission: permissions.localNetwork,
    candidates: gathered === null ? null : summariseCandidates(gathered),
    // Gemessen (Task 6, Chromium 153): ein nie verbundener ICE-Lauf endet als ice:'disconnected' + connection:'failed' –
    // `iceConnectionState` wird dort nie 'failed'. Für F3 zählen deshalb connectionState und der Transport-Zustand mit.
    iceState: peer === null ? 'none' : peer.pc.connectionState === 'failed' || transport.state === 'failed' ? 'failed' : peer.pc.iceConnectionState,
    channelsOpen: transport.state === 'open',
    msSinceIceConnected: msSinceIceConnected(events),
    wasOpenBefore: events.some((event) => event.kind.startsWith('channel-open:') || event.kind === 'transport:open'),
    codecError: hello !== null && !hello.versionMatch,
    cameraError: events.some((event) => event.kind === 'camera-error'),
  });
  const validity = isRunValid(cell, permissions);

  const report: LabReport = {
    id: makeReportId(BUILD_ID, Date.now(), crypto.getRandomValues(new Uint8Array(4))),
    createdAt: new Date().toISOString(),
    buildId: BUILD_ID,
    protoV: PROTOCOL_VERSION,
    cell,
    environment,
    permissions,
    gumCalledThisSession: input.gumCalledThisSession,
    gather: artifacts === null || gathered === null
      ? null
      : { durationMs: artifacts.gather.durationMs, timedOut: artifacts.gather.timedOut, gathered, transmitted: artifacts.gather.transmitted },
    payloadSizes: artifacts === null ? null : artifacts.sizes,
    timeline: events,
    selectedPair,
    sctpMaxMessageSize: peer === null ? null : sctpMaxMessageSize(peer.pc),
    hello,
    ping,
    lockTest: null,
    failures,
    valid: validity.valid,
    invalidReason: validity.reason,
    notes: input.notes ?? '',
  };
  hooks.onStatus(storeReport(report) ? S.lab.run.saved : S.lab.run.saveFailed);
  return { report, rawSdp: artifacts === null ? null : { local: artifacts.localSdp, remote: input.remoteSdp ?? '' } };
}
