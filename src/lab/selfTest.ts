import { summariseCandidates } from '../net/candidates';
import type { ClientJoin, ConnectorDeps, HostLobby } from '../net/connector';
import { PROTOCOL_VERSION } from '../net/protocol';
import { createTimeline, type Timeline } from '../net/timeline';
import type { Transport } from '../net/transport';
import { S, fmt } from '../ui/strings';
import type { attachLabLink, finishRun, LabRunResult } from './labSession';
import { redactReport, reportsToJson, type CellLabel, type LabReport } from './report';

// Selbsttest: EIN Gerät, EINE Seite. Host-Lobby und Client-Join entstehen in derselben Seite und tauschen
// Angebots- und Antwort-Code über den ganz normalen Codec-Pfad aus (Pfad-Label „loopback").
// Die Reihenfolge ist vom Design vorgegeben: Lauf A OHNE getUserMedia, danach Lauf B mit offenem Stream –
// der Vergleich entscheidet, ob die Kamera in der endgültigen Lobby Pflicht wird.
// Diese Datei ist DOM-frei (Vitest im Node-Umfeld); die Oberfläche liegt in selfTestUi.ts.

/** So lange darf der Verbindungsaufbau je Lauf dauern, bevor nur noch die Diagnose gespeichert wird. */
// 20 s, nicht 15: Chromium meldet einen nie verbundenen ICE-Lauf erst nach ≈ 15 s als 'failed' (Task 6, gemessen).
// Ein 15-s-Limit liefe damit um die Wette, und dem Report fehlte gerade F3. Zwei Läufe passen weiterhin in die zwei Minuten.
export const SELFTEST_OPEN_TIMEOUT_MS = 20_000;
export const DEFAULT_DEVICE = 'unbenannt';
const MAX_DEVICE_LENGTH = 24;
const SLOT = 1;

export type SelfTestRunKey = 'A' | 'B';

export interface SelfTestRun {
  key: SelfTestRunKey;
  camera: CellLabel['camera'];
  /** null = der Lauf brach vor der Diagnose ab (Grund in `abortReason`). */
  report: LabReport | null;
  abortReason: string | null;
  /** Name des getUserMedia-Fehlers (nur Lauf B), z. B. „NotAllowedError". */
  cameraError: string | null;
}

export interface CameraHandle { stop(): void; }

export interface SelfTestDeps {
  createHostLobby(deps: ConnectorDeps): HostLobby;
  createClientJoin(deps: ConnectorDeps): ClientJoin;
  finishRun: typeof finishRun;
  /** Macht die Client-Seite zum Antwortgeber (Hello + Pong), ohne dass dort ein zweiter Report entsteht. */
  attachLabLink: typeof attachLabLink;
  /** Nacktes `getUserMedia({ video: true })` mit eigenem Stream; wirft, wenn die Kamera verweigert wird oder fehlt. */
  openCamera(): Promise<CameraHandle>;
  /** „getUserMedia wurde in dieser Sitzung schon aufgerufen" – Seitenzustand aus camera.ts, überlebt mehrere Selbsttests. */
  gumCalled(): boolean;
  now(): number;
  randomNonce(): number;
  openTimeoutMs: number;
}

export interface SelfTestProgress {
  onStatus(text: string): void;
  /** `result` ist null, wenn der Lauf vor der Diagnose abbrach. */
  onRun(run: SelfTestRun, result: LabRunResult | null): void;
}

/** Spitzname fürs Zellenlabel: getrimmt, höchstens 24 Zeichen, nie leer. */
export function normaliseDevice(text: string | null): string {
  const trimmed = (text ?? '').trim().slice(0, MAX_DEVICE_LENGTH).trim();
  return trimmed === '' ? DEFAULT_DEVICE : trimmed;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : String(error);
}

/** `HandshakeError` wird an `failure` erkannt, nicht per `instanceof` – so bleibt diese Datei frei vom Browser-Code des Connectors. */
function describeAbort(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const failure = typeof error === 'object' && error !== null && 'failure' in error ? String(error.failure) : '';
  return failure === '' ? message : `${failure}: ${message}`;
}

