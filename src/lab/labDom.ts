import type { FailureCode } from '../net/failureCodes';
import { canShareText, copyText, shareText } from '../net/signaling/textShare';
import { S } from '../ui/strings';

const FLASH_MS = 1800;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function actionButton(label: string, testId: string, variant: '' | 'secondary' | 'accent' = ''): HTMLButtonElement {
  const button = h('button', variant === '' ? 'btn' : `btn ${variant}`, label);
  button.type = 'button';
  button.dataset.testid = testId;
  return button;
}

/** Karte mit Überschrift – ein Schritt des Ablaufs. */
export function card(title: string, testId: string): HTMLElement {
  const section = h('section', 'lab-card');
  section.dataset.testid = testId;
  section.append(h('h2', 'lab-card-title', title));
  return section;
}

/** Beschriftetes Textfeld für Codes; `.selectable` hebt das globale `user-select: none` der Hülle auf. */
export function codeArea(label: string, testId: string, readOnly: boolean): { wrap: HTMLElement; area: HTMLTextAreaElement } {
  const wrap = h('label', 'lab-field');
  const area = h('textarea', 'lab-area selectable');
  area.dataset.testid = testId;
  area.readOnly = readOnly;
  area.rows = 3;
  area.spellcheck = false;
  area.autocapitalize = 'off';
  area.setAttribute('autocomplete', 'off');
  area.setAttribute('autocorrect', 'off');
  wrap.append(h('span', 'lab-label', label), area);
  return { wrap, area };
}

/** Zeigt kurz eine Rückmeldung auf dem Knopf und stellt danach die Beschriftung wieder her. */
export function flash(button: HTMLButtonElement, text: string): void {
  const original = button.dataset.label ?? button.textContent ?? '';
  button.dataset.label = original;
  button.textContent = text;
  setTimeout(() => { button.textContent = original; }, FLASH_MS);
}

/** „Kopieren" (+ „Teilen", falls der Browser reinen Text teilen kann) für einen Text. */
export function copyShareRow(getText: () => string, testIdPrefix: string, shareTitle: string, onCopyFailed?: () => void): HTMLElement {
  const row = h('div', 'shell-row');
  const copy = actionButton(S.lab.share.copy, `${testIdPrefix}-copy`);
  copy.onclick = () => {
    void copyText(getText()).then((ok) => {
      flash(copy, ok ? S.lab.share.copied : S.lab.share.copyFailed);
      if (!ok) onCopyFailed?.();
    });
  };
  row.append(copy);
  if (canShareText()) {
    const share = actionButton(S.lab.share.share, `${testIdPrefix}-share`, 'secondary');
    share.onclick = () => { void shareText(shareTitle, getText()); };
    row.append(share);
  }
  return row;
}

/** Fehlercode mit Titel und Hinweis anzeigen (nur textContent – nie innerHTML). */
export function showFailure(target: HTMLElement, code: FailureCode): void {
  const entry = S.failures[code];
  target.replaceChildren(h('strong', '', `${code} · ${entry.title}`), h('span', '', entry.hint));
  target.hidden = false;
}

export function showMessage(target: HTMLElement, text: string): void {
  target.replaceChildren(h('span', '', text));
  target.hidden = false;
}
