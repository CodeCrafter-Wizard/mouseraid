import type { PingStats } from '../net/pingTest';
import { canShareText, copyText, shareText } from '../net/signaling/textShare';
import type { Channel } from '../net/transport';
import { S, fmt } from '../ui/strings';
import { actionButton, card, flash, h } from './labDom';
import type { LabRunResult } from './labSession';
import { createReportStore, redactReport, reportToText, reportsToJson, type LabReport } from './report';

/** So lange bleibt „Verlauf löschen" nach dem ersten Tipp scharf. */
const DISARM_MS = 5000;

export interface ReportsPanel {
  element: HTMLElement;
  /** Liste neu aus dem Speicher aufbauen. */
  refresh(): void;
  /** Letzten Lauf merken (Roh-SDP nur im Arbeitsspeicher) und die Liste aktualisieren. */
  showRun(result: LabRunResult): void;
}

/** Eine Zeile je Kanal – dieselbe Formatierung benutzt auch die Verbindungs-Ansicht. */
export function pingLine(channel: Channel, stats: PingStats | null): string {
  if (stats === null) return fmt(S.lab.run.pingMissing, { channel });
  return fmt(S.lab.run.pingResult, {
    channel, received: String(stats.received), sent: String(stats.sent),
    loss: stats.lossPct.toFixed(1).replace('.', ','), median: stats.medianMs.toFixed(1).replace('.', ','),
  });
}

