import './selfTest.css';
import { createClientJoin, createHostLobby } from '../net/connector';
import { canShareText, copyText, shareText } from '../net/signaling/textShare';
import { S, fmt } from '../ui/strings';
import { cameraStatus, openTemporaryCamera } from './camera';
import { actionButton, flash, h } from './labDom';
import { attachLabLink, finishRun, type LabRunResult } from './labSession';
import {
  SELFTEST_OPEN_TIMEOUT_MS, normaliseDevice, runSelfTest, selfTestShareText, summariseRun,
  type SelfTestDeps, type SelfTestRow, type SelfTestRun, type SelfTestRunKey,
} from './selfTest';

// Oberfläche des Selbsttests: ein großer Knopf, eine Statuszeile, eine Tabelle A/B, Kopieren/Teilen.
// Sie hängt sich in den Platzhalter `[data-testid="selftest-mount"]` des Zellen-Formulars (labUi.ts) –
// der Spitzname kommt aus dem Feld direkt darüber, weitere Eingaben gibt es nicht.

export interface SelfTestMountOptions {
  /** Aktueller Inhalt des Spitznamen-Felds im Zellen-Formular; leer → „unbenannt". */
  getDevice(): string;
  /** Jeder fertige Lauf geht an die Report-Liste des Labors (`LabUi.showRun`). */
  onResult(result: LabRunResult): void;
}

const RUN_KEYS: readonly SelfTestRunKey[] = ['A', 'B'];
type RowField = 'camera' | 'valid' | 'candidates' | 'pair' | 'ping' | 'failures';
const TABLE_ROWS: readonly { field: RowField; label: string }[] = [
  { field: 'camera', label: S.lab.selfTest.rowCamera },
  { field: 'valid', label: S.lab.selfTest.rowValid },
  { field: 'candidates', label: S.lab.selfTest.rowCandidates },
  { field: 'pair', label: S.lab.selfTest.rowPair },
  { field: 'ping', label: S.lab.selfTest.rowPing },
  { field: 'failures', label: S.lab.selfTest.rowFailures },
];

function browserDeps(): SelfTestDeps {
  return {
    createHostLobby,
    createClientJoin,
    finishRun,
    attachLabLink,
    openCamera: openTemporaryCamera,
    gumCalled: () => cameraStatus().gumCalled,
    now: () => performance.now(),
    randomNonce: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
    openTimeoutMs: SELFTEST_OPEN_TIMEOUT_MS,
  };
}

/** Tabelle „Messwert | Lauf A | Lauf B": hochkant am Handy lesbar, ohne seitliches Scrollen. */
function buildTable(): { table: HTMLTableElement; show(row: SelfTestRow): void; reset(): void } {
  const table = h('table', 'selftest-table');
  table.dataset.testid = 'selftest-table';
  const head = h('tr');
  head.append(h('th', '', S.lab.selfTest.colMetric), h('th', '', S.lab.selfTest.colRunA), h('th', '', S.lab.selfTest.colRunB));
  const thead = h('thead');
  thead.append(head);
  const tbody = h('tbody');
  const cells = new Map<string, HTMLTableCellElement>();
  for (const row of TABLE_ROWS) {
    const tr = h('tr');
    const label = h('th', '', row.label);
    label.scope = 'row';
    tr.append(label);
    for (const key of RUN_KEYS) {
      const cell = h('td', '', S.lab.selfTest.none);
      cell.dataset.testid = `selftest-${key}-${row.field}`;
      cells.set(`${key}-${row.field}`, cell);
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return {
    table,
    show(row) {
      for (const { field } of TABLE_ROWS) {
        const cell = cells.get(`${row.key}-${field}`);
        if (cell === undefined) continue;
        cell.textContent = row[field];
        // `data-state` an JEDER Zelle des Laufs: färbt die Gültig-Zelle und ist das Signal „Lauf fertig" für Tests.
        cell.dataset.state = row.state;
      }
    },
    reset() {
      for (const cell of cells.values()) {
        cell.textContent = S.lab.selfTest.none;
        delete cell.dataset.state;
      }
    },
  };
}

/** Baut den Selbsttest in `mount` auf. Erwartbare Fehlschläge erscheinen in Tabelle und Statuszeile, nie im globalen Fehler-Panel. */
export function mountSelfTest(mount: HTMLElement, options: SelfTestMountOptions): void {
  const root = h('section', 'selftest');
  root.dataset.testid = 'selftest';
  const start = actionButton(S.lab.selfTest.start, 'selftest-start', 'accent');
  start.classList.add('selftest-start');
  const status = h('p', 'selftest-status');
  status.dataset.testid = 'selftest-status';
  status.setAttribute('role', 'status');
  const alert = h('p', 'selftest-alert');
  alert.dataset.testid = 'selftest-alert';
  alert.setAttribute('role', 'alert');
  alert.hidden = true;
  const result = buildTable();
  result.table.hidden = true;

  const copy = actionButton(S.lab.selfTest.copy, 'selftest-copy');
  const share = actionButton(S.lab.selfTest.share, 'selftest-share', 'secondary');
  const actions = h('div', 'shell-row');
  actions.hidden = true;
  actions.append(copy);
  if (canShareText()) actions.append(share);

  // Rückfallebene ohne Zwischenablage (z. B. iOS ohne Nutzer-Geste, unsicherer Kontext): Text zum Markieren.
  const details = h('details', 'selftest-details');
  details.hidden = true;
  const text = h('pre', 'selftest-text');
  text.dataset.testid = 'selftest-text';
  details.append(h('summary', '', S.lab.selfTest.showText), text);

  let shareable = '';
  copy.onclick = () => {
    void copyText(shareable).then((ok) => {
      flash(copy, ok ? S.lab.selfTest.copied : S.lab.selfTest.copyFailed);
      if (!ok) details.open = true;
    });
  };
  share.onclick = () => { void shareText(S.lab.selfTest.shareTitle, shareable); };

  async function execute(): Promise<void> {
    start.disabled = true;
    alert.hidden = true;
    actions.hidden = true;
    details.hidden = true;
    result.reset();
    result.table.hidden = false;
    try {
      const runs = await runSelfTest(normaliseDevice(options.getDevice()), browserDeps(), {
        onStatus: (line) => { status.textContent = line; },
        onRun: (run: SelfTestRun, runResult) => {
          const row = summariseRun(run);
          result.show(row);
          if (row.key === 'A' && row.state === 'invalid') {
            alert.textContent = fmt(S.lab.selfTest.invalidAlert, { reason: row.reason });
            alert.hidden = false;
          }
          if (runResult !== null) options.onResult(runResult);
        },
      });
      shareable = selfTestShareText(runs);
      text.textContent = shareable;
      actions.hidden = false;
      details.hidden = false;
    } finally {
      start.disabled = false;
    }
  }
  start.onclick = () => { void execute(); };

  root.append(h('h3', 'selftest-title', S.lab.selfTest.title), h('p', 'selftest-intro', S.lab.selfTest.intro), start, status, alert, result.table, actions, details);
  mount.append(root);
}
