import { S } from '../ui/strings';
import { BUILD_ID } from './buildInfo';
import { createErrorLog, describeError, formatDiagnosis, type ErrorKind } from './errorLog';

function displayMode(): string {
  for (const mode of ['fullscreen', 'standalone', 'minimal-ui', 'browser']) {
    if (matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  return 'unbekannt';
}

/**
 * Fängt Laufzeitfehler global ab und zeigt ein kopierbares Diagnose-Panel.
 * Auf dem Handy gibt es keine Konsole – dieses Panel ist der Rückkanal zum Entwickler.
 */
export function installErrorPanel(getSwState: () => string): { report(kind: ErrorKind, value: unknown): void } {
  const log = createErrorLog(20);

  const panel = document.createElement('section');
  panel.className = 'error-panel';
  panel.dataset.testid = 'error-panel';
  panel.hidden = true;
  const heading = document.createElement('h2');
  heading.textContent = S.errors.title;
  const text = document.createElement('pre');
  const row = document.createElement('div');
  row.className = 'shell-row';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn accent';
  copy.textContent = S.errors.copy;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn secondary';
  close.textContent = S.errors.close;
  row.append(copy, close);
  panel.append(heading, text, row);
  document.body.append(panel);

  const diagnosis = (): string =>
    formatDiagnosis(
      { buildId: BUILD_ID, url: location.href, userAgent: navigator.userAgent, displayMode: displayMode(), online: navigator.onLine, swState: getSwState() },
      log.entries(),
    );

  copy.onclick = () => {
    navigator.clipboard.writeText(diagnosis()).then(
      () => { copy.textContent = S.errors.copied; },
      () => { copy.textContent = S.errors.copyFailed; },
    );
  };
  close.onclick = () => { panel.hidden = true; };

  function report(kind: ErrorKind, value: unknown): void {
    log.push({ at: new Date().toISOString(), kind, ...describeError(value) });
    text.textContent = diagnosis();
    copy.textContent = S.errors.copy;
    panel.hidden = false;
  }

  addEventListener('error', (event) => report('error', event.error ?? event.message));
  addEventListener('unhandledrejection', (event) => report('unhandledrejection', event.reason));
  // `webglcontextlost` feuert am Canvas und blubbert nicht – deshalb in der Capture-Phase abgreifen.
  addEventListener('webglcontextlost', () => report('webglcontextlost', S.errors.contextLost), true);

  return { report };
}