function storedReports(): LabReport[] {
  try {
    // Neueste zuerst – unabhängig davon, in welcher Reihenfolge der Speicher sie liefert.
    return [...createReportStore(localStorage).list()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

const ROLE_LABEL: Record<LabReport['cell']['role'], string> = { host: S.lab.cell.roleHost, client: S.lab.cell.roleClient, selbsttest: S.lab.cell.roleSelfTest };
const PATH_LABEL: Record<LabReport['cell']['path'], string> = { text: S.lab.cell.pathText, qr: S.lab.cell.pathQr, broadcast: S.lab.cell.pathBroadcast, loopback: S.lab.cell.pathLoopback };

function cellLine(report: LabReport): string {
  const when = new Date(report.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' });
  const { cell } = report;
  return `${when} · ${ROLE_LABEL[cell.role]} · ${PATH_LABEL[cell.path]} · ${S.lab.cell.camera} ${cell.camera} · ${cell.device}`;
}

function failureLine(report: LabReport): string {
  if (report.failures.length === 0) return S.lab.reports.noFailures;
  return report.failures.map((code) => `${code} · ${S.failures[code].title}`).join(' / ');
}

function reportItem(report: LabReport, copyOne: (report: LabReport, button: HTMLButtonElement) => void): HTMLLIElement {
  const item = h('li', 'lab-report');
  item.dataset.testid = 'report-item';
  item.dataset.role = report.cell.role;
  const badge = h('span', 'chip', report.valid ? S.lab.reports.valid : S.lab.reports.invalid);
  badge.dataset.testid = 'report-valid';
  badge.dataset.state = report.valid ? 'ready' : 'bad';
  const head = h('div', 'lab-report-head');
  head.append(badge, h('strong', '', cellLine(report)));
  const failures = h('p', 'lab-line', failureLine(report));
  failures.dataset.testid = 'report-failures';
  const copy = actionButton(S.lab.reports.copyOne, 'report-copy', 'secondary');
  copy.onclick = () => { copyOne(report, copy); };
  item.append(head, h('p', 'lab-line', pingLine('events', report.ping.events)), h('p', 'lab-line', pingLine('state', report.ping.state)), failures);
  if (!report.valid && report.invalidReason !== null) item.append(h('p', 'lab-line lab-warn', report.invalidReason));
  item.append(copy);
  return item;
}

/** Schritt 4: gespeicherte Reports (neueste zuerst) mit Kopieren/Teilen. Geteilt wird nur anonymisiert. */
export function createReportsPanel(): ReportsPanel {
  const element = card(S.lab.reports.title, 'reports-card');
  const list = h('ul', 'lab-report-list');
  list.dataset.testid = 'report-list';
  const empty = h('p', 'lab-line', S.lab.reports.empty);
  let lastRun: LabRunResult | null = null;

  // Rückfallebene ohne Zwischenablage (unsicherer Kontext): Text zum Markieren anzeigen.
  const fallbackWrap = h('label', 'lab-field');
  const fallback = h('textarea', 'lab-area selectable');
  fallback.dataset.testid = 'copy-fallback';
  fallback.readOnly = true;
  fallback.rows = 4;
  fallbackWrap.append(h('span', 'lab-label', S.lab.reports.fallbackLabel), fallback);
  fallbackWrap.hidden = true;

  function copyWithFallback(text: string, button: HTMLButtonElement): void {
    void copyText(text).then((ok) => {
      flash(button, ok ? S.lab.share.copied : S.lab.share.copyFailed);
      fallbackWrap.hidden = ok;
      // Beim Erfolg nichts stehen lassen: der Text kann echte Adressen tragen und soll nicht
      // unsichtbar im DOM weiterleben, bis der nächste Fehlschlag ihn wieder aufdeckt.
      fallback.value = ok ? '' : text;
      if (!ok) fallback.select();
    });
  }

  const withAddresses = h('input');
  withAddresses.type = 'checkbox';
  withAddresses.dataset.testid = 'with-addresses';
  const addressToggle = h('label', 'lab-check');
  addressToggle.append(withAddresses, h('span', '', S.lab.reports.withAddresses));

  const redactedJson = (): string => reportsToJson(storedReports().map(redactReport));

  const copyAll = actionButton(S.lab.reports.copyAll, 'reports-copy-all');
  copyAll.onclick = () => { copyWithFallback(redactedJson(), copyAll); };
  const shareAll = actionButton(S.lab.reports.shareAll, 'reports-share-all', 'secondary');
  shareAll.hidden = !canShareText();
  shareAll.onclick = () => { void shareText(S.lab.share.reportsTitle, redactedJson()); };

  const rawWarning = h('p', 'lab-line lab-warn', S.lab.reports.rawWarning);
  const copyRaw = actionButton(S.lab.reports.copyRaw, 'reports-copy-raw', 'secondary');
  copyRaw.onclick = () => {
    const raw = lastRun?.rawSdp ?? null;
    if (raw !== null) copyWithFallback(`${S.lab.reports.rawLocal}\n${raw.local}\n${S.lab.reports.rawRemote}\n${raw.remote}`, copyRaw);
  };

  const clear = actionButton(S.lab.reports.clear, 'reports-clear', 'secondary');
  let armed = false;
  let disarmTimer: ReturnType<typeof setTimeout> | null = null;
  function disarm(): void {
    if (disarmTimer !== null) clearTimeout(disarmTimer);
    disarmTimer = null;
    if (!armed) return;
    armed = false;
    clear.textContent = S.lab.reports.clear;
  }
  clear.onclick = () => {
    // Zwei Tipper statt confirm(): kein System-Dialog, der in der installierten App hängen kann.
    if (!armed) {
      armed = true;
      clear.textContent = S.lab.reports.clearConfirm;
      // Ein vergessener „scharfer" Knopf löscht sonst beim nächsten, ganz anders gemeinten Tipp.
      disarmTimer = setTimeout(disarm, DISARM_MS);
      return;
    }
    disarm();
    try {
      createReportStore(localStorage).clear();
    } catch {
      // gesperrter Speicher: dann gibt es auch nichts zu löschen
    }
    refresh();
  };

  const buttons = h('div', 'shell-row');
  buttons.append(copyAll, shareAll, copyRaw, clear);
  element.append(empty, list, addressToggle, buttons, rawWarning, fallbackWrap);

  function refresh(): void {
    // Die Liste wird neu gebaut – ein noch scharfer Löschknopf gehört nicht in die neue Ansicht.
    disarm();
    const reports = storedReports();
    const copyOne = (report: LabReport, button: HTMLButtonElement): void => {
      // Angehakt: JSON MIT echten Adressen (Entwicklerpfad für die Matrix). Sonst der anonymisierte
      // Textbericht. Nur diese eine Stelle darf Adressen herausgeben – „alle kopieren"/„teilen" nie.
      copyWithFallback(withAddresses.checked ? reportsToJson([report]) : reportToText(redactReport(report)), button);
    };
    list.replaceChildren(...reports.map((report) => reportItem(report, copyOne)));
    empty.hidden = reports.length > 0;
    addressToggle.hidden = reports.length === 0;
    copyAll.disabled = reports.length === 0;
    shareAll.disabled = reports.length === 0;
    const hasRaw = lastRun !== null && lastRun.rawSdp !== null;
    copyRaw.hidden = !hasRaw;
    rawWarning.hidden = !hasRaw;
  }

  // Ein zweiter Tab desselben Geräts (Entwicklung/E2E) schreibt in denselben Speicher.
  addEventListener('storage', refresh);
  refresh();

  return {
    element,
    refresh,
    showRun(result) {
      lastRun = result;
      refresh();
    },
  };
}
