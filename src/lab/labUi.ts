import { requestWakeLock } from '../platform/wakeLock';
import { S, fmt } from '../ui/strings';
import { attachCamera, observeTracks, openLobbyCamera, restartCamera, type CameraStatus } from './camera';
import { buildClientPanel, buildHostPanel } from './connectPanels';
import { actionButton, card, h } from './labDom';
import { recordLabEvent } from './labEvents';
import { parseLabQuery, type LabQuery } from './labQuery';
import { reattachLiveExchanges } from './qrPanels';
import type { LabRunResult } from './labSession';
import { createReportsPanel } from './reportsPanel';
import type { CellLabel } from './report';

const DEVICE_KEY = 'maeusebau.lab.device';
const MAX_DEVICE_LENGTH = 24;

/** Nahtstelle für den Selbsttest (Task 9): Einhängepunkt, Zellen-Formular lesen, Lauf in die Report-Liste geben. */
export interface LabUi {
  selfTestMount: HTMLElement;
  /** Liest das Formular; null (mit sichtbarem Hinweis), solange der Spitzname fehlt. */
  readCell(role: CellLabel['role'], path: CellLabel['path']): CellLabel | null;
  showRun(result: LabRunResult): void;
}

function loadDevice(): string {
  try {
    return (localStorage.getItem(DEVICE_KEY) ?? '').slice(0, MAX_DEVICE_LENGTH);
  } catch {
    return '';
  }
}

function saveDevice(device: string): void {
  try {
    localStorage.setItem(DEVICE_KEY, device);
  } catch {
    // gesperrter Speicher: der Spitzname gilt dann nur für diesen Seitenaufruf
  }
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = h('div', 'lab-field');
  wrap.append(h('span', 'lab-label', label), control);
  return wrap;
}

