import { createBroadcastTransport } from '../net/broadcastTransport';
import { candidatesFromSdp, parseCandidate, qrPassCriterion, type ParsedCandidate } from '../net/candidates';
import { HandshakeError, createClientJoin, createHostLobby, type ClientJoin, type ConnectorDeps, type HandshakeArtifacts, type HostLobby } from '../net/connector';
import { queryPermissions } from '../net/environment';
import { PROTOCOL_VERSION } from '../net/protocol';
import { CodecError, decodeDesc } from '../net/sdpCodec';
import type { RtcPeer } from '../net/rtcTransport';
import { createTimeline, type Timeline } from '../net/timeline';
import type { Transport, TransportState } from '../net/transport';
import { S, fmt } from '../ui/strings';
import { cameraStatus, observeTracks, openLobbyCamera } from './camera';
import { actionButton, card, codeArea, copyShareRow, h, showFailure, showMessage } from './labDom';
import { createRelayTimeline } from './labEvents';
import type { LabQuery } from './labQuery';
import { attachLabLink, finishRun, measureLockPings, type LabRunResult } from './labSession';
import type { TrackState } from './labTypes';
import { LOCK_SECONDS, armedTrackState, beginLockRun, finishLockRun, measuredLockPings, needsReconnect, type LockPings, type LockSeconds, type LockTestPlan, type LockTestRun } from './lockTest';
import { createExchangeMarks, measuredPairing, type PairingTracker } from './pairing';
import { createQrExchange, type QrExchange } from './qrPanels';
import { pingLine } from './reportsPanel';
import { ScanError } from './scannerAdapter';
import type { CellLabel, LabReport } from './report';

export interface ConnectContext {
  cell: CellLabel;
  query: LabQuery;
  /** Nach jedem gespeicherten Lauf – aktualisiert die Report-Liste. */
  onRun(result: LabRunResult): void;
}

/** Alles, was `finishRun` über eine Verbindung wissen muss. */
interface Link {
  transport: Transport;
  peer: RtcPeer | null;
  timeline: Timeline;
  artifacts: HandshakeArtifacts | null;
  remoteSdp: string | null;
  /**
   * QR-Pfad: Paarung und QR-Fakten ZUM ZEITPUNKT des Laufs. Eine Funktion statt zweier Felder, weil
   * der Platz nach dem Anlegen des Links weitermisst (Antwort-Scan, „verbunden"). Auf dem Text-Pfad
   * ist es `NO_QR_RUN`; ein vergessener Aufrufer fällt im Typecheck auf, weil das Feld PFLICHT ist.
   */
  qrRun(): Pick<LabReport, 'pairing' | 'qr'>;
}