/**
 * Schreibt jeden Zustandswechsel als `transport:<state>` in die Zeitleiste (Konvention von `finishRun`) und
 * löst auf, sobald der Transport nicht mehr „connecting" ist – spätestens nach `timeoutMs`.
 */
function watchTransport(transport: Transport, timeline: Timeline, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };
    transport.onStateChange = (state) => {
      timeline.push(`transport:${state}`);
      if (state !== 'connecting') settle();
    };
    if (transport.state !== 'connecting') {
      timeline.push(`transport:${transport.state}`);
      settle();
    }
  });
}

function runNotes(key: SelfTestRunKey, cameraError: string | null, gumCalledBefore: boolean): string {
  if (key === 'A') {
    const repeat = gumCalledBefore ? '; getUserMedia lief in dieser Sitzung aber schon – für einen sauberen Lauf A die Seite neu laden' : '';
    return `Selbsttest Lauf A (ohne getUserMedia${repeat})`;
  }
  return cameraError === null ? 'Selbsttest Lauf B (nach getUserMedia, Stream offen)' : `Selbsttest Lauf B (getUserMedia fehlgeschlagen: ${cameraError})`;
}

async function runPair(
  key: SelfTestRunKey, camera: CellLabel['camera'], cameraError: string | null, gumCalledBefore: boolean,
  device: string, deps: SelfTestDeps, progress: SelfTestProgress,
): Promise<{ run: SelfTestRun; result: LabRunResult | null }> {
  const connector: ConnectorDeps = { protoV: PROTOCOL_VERSION, makeTimeline: () => createTimeline(deps.now), randomNonce: deps.randomNonce };
  const lobby = deps.createHostLobby(connector);
  const join = deps.createClientJoin(connector);
  const cell: CellLabel = { role: 'selbsttest', hotspotOwner: 'unbekannt', camera, path: 'loopback', device };
  try {
    const offer = await lobby.createOffer(SLOT);
    const host = lobby.entries().get(SLOT);
    if (host === undefined) throw new Error('Selbsttest: Die Lobby kennt den eben angelegten Platz nicht.');
    host.timeline.push('selftest', `Lauf ${key}, Kamera ${camera}`);
    if (cameraError !== null) host.timeline.push('camera-error', cameraError);
    const hostOpen = watchTransport(host.peer.transport, host.timeline, deps.openTimeoutMs);

    const answer = await join.acceptOffer(offer.payload);
    const client = join.peer;
    const clientTimeline = join.timeline;
    if (client === null || clientTimeline === null) throw new Error('Selbsttest: Der Client hat keinen Peer angelegt.');
    deps.attachLabLink(client.transport);
    const clientOpen = watchTransport(client.transport, clientTimeline, deps.openTimeoutMs);

    await lobby.acceptAnswer(SLOT, answer.payload);
    await Promise.all([hostOpen, clientOpen]);

    const result = await deps.finishRun({
      cell, transport: host.peer.transport, peer: host.peer, timeline: host.timeline, artifacts: offer, remoteSdp: host.remoteSdp,
      gumCalledThisSession: key === 'B' || gumCalledBefore,
      hooks: { onStatus: (text) => { progress.onStatus(fmt(S.lab.selfTest.statusStep, { run: key, text })); } },
      now: deps.now,
      notes: runNotes(key, cameraError, gumCalledBefore),
    });
    return { run: { key, camera, report: result.report, abortReason: null, cameraError }, result };
  } catch (error) {
    return { run: { key, camera, report: null, abortReason: describeAbort(error), cameraError }, result: null };
  } finally {
    lobby.closeAll();
    join.close();
  }
}

/**
 * Fährt beide Läufe in fester Reihenfolge und wirft nie für erwartbare Fehlschläge (keine Kandidaten,
 * ICE scheitert, Kamera verweigert, ungültiger Code): die landen als Report bzw. `abortReason` im Ergebnis.
 */
