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
import { cameraStatus, openLobbyCamera } from './camera';
import { actionButton, card, codeArea, copyShareRow, h, showFailure, showMessage } from './labDom';
import { createRelayTimeline } from './labEvents';
import type { LabQuery } from './labQuery';
import { attachLabLink, finishRun, type LabRunResult } from './labSession';
import { createPairingTracker, measuredPairing, type PairingTracker } from './pairing';
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
}

/** Zustands-Chip + Statuszeile + Ping-Ergebnisse einer Verbindung. */
function createRunBox(ctx: ConnectContext): RunBox {
  const element = h('div', 'lab-run');
  const chip = h('span', 'chip', S.lab.state.offer);
  chip.dataset.testid = 'conn-state';
  chip.dataset.state = 'offer';
  const status = h('p', 'lab-line');
  status.dataset.testid = 'run-status';
  const pings = h('div', 'lab-pings');
  pings.dataset.testid = 'run-pings';
  element.append(chip, status, pings);
  let running = false;
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
    },
    setWaiting(text) {
      chip.textContent = text;
      chip.dataset.state = 'pending';
    },
    watch(link, options) {
      // Ab jetzt beantwortet diese Seite Pings und merkt sich das Hello der Gegenstelle.
      attachLabLink(link.transport);
      // Ein Tab-Neuladen sendet sonst kein 'bye' – die Gegenstelle stünde im BroadcastChannel-Modus
      // für immer auf „verbunden". Für WebRTC schließt das nur die PeerConnection früher, was gewollt ist.
      // GENAU EIN Zuhörer je Box: `watched` zeigt immer auf den aktuellen Link, damit ein zweiter
      // Versuch (neues Angebot) keinen weiteren Listener anhäuft, der auf einen toten Link zeigt.
      watched = link;
      if (!pagehideBound) {
        pagehideBound = true;
        addEventListener('pagehide', onPagehide, { once: true });
      }
      link.transport.onStateChange = (state) => {
        link.timeline.push(`transport:${state}`);
        showState(state);
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
  /** Genau EIN `qr:fallback-text` je Platz, über welchen der beiden Wege auch ausgewichen wurde. */
  let fellBackToText = false;
  // Immer angelegt, nur auf dem QR-Pfad gelesen: so braucht keine Stelle eine Nicht-null-Behauptung.
  const marks = createPairingTracker(now);
  const qrRun = (): Pick<LabReport, 'pairing' | 'qr'> => qrRunOf(qrPath, marks, qrFacts);
  // Der Ping-Test ist schon im Zustand „verbindet …" erreichbar: Eine Verbindung, die nie aufgeht, ist
  // der wertvollste Report (F7/F3). `finishRun` kommt ohne offene Verbindung zurecht und sagt es in der
  // Statuszeile; ohne diesen Weg bliebe die Diagnose in der Zwei-Geräte-Oberfläche unerreichbar.
  const canRun = (state: TransportState | undefined): boolean => state === 'open' || state === 'connecting';
  const syncPing = (state: TransportState): void => {
    startPing.disabled = !canRun(state);
    if (state === 'open') {
      codes.hidden = true;
      marks.mark('connectedMs');
    }
  };
  const watch = (next: Link): void => {
    link = next;
    // Der Zustand VOR dem ersten Wechsel zählt mit – `onStateChange` feuert erst beim nächsten.
    syncPing(next.transport.state);
    box.watch(next, { runOnOpen: false, onState: syncPing });
  };
  startPing.onclick = () => {
    if (link === null) return;
    startPing.disabled = true;
    void box.run(link).then(() => { startPing.disabled = !canRun(link?.transport.state); });
  };
  release.onclick = () => {
    const current = link;
    const close = (): void => {
      // Der Platz verschwindet – sein `pagehide`-Zuhörer und sein Scan dürfen ihn nicht überleben.
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
    box.setWaiting(S.lab.host.creating);
    // Das Design verlangt Berechtigungsstatus und „getUserMedia in dieser Sitzung" ZUM ZEITPUNKT von createOffer –
    // nicht erst nach dem Handshake. Beides trägt keine Adresse und landet als Zeitleisten-Eintrag im Report.
    const gumAtOffer = cameraStatus().gumCalled; const permissionsAtOffer = queryPermissions();
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
      rescan.hidden = true;
      if (!fellBackToText) {
        fellBackToText = true;
        link?.timeline.push('qr:fallback-text', 'answer');
      }
      if (focusArea) answer.area.focus();
    };
    toText.onclick = () => { fallBackToText(true); };
    void lobby.createOffer(slot).then((artifacts) => {
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
        qrMount.append(qr.element, qrActions);
        qr.show('offer', artifacts.payload);
        // C4: der Scan startet von selbst – aber ERST mit laufender Kamera. Die Karte öffnet den Stream
        // im selben Tick; ohne dieses Warten fände `attachCamera` keinen, der Block meldete einen
        // Kamera-Fehler und der Lauf trüge ein falsches F9. `openLobbyCamera` ist dabei kein zweiter
        // Zugriff: es liefert den laufenden Stream bzw. die schon laufende Anforderung.
        void openLobbyCamera().then((camera) => {
          // Ohne Kamera gibt es nichts zu scannen: den Grund nennt die Kamera-Karte, hier bleibt der zweite Versuch.
          if (camera.running) scanAnswer();
          else rescan.hidden = false;
        });
      }
    }, (error: unknown) => { showError(alert, error); });
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
  const box = createRunBox(ctx);
  const qrPath = ctx.cell.path === 'qr';
  // Immer angelegt, nur auf dem QR-Pfad gelesen: so braucht keine Stelle eine Nicht-null-Behauptung.
  const marks = createPairingTracker(now);
  let qrFacts: LabReport['qr'] = null;
  /** Der Nutzer hat den Scan SELBST beendet (Text-Pfad) – nur dann bleibt „Erneut scannen" verborgen. */
  let userLeftScan = false;
  /** Genau EIN `qr:fallback-text`, über welchen der beiden Wege auch ausgewichen wurde. */
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
  if (qr !== null) qrMount.append(qr.element, qrActions);

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
    rescan.hidden = true;
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
  if (qr !== null) {
    const scanOffer = (): void => {
      rescan.hidden = true;
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
    rescan.onclick = scanOffer;
    // C4: der Scan startet von selbst – aber ERST mit laufender Kamera (siehe Host-Seite).
    void openLobbyCamera().then((camera) => {
      if (camera.running) scanOffer();
      else rescan.hidden = false;
    });
  }
  return element;
}