/** Radio-Gruppe als große Tipp-Flächen. */
function choiceGroup<T extends string>(name: string, options: readonly { value: T; label: string }[], initial: T): { element: HTMLElement; value(): T; inputs: HTMLInputElement[] } {
  const element = h('div', 'lab-choices');
  element.setAttribute('role', 'radiogroup');
  const inputs = options.map((option) => {
    const input = h('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === initial;
    input.dataset.testid = `${name}-${option.value}`;
    const label = h('label', 'lab-choice');
    label.append(input, h('span', '', option.label));
    element.append(label);
    return input;
  });
  return { element, inputs, value: () => (inputs.find((input) => input.checked)?.value ?? initial) as T };
}

function hotspotSelect(): HTMLSelectElement {
  const select = h('select', 'lab-input');
  select.dataset.testid = 'cell-hotspot';
  const options: readonly { value: CellLabel['hotspotOwner']; label: string }[] = [
    { value: 'unbekannt', label: S.lab.cell.hotspotUnknown },
    { value: 'dieses-geraet', label: S.lab.cell.hotspotThis },
    { value: 'gegenstelle', label: S.lab.cell.hotspotPeer },
    { value: 'router', label: S.lab.cell.hotspotRouter },
  ];
  for (const option of options) {
    const node = h('option', '', option.label);
    node.value = option.value;
    select.append(node);
  }
  return select;
}

/**
 * Kamera-Karte: öffnet den DAUER-Stream der Lobby (Kamera-zuerst), zeigt ihn im Sucher und beobachtet
 * seine Spuren. Eine beendete Spur ist nicht wiederbelebbar – deshalb „Kamera neu starten" statt
 * stillem Weiterlaufen. Jeder Spur-Wechsel geht als Seiten-Ereignis in jeden Report dieses Aufrufs.
 *
 * `autoStart` = der QR-Pfad (D5, C3): dort ist die Kamera Voraussetzung, kein Zubehör – die Karte
 * öffnet den Stream beim Eintritt in die Lobby selbst. Auf dem Text-Pfad bleibt es beim Knopf.
 */
function buildCameraCard(autoStart: boolean): HTMLElement {
  const element = card(S.lab.camera.title, 'camera-card');
  const state = h('p', 'lab-line');
  state.dataset.testid = 'camera-state';
  const video = h('video', 'lab-video');
  video.dataset.testid = 'camera-video';
  video.hidden = true;
  const start = actionButton(S.lab.camera.start, 'camera-start');
  const restart = actionButton(S.lab.camera.restart, 'camera-restart', 'secondary');
  restart.hidden = true;
  let stopObserving: (() => void) | null = null;
  /** Lief die Kamera in diesem Seitenaufruf jemals? Vorher gibt es nichts NEU zu starten. */
  let everRan = false;

  function show(status: CameraStatus): void {
    everRan = everRan || status.running;
    state.textContent = status.running
      ? (autoStart ? S.lab.camera.lobbyRunning : S.lab.camera.running)
      : fmt(autoStart ? S.lab.camera.lobbyFailed : S.lab.camera.failed, { reason: status.error ?? '?' });
    state.dataset.state = status.running ? 'ready' : 'bad';
    video.hidden = !status.running;
    if (status.running) attachCamera(video);
    // Nach einem Fehlschlag darf erneut versucht werden (z. B. nach geänderter Website-Einstellung).
    start.disabled = status.running;
    // Nur eine LAUFENDE Kamera braucht keinen Neustart-Knopf. Scheitert der Neustart (Kamera von einer
    // anderen App belegt, Erlaubnis entzogen), muss er stehen bleiben – sonst gäbe es am Handy keinen
    // zweiten Versuch mehr, und die Karte behauptete einen Zustand, aus dem sie nicht herausfindet.
    // Vor dem ERSTEN erfolgreichen Start gibt es dagegen nichts neu zu starten: dann führen zwei
    // Knöpfe nebeneinander mit demselben Ziel nur in die Irre – „Kamera einschalten" genügt.
    restart.hidden = status.running || !everRan;
  }

  function observe(): void {
    stopObserving?.();
    stopObserving = observeTracks((trackState) => {
      // Ohne Spur-ID: Zeitleisten-Details tragen nie eine Kennung der Kamera (Datenschutz).
      recordLabEvent(`camera:track:${trackState}`);
      if (trackState !== 'ended') return;
      // Eine verlorene Spur ist ein Kamera-Befund (F9) – der Report soll das erklären können.
      recordLabEvent('camera-error', 'track-ended');
      state.textContent = S.lab.camera.trackLost;
      state.dataset.state = 'bad';
      video.hidden = true;
      restart.hidden = false;
    });
  }

  start.onclick = () => {
    start.disabled = true;
    state.textContent = S.lab.camera.starting;
    void openLobbyCamera().then((status) => { show(status); observe(); });
  };
  restart.onclick = () => {
    restart.disabled = true;
    state.textContent = S.lab.camera.starting;
    void restartCamera().then((status) => {
      restart.disabled = false;
      show(status);
      observe();
      // Der Neustart liefert einen NEUEN Stream: die Sucher der QR-Blöcke hängen sonst am toten alten.
      if (status.running) reattachLiveExchanges();
    });
  };
  // Kamera-zuerst (D5, Spec-Absatz M2): auf dem QR-Pfad öffnet die Seite den Dauer-Stream beim Eintritt
  // in die Lobby selbst – dort ist die Kamera Voraussetzung, kein Zubehör. Der Knopf bleibt für den
  // zweiten Versuch (nach einer abgelehnten Berechtigung) und für den Text-Pfad stehen.
  if (autoStart) {
    start.disabled = true;
    state.textContent = S.lab.camera.lobbyStarting;
    void openLobbyCamera().then((status) => { show(status); observe(); });
  }
  const actions = h('div', 'shell-row');
  actions.append(start, restart);
  element.append(h('p', 'lab-line', S.lab.camera.hint), actions, video, state);
  return element;
}

/** Baut das Labor unterhalb der Hülle auf: Zelle beschriften → Kamera → verbinden → Reports. */
export function mountLab(root: HTMLElement, search: string): LabUi {
  const query: LabQuery = parseLabQuery(search);
  // Der Testmodus hat keinen Signalweg zum Wählen – dort bleibt der Pfad fest.
  const broadcast = query.transport === 'broadcast';
  const lab = h('section', 'lab');
  lab.dataset.testid = 'lab';
  const reports = createReportsPanel();

  const cellCard = card(S.lab.cell.title, 'cell-card');
  const role = choiceGroup<'host' | 'client'>('cell-role', [{ value: 'host', label: S.lab.cell.roleHost }, { value: 'client', label: S.lab.cell.roleClient }], query.role ?? 'host');
  const camera = choiceGroup<CellLabel['camera']>('cell-camera', [{ value: 'aus', label: S.lab.cell.cameraOff }, { value: 'an', label: S.lab.cell.cameraOn }], 'aus');
  const hotspot = hotspotSelect();
  const device = h('input', 'lab-input selectable');
  device.type = 'text';
  device.maxLength = MAX_DEVICE_LENGTH;
  device.placeholder = S.lab.cell.devicePlaceholder;
  device.value = loadDevice();
  device.dataset.testid = 'cell-device';
  device.setAttribute('autocomplete', 'off');
  // Pfad-Auswahl (M2): Text oder QR. Der Chip `cell-path` BLEIBT – er spiegelt jetzt die Auswahl,
  // statt sie zu behaupten. So lesen Report-Liste, E2E und Nutzer denselben Wert an derselben Stelle.
  const pathChoice = choiceGroup<'text' | 'qr'>(
    'cell-path-choice',
    [{ value: 'text', label: S.lab.cell.pathText }, { value: 'qr', label: S.lab.cell.pathQr }],
    'text',
  );
  pathChoice.element.setAttribute('aria-label', S.lab.cell.pathChoice);
  const pathChip = h('span', 'chip');
  pathChip.dataset.testid = 'cell-path';
  const readPath = (): CellLabel['path'] => (broadcast ? 'broadcast' : pathChoice.value());
  const syncPathChip = (): void => {
    const current = readPath();
    pathChip.textContent = current === 'broadcast' ? S.lab.cell.pathBroadcast : current === 'qr' ? S.lab.cell.pathQr : S.lab.cell.pathText;
  };
  for (const input of pathChoice.inputs) input.onchange = syncPathChip;
  syncPathChip();
  const pathBox = h('div', 'lab-path');
  if (broadcast) pathBox.append(pathChip);
  else pathBox.append(pathChoice.element, pathChip);
  const deviceError = h('p', 'lab-alert', S.lab.cell.deviceMissing);
  deviceError.setAttribute('role', 'alert');
  deviceError.hidden = true;
  const selfTestMount = h('div', 'lab-selftest');
  selfTestMount.dataset.testid = 'selftest-mount'; // ← Task 9 hängt hier den Selbsttest-Knopf ein
  const confirm = actionButton(S.lab.cell.confirm, 'cell-confirm', 'accent');
  const restart = actionButton(S.lab.cell.restart, 'cell-restart', 'secondary');
  restart.hidden = true;
  restart.onclick = () => { location.reload(); };
  const grid = h('div', 'lab-grid');
  grid.append(field(S.lab.cell.role, role.element), field(S.lab.cell.camera, camera.element), field(S.lab.cell.hotspot, hotspot), field(S.lab.cell.device, device), field(S.lab.cell.path, pathBox));
  const cellActions = h('div', 'shell-row');
  cellActions.append(confirm, restart, selfTestMount);
  cellCard.append(h('p', 'lab-line', S.lab.cell.hint), grid, deviceError, cellActions);

  function readCell(cellRole: CellLabel['role'], cellPath: CellLabel['path']): CellLabel | null {
    const name = device.value.trim();
    deviceError.hidden = name.length >= 1 && name.length <= MAX_DEVICE_LENGTH;
    if (!deviceError.hidden) return null;
    saveDevice(name);
    return { role: cellRole, hotspotOwner: hotspot.value as CellLabel['hotspotOwner'], camera: camera.value(), path: cellPath, device: name };
  }

  const steps = h('div', 'lab-steps');
  confirm.onclick = () => {
    const cell = readCell(role.value(), readPath());
    if (cell === null) return;
    // Erste Nutzergeste der Seite: genau hier darf der Bildschirm-Wachhalter angefordert werden. Er ist
    // nie fatal (headless Chromium lehnt ab, installierte iOS-Web-Apps < 18.4 ignorieren ihn) – sein
    // Zustand geht als Seiten-Ereignis in jeden Report dieses Aufrufs.
    void requestWakeLock((wakeState) => { recordLabEvent(`wakelock:${wakeState}`); });
    // Eine Zelle je Seitenaufruf: das Label darf sich während eines Laufs nicht mehr ändern.
    for (const control of [...role.inputs, ...camera.inputs, ...pathChoice.inputs, hotspot, device]) control.disabled = true;
    confirm.hidden = true;
    restart.hidden = false;
    const ctx = { cell, query, onRun: (result: LabRunResult) => { reports.showRun(result); } };
    // Der QR-Pfad BRAUCHT die Kamera (D5, Kamera-zuerst) – dort steht die Karte immer und startet selbst.
    if (cell.camera === 'an' || cell.path === 'qr') steps.append(buildCameraCard(cell.path === 'qr'));
    steps.append(cell.role === 'host' ? buildHostPanel(ctx) : buildClientPanel(ctx));
  };

  lab.append(cellCard, steps, reports.element);
  root.append(lab);
  return { selfTestMount, readCell, showRun: (result) => { reports.showRun(result); } };
}