export async function runSelfTest(device: string, deps: SelfTestDeps, progress: SelfTestProgress): Promise<SelfTestRun[]> {
  const gumCalledBefore = deps.gumCalled();

  progress.onStatus(S.lab.selfTest.statusRunA);
  const a = await runPair('A', 'aus', null, gumCalledBefore, device, deps, progress);
  progress.onRun(a.run, a.result);

  progress.onStatus(S.lab.selfTest.statusCamera);
  let camera: CameraHandle | null = null;
  let cameraError: string | null = null;
  try {
    camera = await deps.openCamera();
  } catch (error) {
    cameraError = errorName(error);
  }

  progress.onStatus(S.lab.selfTest.statusRunB);
  let b: Awaited<ReturnType<typeof runPair>>;
  try {
    b = await runPair('B', 'an', cameraError, true, device, deps, progress);
  } finally {
    // Der Stream bleibt während des ganzen Laufs B offen und wird erst danach beendet – auch bei einem Programmfehler.
    camera?.stop();
  }
  progress.onRun(b.run, b.result);
  progress.onStatus(S.lab.selfTest.statusDone);
  return [a.run, b.run];
}

// ───────── Ergebnistabelle ─────────

export interface SelfTestRow {
  key: SelfTestRunKey;
  state: 'valid' | 'invalid' | 'aborted';
  /** Ungültigkeits- bzw. Abbruchgrund, sonst leer. */
  reason: string;
  camera: string;
  valid: string;
  candidates: string;
  pair: string;
  ping: string;
  failures: string;
}

const decimal = (value: number): string => value.toFixed(1).replace('.', ',');

function cameraCell(run: SelfTestRun): string {
  if (run.cameraError !== null) return fmt(S.lab.selfTest.cameraDenied, { error: run.cameraError });
  return run.camera === 'an' ? S.lab.selfTest.cameraOn : S.lab.selfTest.cameraOff;
}

/** Rein: macht aus einem Lauf die Texte der Ergebnistabelle. */
export function summariseRun(run: SelfTestRun): SelfTestRow {
  const none = S.lab.selfTest.none;
  const { report } = run;
  if (report === null) {
    const reason = run.abortReason ?? '';
    return {
      key: run.key, state: 'aborted', reason, camera: cameraCell(run), valid: fmt(S.lab.selfTest.aborted, { reason }),
      candidates: none, pair: none, ping: none, failures: none,
    };
  }
  const summary = report.gather === null ? null : summariseCandidates(report.gather.gathered);
  const pair = report.selectedPair;
  const events = report.ping.events;
  const reason = report.valid ? '' : report.invalidReason ?? '';
  return {
    key: run.key,
    state: report.valid ? 'valid' : 'invalid',
    reason,
    camera: cameraCell(run),
    valid: report.valid ? S.lab.selfTest.valid : fmt(S.lab.selfTest.invalid, { reason }),
    candidates: summary === null ? none : `${summary.host} / ${summary.hostRealIp} / ${summary.mdns}`,
    pair: pair === null ? none : `${pair.localScope} → ${pair.remoteScope}`,
    ping: events === null ? none : fmt(S.lab.selfTest.pingValue, { median: decimal(events.medianMs), p95: decimal(events.p95Ms), loss: String(Math.round(events.lossPct)) }),
    failures: report.failures.length === 0 ? none : report.failures.join(', '),
  };
}

/**
 * Text für „Beide Reports kopieren" und „Teilen": anonymisiertes JSON. Abgebrochene Läufe haben keinen
 * Report – sie hängen als Klartextzeile an (Report-Daten für den Entwickler, keine Spiel-UI).
 */
export function selfTestShareText(runs: readonly SelfTestRun[]): string {
  const reports: LabReport[] = [];
  const aborted: string[] = [];
  for (const run of runs) {
    if (run.report !== null) reports.push(redactReport(run.report));
    else aborted.push(`Selbsttest Lauf ${run.key} (Kamera ${run.camera}) abgebrochen: ${run.abortReason ?? 'unbekannt'}`);
  }
  return [reportsToJson(reports), ...aborted].join('\n\n');
}