const SLOTS = [1, 2, 3] as const;
const now = (): number => performance.now();
const NO_QR_RUN = (): Pick<LabReport, 'pairing' | 'qr'> => ({ pairing: null, qr: null });
const connectorDeps: ConnectorDeps = {
  protoV: PROTOCOL_VERSION,
  makeTimeline: () => createTimeline(now),
  randomNonce: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** HandshakeError → Fehlercode mit Titel und Hinweis; alles andere als Klartext-Meldung. */
function showError(target: HTMLElement, error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return; // vom Nutzer überholt (Platz freigegeben/neu belegt) – kein Befund
  if (error instanceof HandshakeError) showFailure(target, error.failure);
  else if (error instanceof CodecError) showFailure(target, 'F5');
  else showMessage(target, fmt(S.lab.run.unexpected, { message: describeError(error) }));
}

/** Ein abgebrochener Scan ist kein Befund – jemand hat ihn überholt (Text-Pfad, anderer Platz, Seitenwechsel). */
const isAbortedScan = (error: unknown): boolean => error instanceof ScanError && error.reason === 'aborted';

/**
 * Paarung und QR-Fakten für einen Lauf. Ohne einen einzigen gezeigten Code gibt es KEINE Paarung:
 * ein Bericht aus lauter Nullen behauptete sonst eine Messung, die nie stattgefunden hat.
 */
function qrRunOf(qrPath: boolean, marks: PairingTracker, facts: LabReport['qr']): Pick<LabReport, 'pairing' | 'qr'> {
  return qrPath ? { pairing: measuredPairing(marks.report()), qr: facts } : NO_QR_RUN();
}

/** D7: Ein gescannter Code zählt nur, wenn er sich als Mäusebau-Payload lesen lässt. */
async function looksLikePayload(text: string): Promise<boolean> {
  try {
    await decodeDesc(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * D10: „Host-Kandidaten: N echte IP, M mDNS" plus der Chip „QR-tauglich". Nennt nur Art und Anzahl,
 * nie eine Adresse. Steht am Platz, weil genau dort gesammelt wurde – den Kandidaten kennt sonst
 * niemand in der Oberfläche.
 */
function passChip(artifacts: HandshakeArtifacts): HTMLElement {
  const list: ParsedCandidate[] = [];
  for (const raw of candidatesFromSdp(artifacts.localSdp)) {
    const parsed = parseCandidate(raw);
    if (parsed !== null) list.push(parsed);
  }
  const criterion = qrPassCriterion(list);
  const wrap = h('div', 'lab-pass');
  wrap.dataset.testid = 'qr-pass';
  const chip = h('span', 'chip', criterion.pass ? S.lab.pass.ok : S.lab.pass.warn);
  chip.dataset.testid = 'qr-pass-chip';
  chip.dataset.state = criterion.pass ? 'ready' : 'pending';
  const counts = h('p', 'lab-line', fmt(S.lab.pass.counts, { realIp: String(criterion.realIp), mdns: String(criterion.mdns) }));
  counts.dataset.testid = 'qr-pass-counts';
  wrap.append(h('span', 'lab-label', S.lab.pass.title), chip, counts);
  return wrap;
}

interface RunBox {
  element: HTMLElement;
  /** Beobachtet den Transport: Zustands-Chip, Zeitleiste, Diagnose-Lauf bei 'failed', optional Lauf bei 'open'. */
  watch(link: Link, options: { runOnOpen: boolean; onState?: (state: TransportState) => void }): void;
  run(link: Link): Promise<void>;
  /** Wie `run`, aber nur, wenn dieser Link noch keinen Report hergegeben hat (Diagnose beim Freigeben). */
  runOnce(link: Link): Promise<void>;
  /** Platz freigegeben: meldet den `pagehide`-Zuhörer dieser Box wieder ab. */
  dispose(): void;
  setWaiting(text: string): void;
  /**
   * „Neu verbinden" nach dem Sperrtest: der Rückruf legt frische Codes an (Host: neues Angebot auf
   * DEMSELBEN Platz) und liefert die Platznummer für die Zeitleiste. Ohne Rückruf bleibt der Knopf weg.
   */
  setReconnect(handler: () => number | null): void;
  /**
   * Meldet, solange die Ping-Serie des Sperrtests läuft. Der Platz sperrt darüber „Ping-Test starten":
   * ein zweiter Lauf auf demselben Router mischte sich in die Messung, die gerade entscheidet, was den
   * Sperrbildschirm überlebt hat.
   */
  onLockBusy(listener: (busy: boolean) => void): void;
}

/**
 * Zustands-Chip + Statuszeile + Ping-Ergebnisse einer Verbindung.
 *
 * `autoReportLock` (nur der Client): speichert nach einer gemessenen Sperre von selbst einen Lauf.
 * Der Client hat keinen Knopf dafür – ohne das bliebe ausgerechnet der Normalfall „die Verbindung hat
 * gehalten" ungespeichert, denn von selbst speichert bei ihm nur der Verlust (`transport:failed`).
 * D9 und die Messtabelle wollen je GERÄT eine Zeile. Der Host behält seinen Knopf: „Ping-Test starten"
 * steht direkt neben dem Ergebnis, ein zweiter Lauf von selbst wäre dort nur Verwirrung.
 */
function createRunBox(ctx: ConnectContext, { autoReportLock = false }: { autoReportLock?: boolean } = {}): RunBox {
  const element = h('div', 'lab-run');
  const chip = h('span', 'chip', S.lab.state.offer);
  chip.dataset.testid = 'conn-state';
  chip.dataset.state = 'offer';
  const status = h('p', 'lab-line');
  status.dataset.testid = 'run-status';
  const pings = h('div', 'lab-pings');
  pings.dataset.testid = 'run-pings';

  // ───────── Sperrbildschirm-Test (M2, D9) ─────────
  const lock = h('div', 'lab-lock');
  lock.dataset.testid = 'lock-block';
  lock.hidden = true;
  const lockStatus = h('p', 'lab-line');
  lockStatus.dataset.testid = 'lock-status';
  const lockPhase = h('p', 'lab-line');
  lockPhase.dataset.testid = 'lock-phase';
  lockPhase.hidden = true;
  const lockResult = h('p', 'lab-line');
  lockResult.dataset.testid = 'lock-result';
  lockResult.hidden = true;
  const lockPings = h('div', 'lab-pings');
  lockPings.dataset.testid = 'lock-pings';
  const lockHint = h('p', 'lab-line', S.lab.lock.reconnectHint);
  lockHint.hidden = true;
  const reconnect = actionButton(S.lab.lock.reconnect, 'lock-reconnect', 'secondary');
  reconnect.hidden = true;
  const lockRow = h('div', 'shell-row');
  const lockButtons = LOCK_SECONDS.map((seconds) => {
    const button = actionButton(fmt(S.lab.lock.start, { seconds: String(seconds) }), `lock-${seconds}`);
    button.onclick = () => { armLock(seconds); };
    return button;
  });
  lockRow.append(...lockButtons, reconnect);
  lock.append(h('h4', 'lab-lock-title', S.lab.lock.title), h('p', 'lab-line', S.lab.lock.hint), lockRow, lockStatus, lockPhase, lockResult, lockPings, lockHint);

  element.append(chip, status, pings, lock);
  let running = false;
  /** Läufe dieses PLATZES: sie überleben ein „Neu verbinden" und stehen deshalb auch im Report der frischen Verbindung. */
  const lockRuns: LockTestRun[] = [];
  /** Gewählte Dauer, solange ein Lauf scharf ist. */
  let armed: LockSeconds | null = null;
  let plan: LockTestPlan | null = null;
  /** Von „verdeckt" bis zum fertigen Lauf (die Ping-Serie danach gehört dazu). */
  let lockMeasuring = false;
  /** „Neu verbinden" wurde WÄHREND der Messung getippt – die Marke gehört dem Lauf, der gerade entsteht. */
  let pendingReconnect = false;
  /** Ohne offene Kamera gibt es keine Spur, die verloren gehen könnte – 'live' heißt hier „kein Spur-Problem". */
  let trackState: TrackState = 'live';
  let stopTracks: (() => void) | null = null;
  let onReconnect: (() => number | null) | null = null;
  let onLockBusyChange: ((busy: boolean) => void) | null = null;
  let lockBound = false;
  /** Links, zu denen schon ein Report entstanden ist – „Platz freigeben" diagnostiziert nie doppelt. */
  const reported = new WeakSet<Link>();
  /** Der zuletzt beobachtete Link – Ziel des einen `pagehide`-Zuhörers dieser Box. */
  let watched: Link | null = null;
  let pagehideBound = false;
  const onPagehide = (): void => { watched?.transport.close(); };

  function showState(state: TransportState): void {
    chip.textContent = S.lab.state[state];
    chip.dataset.state = state === 'open' ? 'ready' : state === 'connecting' ? 'pending' : 'bad';
  }

  function setLockButtons(enabled: boolean): void {
    for (const button of lockButtons) button.disabled = !enabled;
  }

  /** Der `visibilitychange`-Zuhörer hängt nur, solange ein Lauf scharf ist – und nie zweimal. */
  function bindLock(bound: boolean): void {
    if (bound === lockBound) return;
    lockBound = bound;
    if (bound) document.addEventListener('visibilitychange', onVisibility);
    else document.removeEventListener('visibilitychange', onVisibility);
  }

  /**
   * Scharf machen. Solange noch nichts verdeckt war (`plan === null`), bleiben die drei Knöpfe frei:
   * wer sich vertippt hat, wählt einfach die andere Dauer, statt den Platz freigeben zu müssen. Erst
   * das tatsächliche Verdecken sperrt sie (siehe `onVisibility`).
   */
  function armLock(seconds: LockSeconds): void {
    if (watched === null || plan !== null) return;
    armed = seconds;
    lockResult.hidden = true;
    lockHint.hidden = true;
    lockPings.replaceChildren();
    // Die Spur JE LAUF neu beobachten: nach „Kamera neu starten" hängt der alte Beobachter an einer
    // toten Spur und `trackState` stünde für immer auf 'ended' – jeder weitere Lauf meldete dann
    // „Kamera ist weg", obwohl sie längst wieder läuft.
    stopTracks?.();
    trackState = armedTrackState(cameraStatus().running, trackState);
    stopTracks = observeTracks((state) => { trackState = state; });
    bindLock(true);
    lockStatus.textContent = fmt(S.lab.lock.instruction, { seconds: String(seconds) });
    lockPhase.textContent = S.lab.lock.waiting;
    lockPhase.hidden = false;
  }

  function showLockRun(run: LockTestRun): void {
    const lost = needsReconnect(run);
    lockResult.textContent = `${fmt(S.lab.lock.back, { ms: String(run.hiddenMs) })} ${lost ? S.lab.lock.resultLost : S.lab.lock.resultOk}`;
    lockResult.dataset.state = lost ? 'lost' : 'ok';
    lockResult.hidden = false;
    lockPings.replaceChildren(
      h('p', 'lab-line', pingLine('events', run.pingAfter?.events ?? null)),
      h('p', 'lab-line', pingLine('state', run.pingAfter?.state ?? null)),
    );
    lockHint.hidden = !lost || onReconnect === null;
  }

  /** Genau eine Messung je Knopfdruck: `hidden` nimmt den Start, `visible` den Rest. */
  function onVisibility(): void {
    const link = watched;
    if (link === null || armed === null) return;
    if (document.hidden) {
      if (plan !== null) return; // zweites hidden ohne visible dazwischen: der erste Start zählt
      plan = beginLockRun({ plannedSeconds: armed, transport: link.transport.state, track: trackState, now });
      // Ab hier läuft die Messung – jetzt erst sind die Dauer-Knöpfe gesperrt.
      lockMeasuring = true;
      setLockButtons(false);
      // `lock:start` gehört zur MESSUNG, nicht zum Knopfdruck: wer sich vertippt und die Dauer noch
      // einmal wechselt, hinterlässt sonst mehrere Starts für einen einzigen gemessenen Lauf.
      link.timeline.push('lock:start', `${armed}s`);
      link.timeline.push('lock:hidden');
      return;
    }
    const started = plan;
    if (started === null) return; // sichtbar geworden, ohne je verdeckt gewesen zu sein
    plan = null;
    armed = null;
    // Uhr auf den Zeitpunkt des Entsperrens EINFRIEREN: die Ping-Serie darunter dauert gut eine Sekunde
    // und dürfte die verdeckte Zeit nicht verlängern. `finishLockRun` rechnet daraus dieselbe Zahl.
    const visibleAtMs = now();
    // Zustand ZUM ZEITPUNKT des Entsperrens: war die Verbindung schon tot, misst die Serie gar nichts
    // mehr – dann gehört `null` in den Lauf und nicht eine Serie aus zwei leeren Kanälen.
    const openAtUnlock = link.transport.state === 'open';
    link.timeline.push('lock:visible', `${Math.max(0, Math.round(visibleAtMs - started.hiddenAtMs))}ms`);
    lockPhase.textContent = S.lab.lock.running;
    onLockBusyChange?.(true);
    void measureLockPings(link.transport, now)
      .catch((): LockPings => ({ state: null, events: null }))
      .then((pingAfter) => {
        // `reconnected` ist wahr, wenn der Knopf „Neu verbinden" während dieser Messung getippt wurde:
        // sie dauert mit ihrer Ping-Serie über eine Sekunde, und wer in dieser Zeit neu verbindet, tut
        // es wegen DIESES Laufs. Der Merker wird hier verbraucht.
        const finished = finishLockRun(started, {
          transport: link.transport.state,
          track: trackState,
          pingAfter: measuredLockPings(openAtUnlock, pingAfter),
          reconnected: pendingReconnect,
          now: () => visibleAtMs,
        });
        pendingReconnect = false;
        lockMeasuring = false;
        lockRuns.push(finished);
        showLockRun(finished);
        bindLock(false);
        setLockButtons(true);
        lockPhase.hidden = true;
        lockStatus.textContent = '';
        onLockBusyChange?.(false);
        // Der Client speichert die Messung selbst (siehe `autoReportLock`); ist die Verbindung nicht
        // mehr offen, hat `transport:failed` den Report längst geschrieben.
        if (autoReportLock && link.transport.state === 'open') void run(link);
      });
  }

  /**
   * Der Block erscheint mit der ersten offenen Verbindung und bleibt danach stehen: „Neu verbinden"
   * wird genau dann gebraucht, wenn die Verbindung weg ist. Die Spur wird hier NUR MITGELESEN –
   * `camera:track:*` schreibt allein die Kamera-Karte (labUi.ts, T3) in den Seiten-Ereignis-Puffer;
   * ein zweiter Schreiber ergäbe doppelte Zeitleisten-Einträge.
   */
  function revealLock(): void {
    if (!lock.hidden) return;
    lock.hidden = false;
    stopTracks = observeTracks((state) => { trackState = state; });
  }

  reconnect.onclick = () => {
    const link = watched;
    const handler = onReconnect;
    if (link === null || handler === null) return;
    const slot = handler();
    link.timeline.push('lock:reconnect', `slot ${slot === null ? '?' : slot}`);
    // Läuft die Messung noch, gehört die Marke dem Lauf, der gerade entsteht – NICHT dem vorherigen:
    // der hat die Sperre ja überlebt, und beim ersten Lauf gibt es gar keinen vorherigen, dem man sie
    // anhängen könnte. Ohne laufende Messung wird wie bisher der letzte fertige Lauf nachgetragen.
    if (lockMeasuring) pendingReconnect = true;
    else {
      const last = lockRuns[lockRuns.length - 1];
      if (last !== undefined) lockRuns[lockRuns.length - 1] = { ...last, reconnected: true };
    }
    lockHint.hidden = true;
  };

  async function run(link: Link): Promise<void> {
    if (running) return;
    running = true;
    pings.replaceChildren();
    const camera = cameraStatus();
    if (camera.error !== null) link.timeline.push('camera-error', camera.error);
    else if (camera.running) link.timeline.push('camera:running');
    // Erst JETZT abfragen: der Antwort-Scan und „verbunden" fallen nach dem Anlegen des Links an.
    const { pairing, qr } = link.qrRun();
    try {
      const result = await finishRun({
        cell: ctx.cell, transport: link.transport, peer: link.peer, timeline: link.timeline, artifacts: link.artifacts, remoteSdp: link.remoteSdp,
        gumCalledThisSession: camera.gumCalled, now, pairing, qr,
        // Die Sperrtest-Läufe gehören zum Platz: eine Kopie, damit ein späterer Lauf den Report nicht nachträglich ändert.
        lockTest: lockRuns.length === 0 ? null : { runs: [...lockRuns] },
        hooks: {
          onStatus: (text) => { status.textContent = text; },
          onPingProgress: (channel, stats) => { pings.append(h('p', 'lab-line', pingLine(channel, stats))); },
        },
      });
      // Erst merken, dann anzeigen: wirft die Anzeige, darf „Platz freigeben“ keinen zweiten Report speichern.
      reported.add(link);
      ctx.onRun(result);
    } catch (error) {
      status.textContent = fmt(S.lab.run.unexpected, { message: describeError(error) });
    } finally {
      running = false;
    }
  }

  return {
    element,
    run,
    runOnce: (link) => (reported.has(link) ? Promise.resolve() : run(link)),
    dispose() {
      removeEventListener('pagehide', onPagehide);
      pagehideBound = false;
      watched = null;
      // Der Platz verschwindet – weder der Sperrtest noch die Spur-Beobachtung dürfen ihn überleben.
      bindLock(false);
      stopTracks?.();
      stopTracks = null;
    },
    setWaiting(text) {
      chip.textContent = text;
      chip.dataset.state = 'pending';
    },
    setReconnect(handler) {
      onReconnect = handler;
      reconnect.hidden = false;
    },
    onLockBusy(listener) {
      onLockBusyChange = listener;
    },
    watch(link, options) {
      // Ab jetzt beantwortet diese Seite Pings und merkt sich das Hello der Gegenstelle.
      attachLabLink(link.transport);
      // Ein Tab-Neuladen sendet sonst kein 'bye' – die Gegenstelle stünde im BroadcastChannel-Modus
      // für immer auf „verbunden". Für WebRTC schließt das nur die PeerConnection früher, was gewollt ist.
      // GENAU EIN Zuhörer je Box: `watched` zeigt immer auf den aktuellen Link, damit ein zweiter
      // Versuch (neues Angebot) keinen weiteren Listener anhäuft, der auf einen toten Link zeigt.
      watched = link;
      // Nach „Neu verbinden" ist die frische Verbindung sofort offen genug für den nächsten Sperrtest.
      if (link.transport.state === 'open') revealLock();
      if (!pagehideBound) {
        pagehideBound = true;
        addEventListener('pagehide', onPagehide, { once: true });
      }
      link.transport.onStateChange = (state) => {
        link.timeline.push(`transport:${state}`);
        showState(state);
        if (state === 'open') revealLock();
        options.onState?.(state);
        // Ein Fehlschlag ist der wertvollste Report: sofort mit Diagnose speichern.
        if (state === 'failed' || (state === 'open' && options.runOnOpen)) void run(link);
      };
    },
  };
}

/** Ein Code-Feld mit seinen Knöpfen; zwei Blöcke stehen im Querformat nebeneinander. */
function codeBlock(...children: HTMLElement[]): HTMLElement {
  const block = h('div', 'lab-code-block');
  block.append(...children);
  return block;
}

function buildHostSlot(ctx: ConnectContext, slot: number, lobby: HostLobby, onRelease: () => void): HTMLElement {
  const broadcast = ctx.query.transport === 'broadcast';
  const qrPath = ctx.cell.path === 'qr';
  const element = h('article', 'lab-slot');
  element.dataset.testid = `slot-${slot}`;
  const box = createRunBox(ctx);
  const alert = h('p', 'lab-alert');
  alert.setAttribute('role', 'alert');
  alert.hidden = true;
  const codes = h('div', 'lab-codes');
  const offer = codeArea(S.lab.host.offerLabel, 'offer-out', true);
  const answer = codeArea(S.lab.host.answerLabel, 'answer-in', false);
  const connect = actionButton(S.lab.host.connect, 'connect', 'accent');
  const startPing = actionButton(S.lab.host.startPing, 'start-ping', 'accent');
  startPing.disabled = true;
  const release = actionButton(S.lab.host.release, 'release', 'secondary');
  const actions = h('div', 'shell-row');
  actions.append(startPing, release);
  // Der QR-Block bekommt seinen Platz sofort, seinen Inhalt aber erst mit der Zeitleiste des Platzes.
  const qrMount = codeBlock();
  qrMount.hidden = !qrPath;
  const rescan = actionButton(S.lab.qr.scanRetry, 'qr-retry', 'accent');
  rescan.hidden = true;
  // Der Text-Code bleibt der Rückfallweg (D7): ein Knopf dafür, statt nur ein Hinweis – wer den Scan
  // aufgibt, soll ihn beenden können, ohne zu raten, wohin er tippen muss.
  const toText = actionButton(S.lab.qr.fallbackText, 'qr-to-text', 'secondary');
  const qrActions = h('div', 'qr-actions');
  qrActions.append(rescan, toText);
  // Ohne laufende Kamera scannt nichts – dann soll der Block das auch sagen, statt stumm dazustehen.
  const noCamera = h('p', 'lab-line', S.lab.qr.noCamera);
  noCamera.dataset.testid = 'qr-no-camera';
  noCamera.hidden = true;
  // Fester Container für den Pass-Chip: GENAU EINER je Platz. Ein zweites Angebot (Task 5,
  // „Neu verbinden") ersetzt ihn per `replaceChildren`, statt einen weiteren daneben zu hängen.
  const pass = h('div', 'lab-pass-mount');
  codes.append(
    qrMount,
    codeBlock(offer.wrap, copyShareRow(() => offer.area.value, 'offer', S.lab.share.codeTitle, () => { offer.area.select(); })),
    codeBlock(answer.wrap, connect),
  );
  codes.hidden = true;
  element.append(h('h3', 'lab-slot-title', fmt(S.lab.host.slot, { slot: String(slot) })), box.element, pass, codes, alert, actions);

  let link: Link | null = null;
  let qr: QrExchange | null = null;
  let qrFacts: LabReport['qr'] = null;
  /** Der Nutzer hat den Scan SELBST beendet (Text-Pfad) – nur dann bleibt „Erneut scannen" verborgen. */
  let userLeftScan = false;
  /** Der Platz ist freigegeben: ein noch laufendes `createOffer` darf ihn nicht wiederbeleben. */
  let released = false;
  /** Genau EIN `qr:fallback-text` je AUSTAUSCH, über welchen der beiden Wege auch ausgewichen wurde (ein frisches Angebot beginnt einen neuen). */
  let fellBackToText = false;
  // Immer angelegt, nur auf dem QR-Pfad gelesen: so braucht keine Stelle eine Nicht-null-Behauptung.
  const marks = createExchangeMarks(now);
  const qrRun = (): Pick<LabReport, 'pairing' | 'qr'> => qrRunOf(qrPath, marks, qrFacts);
  // Der Ping-Test ist schon im Zustand „verbindet …" erreichbar: Eine Verbindung, die nie aufgeht, ist
  // der wertvollste Report (F7/F3). `finishRun` kommt ohne offene Verbindung zurecht und sagt es in der
  // Statuszeile; ohne diesen Weg bliebe die Diagnose in der Zwei-Geräte-Oberfläche unerreichbar.
  const canRun = (state: TransportState | undefined): boolean => state === 'open' || state === 'connecting';
  /** Solange die Ping-Serie des Sperrtests läuft, bleibt „Ping-Test starten" zu – zwei Serien auf einem Router messen einander. */
  let lockBusy = false;
  const syncPing = (state: TransportState): void => {
    startPing.disabled = lockBusy || !canRun(state);
    if (state === 'open') {
      codes.hidden = true;
      marks.mark('connectedMs');
    }
  };
  box.onLockBusy((busy) => {
    lockBusy = busy;
    startPing.disabled = lockBusy || !canRun(link?.transport.state);
  });
  const watch = (next: Link): void => {
    link = next;
    // Der Zustand VOR dem ersten Wechsel zählt mit – `onStateChange` feuert erst beim nächsten.
    syncPing(next.transport.state);
    box.watch(next, { runOnOpen: false, onState: syncPing });
  };
  startPing.onclick = () => {
    if (link === null) return;
    startPing.disabled = true;
    void box.run(link).then(() => { startPing.disabled = lockBusy || !canRun(link?.transport.state); });
  };
  release.onclick = () => {
    const current = link;
    const close = (): void => {
      // Der Platz verschwindet – sein `pagehide`-Zuhörer und sein Scan dürfen ihn nicht überleben.
      released = true;
      qr?.dispose();
      box.dispose();
      if (broadcast) current?.transport.close();
      else lobby.closeSlot(slot);
      onRelease();
    };
    // Ein Platz, der gerade nicht offen ist (nie geöffnet oder schon geschlossen), gibt seine Diagnose
    // noch vor dem Schließen her – aber nur einmal je Verbindung.
    if (current === null || current.transport.state === 'open') { close(); return; }
    release.disabled = true;
    void box.runOnce(current).finally(close);
  };

  if (broadcast) {
    box.setWaiting(S.lab.state.connecting);
    watch({ transport: createBroadcastTransport({ room: ctx.query.room, selfId: 'host', peerId: `client-${slot}` }), peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null, qrRun: NO_QR_RUN });
  } else {
    /** Antwort annehmen – aus dem Text-Feld ODER aus dem Scan; beide Wege laufen durch dasselbe `acceptAnswer`. */
    const acceptAnswer = (payload: string): void => {
      if (link === null) return;
      alert.hidden = true;
      // Ein zweiter Tipp während des Annehmens fände den Platz schon beantwortet vor und stellte ein
      // rotes F5 neben das grüne „verbunden" – wie bei „Antwort erzeugen" sperrt der Knopf sich selbst.
      connect.disabled = true;
      const current = link;
      void lobby.acceptAnswer(slot, payload).then(() => {
        current.remoteSdp = lobby.entries().get(slot)?.remoteSdp ?? null;
        if (current.transport.state === 'connecting') box.setWaiting(S.lab.state.connecting);
      }, (error: unknown) => {
        showError(alert, error);
        // NUR der Fehlschlag gibt den Knopf für den nächsten Versuch frei. Nach einer angenommenen
        // Antwort gibt es nichts mehr zu verbinden: bei 'open' verschwindet das Code-Feld ohnehin, und
        // ein zweiter Tipp fände den Platz beantwortet vor – rotes F5 neben dem grünen „verbunden".
        connect.disabled = false;
        // Eine abgelehnte Antwort nach einem gelungenen Scan (fremder Code, falscher Platz) darf keine
        // Sackgasse sein: der Scan ist vorbei, also muss der zweite Versuch wieder angeboten werden.
        if (qr !== null) rescan.hidden = false;
      });
    };
    const scanAnswer = (): void => {
      rescan.hidden = true;
      noCamera.hidden = true;
      userLeftScan = false;
      void qr?.scan('answer').then((text) => {
        answer.area.value = text;
        acceptAnswer(text);
      }, (error: unknown) => {
        // Text und `qr:error` hat der QR-Block schon geschrieben; hier bleibt nur der zweite Versuch.
        // Auch ein ÜBERHOLTER Scan (anderer Platz, Seitenwechsel) endet als Abbruch – nur wer selbst
        // auf den Text-Pfad gewechselt ist, braucht keinen Knopf mehr: er ist ja schon dort.
        if (isAbortedScan(error) && userLeftScan) return;
        rescan.hidden = false;
      });
    };
    rescan.onclick = scanAnswer;
    /** Auf den Text-Pfad ausweichen: Scan beenden und EINMAL vermerken (D12: `cell.path` bleibt 'qr'). */
    const fallBackToText = (focusArea: boolean): void => {
      if (qr === null) return;
      userLeftScan = true;
      qr.cancel();
      // „Erneut scannen" BLEIBT stehen: `userLeftScan` sperrt nur den AUTOMATISCHEN Start. Wer von Hand
      // tippt, will zurück zum Scan – ohne den Knopf gäbe es für diesen Schritt keinen Weg dorthin.
      // `qr-no-camera` bleibt dagegen unangetastet: am Kamera-Zustand hat sich nichts geändert, und
      // eine Zeile, die den Grund nennt, verschwindet nicht, weil man auf Text ausgewichen ist.
      rescan.hidden = false;
      if (!fellBackToText) {
        fellBackToText = true;
        link?.timeline.push('qr:fallback-text', 'answer');
      }
      if (focusArea) answer.area.focus();
    };
    toText.onclick = () => { fallBackToText(true); };
    /**
     * Ein frisches Angebot auf DIESEM Platz. Beim ersten Aufruf der Normalfall, nach „Neu verbinden"
     * (Sperrtest, D9) der Neustart: `lobby.createOffer` schließt den alten Peer und legt einen neuen an –
     * gleiche Zelle, gleicher Platz. Die Oberfläche muss dafür in den Ausgangszustand zurück.
     */
    const makeOffer = (): void => {
      alert.hidden = true;
      codes.hidden = true;
      // Beide Felder leeren: der alte Angebots-Code ist mit dem alten Peer tot – niemand darf ihn noch
      // abschreiben oder scannen, während das frische Angebot entsteht.
      offer.area.value = '';
      answer.area.value = '';
      connect.disabled = false;
      // Der alte QR-Block gehört zum toten Peer: Scan abbrechen, Overlay abmelden, Fläche leeren.
      qr?.dispose();
      qr = null;
      qrMount.replaceChildren();
      rescan.hidden = true;
      noCamera.hidden = true;
      // Ein frisches Angebot ist ein NEUER Austausch – der Rückfall auf Text galt dem alten. Ohne das
      // Zurücksetzen bliebe der QR-Pfad dieses Platzes nach „Neu verbinden" für immer stumm (das Tor
      // unten sähe `userLeftScan`), und der neue Austausch könnte seinen eigenen Ausweg nicht mehr
      // vermerken. Wer danach erneut auf Text wechselt, setzt beides ohnehin wieder.
      userLeftScan = false;
      fellBackToText = false;
      // … und er misst seine Paarung selbst: Marken rasten je Name ein, und die QR-Fakten gehören dem
      // alten Block. Ohne beides trüge der Report der frischen Verbindung die Zeiten des toten Peers.
      marks.renew();
      qrFacts = null;
      box.setWaiting(S.lab.host.creating);
      // Das Design verlangt Berechtigungsstatus und „getUserMedia in dieser Sitzung" ZUM ZEITPUNKT von createOffer –
      // nicht erst nach dem Handshake. Beides trägt keine Adresse und landet als Zeitleisten-Eintrag im Report.
      const gumAtOffer = cameraStatus().gumCalled; const permissionsAtOffer = queryPermissions();
      void lobby.createOffer(slot).then((artifacts) => {
        // „Platz freigeben" während des Gatherings: der Eintrag unter dieser Nummer gehört dann schon
        // einem NEUEN Platz. Ohne diesen Riegel hängte der alte Lauf ihm einen zweiten QR-Block an,
        // der jeden Scan des echten Platzes überholte.
        if (released) return;
        const entry = lobby.entries().get(slot);
        if (entry === undefined) return;
        // Zeitleisten-Detail = Report-DATEN für den Entwickler-Rückkanal (wie in src/lab/report.ts), keine Spiel-UI.
        void permissionsAtOffer.then((p) => { entry.timeline.push('permissions:handshake', `camera=${p.camera} gum=${gumAtOffer ? 'ja' : 'nein'} lna=${p.localNetwork}`); });
        offer.area.value = artifacts.payload;
        codes.hidden = false;
        box.setWaiting(S.lab.state.offer);
        // Genau EIN Pass-Chip je Platz: ein zweites Angebot ersetzt ihn, es hängt sich keiner an.
        pass.replaceChildren(passChip(artifacts));
        watch({ transport: entry.peer.transport, peer: entry.peer, timeline: entry.timeline, artifacts, remoteSdp: null, qrRun });
        if (qrPath) {
          qr = createQrExchange({ timeline: entry.timeline, marks, looksLikePayload, onQrFacts: (facts) => { qrFacts = facts; } });
          qrMount.append(qr.element, qrActions, noCamera);
          qr.show('offer', artifacts.payload);
          // C4: der Scan startet von selbst – aber ERST mit laufender Kamera. Die Karte öffnet den Stream
          // im selben Tick; ohne dieses Warten fände `attachCamera` keinen, der Block meldete einen
          // Kamera-Fehler und der Lauf trüge ein falsches F9. `openLobbyCamera` ist dabei kein zweiter
          // Zugriff: es liefert den laufenden Stream bzw. die schon laufende Anforderung.
          void openLobbyCamera().then((camera) => {
            // Der Nutzer kann in der Zwischenzeit selbst gehandelt haben (Antwort eingefügt, auf den
            // Text-Pfad gewechselt) oder den Platz freigegeben haben – dann darf hier KEIN Scan mehr
            // anspringen: er überholte die schon laufende Annahme und fräße die Kamera des Nachbarn.
            if (userLeftScan || released) return;
            // Ohne Kamera gibt es nichts zu scannen: der Block sagt es, die Karte nennt den Grund.
            if (camera.running) scanAnswer();
            else {
              noCamera.hidden = false;
              rescan.hidden = false;
            }
          });
        }
      }, (error: unknown) => { if (!released) showError(alert, error); });
    };
    makeOffer();
    box.setReconnect(() => { makeOffer(); return slot; });
    connect.onclick = () => {
      if (answer.area.value.trim() === '') { showMessage(alert, S.lab.run.emptyCode); return; }
      // Von Hand eingefügt = für DIESEN Schritt auf den Text-Pfad ausgewichen. Das Zellenlabel bleibt
      // 'qr' (D12, sonst wäre die Zellen-Matrix nicht mehr vergleichbar) – der Ausweg steht als
      // `qr:fallback-text` in der Zeitleiste und damit im Report.
      fallBackToText(false);
      acceptAnswer(answer.area.value);
    };
  }
  return element;
}

/** Schritt 3 (Host): bis zu drei Plätze; verbundene Plätze laufen weiter, während ein neuer hinzukommt. */
export function buildHostPanel(ctx: ConnectContext): HTMLElement {
  const element = card(S.lab.host.title, 'host-card');
  const lobby = createHostLobby(connectorDeps);
  const slots = new Set<number>();
  const add = actionButton(S.lab.host.add, 'add-player');
  const full = h('p', 'lab-line', S.lab.host.full);
  full.hidden = true;
  const list = h('div', 'lab-slots');
  element.append(add, full, list);

  function addSlot(slot: number): void {
    const slotElement = buildHostSlot(ctx, slot, lobby, () => {
      slotElement.remove();
      slots.delete(slot);
      add.disabled = false;
      full.hidden = true;
    });
    slots.add(slot);
    list.append(slotElement);
    const isFull = slots.size === SLOTS.length;
    add.disabled = isFull;
    full.hidden = !isFull;
  }
  add.onclick = () => {
    const free = SLOTS.find((slot) => !slots.has(slot));
    if (free !== undefined) addSlot(free);
  };
  // Testmodus: der Platz aus der URL verbindet sich ohne weiteren Tipper.
  if (ctx.query.transport === 'broadcast') addSlot(ctx.query.slot);
  return element;
}

/** Schritt 3 (Client): Angebot einfügen → Antwort zurückgeben → bei offener Verbindung misst der Lauf von selbst. */
export function buildClientPanel(ctx: ConnectContext): HTMLElement {
  const element = card(S.lab.client.title, 'client-card');
  // Nur hier: ein gemessener Sperrtest speichert seinen Lauf selbst (siehe `createRunBox`).
  const box = createRunBox(ctx, { autoReportLock: true });
  const qrPath = ctx.cell.path === 'qr';
  // Immer angelegt, nur auf dem QR-Pfad gelesen: so braucht keine Stelle eine Nicht-null-Behauptung.
  const marks = createExchangeMarks(now);
  let qrFacts: LabReport['qr'] = null;
  /** Der Nutzer hat den Scan SELBST beendet (Text-Pfad) – nur dann bleibt „Erneut scannen" verborgen. */
  let userLeftScan = false;
  /** Genau EIN `qr:fallback-text` je AUSTAUSCH, über welchen der beiden Wege auch ausgewichen wurde („Neu verbinden" beginnt einen neuen). */
  let fellBackToText = false;
  const qrRun = (): Pick<LabReport, 'pairing' | 'qr'> => qrRunOf(qrPath, marks, qrFacts);
  if (ctx.query.transport === 'broadcast') {
    box.setWaiting(S.lab.state.connecting);
    box.watch(
      { transport: createBroadcastTransport({ room: ctx.query.room, selfId: `client-${ctx.query.slot}`, peerId: 'host' }), peer: null, timeline: createTimeline(now), artifacts: null, remoteSdp: null, qrRun: NO_QR_RUN },
      { runOnOpen: true },
    );
    element.append(box.element);
    return element;
  }

  const alert = h('p', 'lab-alert');
  alert.setAttribute('role', 'alert');
  alert.hidden = true;
  const offer = codeArea(S.lab.client.offerLabel, 'offer-in', false);
  const makeAnswer = actionButton(S.lab.client.makeAnswer, 'make-answer', 'accent');
  const answer = codeArea(S.lab.client.answerLabel, 'answer-out', true);
  const answerBlock = codeBlock(answer.wrap, copyShareRow(() => answer.area.value, 'answer', S.lab.share.codeTitle, () => { answer.area.select(); }), h('p', 'lab-line', S.lab.client.waiting));
  answerBlock.hidden = true;
  const codes = h('div', 'lab-codes');
  const qrMount = codeBlock();
  qrMount.hidden = !qrPath;
  const rescan = actionButton(S.lab.qr.scanRetry, 'qr-retry', 'accent');
  rescan.hidden = true;
  // Wie am Host: der Text-Code bleibt der Rückfallweg und bekommt dafür einen eigenen Knopf (D7).
  const toText = actionButton(S.lab.qr.fallbackText, 'qr-to-text', 'secondary');
  const qrActions = h('div', 'qr-actions');
  qrActions.append(rescan, toText);
  // Wie am Host: ohne laufende Kamera sagt der Block, warum nichts passiert.
  const noCamera = h('p', 'lab-line', S.lab.qr.noCamera);
  noCamera.dataset.testid = 'qr-no-camera';
  noCamera.hidden = true;
  // Fester Container für den Pass-Chip (wie am Host): genau einer, auch nach „Neu verbinden" (Task 5).
  const pass = h('div', 'lab-pass-mount');
  codes.append(qrMount, codeBlock(offer.wrap, makeAnswer), answerBlock);
  box.element.hidden = true;
  element.append(codes, pass, alert, box.element);

  // Der Angebots-Scan läuft, bevor `acceptOffer` die Zeitleiste anlegt – bis dahin puffert der Relais-Kanal
  // aus labEvents.ts (T3): derselbe Ort wie die Seiten-Ereignisse, eine Regel statt zweier Mechaniken.
  const relay = createRelayTimeline(now);
  const qr: QrExchange | null = qrPath
    ? createQrExchange({ timeline: relay.timeline, marks, looksLikePayload, onQrFacts: (facts) => { qrFacts = facts; } })
    : null;
  if (qr !== null) qrMount.append(qr.element, qrActions, noCamera);

  let join: ClientJoin | null = null;
  /** Angebot annehmen – aus dem Text-Feld ODER aus dem Scan; beide Wege laufen hier zusammen. */
  const acceptOffer = (payload: string): void => {
    alert.hidden = true;
    makeAnswer.disabled = true;
    makeAnswer.textContent = S.lab.client.creating;
    join?.close();
    const current = createClientJoin(connectorDeps);
    join = current;
    // Wie auf der Host-Seite: Kamera-Status und Berechtigungen zum Zeitpunkt des Handshakes festhalten.
    const gumAtOffer = cameraStatus().gumCalled; const permissionsAtOffer = queryPermissions();
    void current.acceptOffer(payload).then((artifacts) => {
      const { peer, timeline } = current;
      if (peer === null || timeline === null) return;
      // Jetzt erst gibt es die Zeitleiste des Laufs: die gepufferten QR-Einträge wandern hinein.
      relay.drainInto(timeline);
      // Zeitleisten-Detail = Report-DATEN für den Entwickler-Rückkanal (wie in src/lab/report.ts), keine Spiel-UI.
      void permissionsAtOffer.then((p) => { timeline.push('permissions:handshake', `camera=${p.camera} gum=${gumAtOffer ? 'ja' : 'nein'} lna=${p.localNetwork}`); });
      answer.area.value = artifacts.payload;
      answerBlock.hidden = false;
      box.element.hidden = false;
      box.setWaiting(S.lab.state.connecting);
      pass.replaceChildren(passChip(artifacts));
      qr?.show('answer', artifacts.payload);
      box.watch({ transport: peer.transport, peer, timeline, artifacts, remoteSdp: current.remoteSdp, qrRun }, {
        runOnOpen: true,
        // Verbunden: Codes ausblenden. Fehlgeschlagen/getrennt: das Angebotsfeld für einen neuen Versuch wieder zeigen.
        onState: (state) => {
          codes.hidden = state === 'open';
          if (state === 'open') marks.mark('connectedMs');
          if (state !== 'connecting') answerBlock.hidden = true;
        },
      });
    }, (error: unknown) => {
      showError(alert, error);
      // Ein abgelehntes Angebot nach einem gelungenen Scan (fremder Code, abgelaufenes Angebot) darf
      // keine Sackgasse sein: der Scan ist vorbei, also den zweiten Versuch wieder anbieten.
      if (qr !== null) rescan.hidden = false;
    }).finally(() => {
      makeAnswer.disabled = false;
      makeAnswer.textContent = S.lab.client.makeAnswer;
    });
  };
  /** Auf den Text-Pfad ausweichen: Scan beenden und EINMAL vermerken (D12: `cell.path` bleibt 'qr'). */
  const fallBackToText = (focusArea: boolean): void => {
    if (qr === null) return;
    userLeftScan = true;
    qr.cancel();
    // Wie am Host: der Knopf bleibt: `userLeftScan` sperrt allein den AUTOMATISCHEN Start, nicht den
    // ausdrücklichen Wunsch, wieder zu scannen. `qr-no-camera` bleibt stehen – der Kamera-Zustand
    // hat sich durch den Wechsel nicht geändert.
    rescan.hidden = false;
    if (!fellBackToText) {
      fellBackToText = true;
      relay.timeline.push('qr:fallback-text', 'offer');
    }
    if (focusArea) offer.area.focus();
  };
  toText.onclick = () => { fallBackToText(true); };
  makeAnswer.onclick = () => {
    if (offer.area.value.trim() === '') { showMessage(alert, S.lab.run.emptyCode); return; }
    // Von Hand eingefügt = für DIESEN Schritt auf den Text-Pfad ausgewichen (D12: cell.path bleibt 'qr').
    fallBackToText(false);
    acceptOffer(offer.area.value);
  };
  /** Von Hand angestoßener Scan („Erneut scannen") – ein ausdrücklicher Wunsch hebt den Text-Pfad auf. */
  const scanOffer = (): void => {
    if (qr === null) return;
    rescan.hidden = true;
    noCamera.hidden = true;
    userLeftScan = false;
    void qr.scan('offer').then((text) => {
      offer.area.value = text;
      acceptOffer(text);
    }, (error: unknown) => {
      // Nur der selbst gewählte Weg auf den Text-Pfad kommt ohne „Erneut scannen" aus; ein von einem
      // anderen Platz oder vom Seitenwechsel überholter Scan braucht den Knopf.
      if (isAbortedScan(error) && userLeftScan) return;
      rescan.hidden = false;
    });
  };
  /**
   * AUTOMATISCHER Start (C4): erst mit laufender Kamera und nur, solange niemand von Hand auf den
   * Text-Pfad gewechselt ist. Ein von Hand getippter „Erneut scannen" geht an diesem Tor vorbei –
   * das Tor schützt nur davor, dem Nutzer ungefragt in einen laufenden Schritt zu fahren.
   */
  const autoScanOffer = (): void => {
    if (qr === null) return;
    void openLobbyCamera().then((camera) => {
      // War der Nutzer schneller (Code eingefügt, auf Text gewechselt), startet nichts mehr: ein
      // zweiter `acceptOffer` schlösse die gerade entstehende Verbindung wieder (F5/F3-Sackgasse).
      if (userLeftScan) return;
      if (camera.running) scanOffer();
      else {
        noCamera.hidden = false;
        rescan.hidden = false;
      }
    });
  };
  if (qr !== null) {
    rescan.onclick = scanOffer;
    autoScanOffer();
  }
  // „Neu verbinden" (Sperrtest, D9): der Host legt den frischen Code an, hier wird nur wieder Platz dafür
  // gemacht. Der Platz der bisherigen Verbindung geht als Zeitleisten-Detail mit.
  box.setReconnect(() => {
    const slot = join?.slot ?? null;
    codes.hidden = false;
    answerBlock.hidden = true;
    offer.area.value = '';
    answer.area.value = '';
    makeAnswer.disabled = false;
    // Ein „Neu verbinden" ist ein NEUER Austausch – der Rückfall auf Text galt dem alten Schritt.
    // Ohne dieses Zurücksetzen bliebe der QR-Pfad für den Rest der Sitzung stumm.
    userLeftScan = false;
    fellBackToText = false;
    // … der seine Paarung selbst misst: Marken rasten je Name ein, die QR-Fakten gehören dem alten
    // Austausch. Der QR-Block bleibt derselbe – er schreibt in die JEWEILS aktuelle Buchführung.
    marks.renew();
    qrFacts = null;
    // … und sein Report zeigt, wie ER gelaufen ist: die `qr:error`s des toten Austauschs wandern nicht
    // in die Zeitleiste der frischen Verbindung (ein F9 von einem Peer, den es nicht mehr gibt).
    relay.reset();
    // ERST danach `clear()`: die gezeigte Antwort gehört dem toten Peer (niemand darf sie noch scannen
    // oder abschreiben), und die Zeilen, die der Block dabei schreibt, gehören in den FRISCHEN Puffer.
    qr?.clear();
    autoScanOffer();
    return slot;
  });
  return element;
}
