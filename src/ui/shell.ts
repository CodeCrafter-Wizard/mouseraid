import { BUILD_ID, checkExpectedBuild, expectedBuild } from '../platform/buildInfo';
import { S, fmt } from './strings';

export interface ShellOptions {
  subtitle: string;
  note: string;
  links: { href: string; label: string }[];
  info?: { label: string; value: string }[];
  /**
   * Nur die Spielseite: der Streifen über der Leinwand ist einklappbar. Fehlt das Feld, entsteht
   * KEIN Knopf und `data-collapsed` bleibt ungesetzt – `lab.html` benutzt dieselbe Hülle.
   */
  collapsible?: { collapsed: boolean; collapseLabel: string; expandLabel: string };
}

export interface ShellHandles {
  setOfflineReady(): void;
  setSwState(text: string): void;
  getSwState(): string;
  setUpdateAvailable(apply: () => void): void;
  onCheckUpdate(handler: () => void): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Gemeinsame Hülle für Spiel- und Labor-Seite: Titel, Status-Chips, Update-Buttons, Links. */
export function mountShell(root: HTMLElement, options: ShellOptions): ShellHandles {
  root.replaceChildren();

  const title = el('h1', 'shell-title', S.appName);
  title.dataset.testid = 'shell-title';
  const sub = el('p', 'shell-sub', options.subtitle);
  const note = el('p', 'shell-note', options.note);

  // Zwei zusätzliche Klassen: `shell-status` bleibt im eingeklappten Streifen sichtbar (Titel,
  // Offline-Chip und Build-Chip sind Tor-relevant – `offline-smoke.spec.ts`), `shell-actions`
  // verschwindet mit. Beide hießen vorher nur `shell-row`; die Klasse bleibt für das Layout.
  const status = el('div', 'shell-row shell-status');
  const offline = el('span', 'chip', S.pwa.offlinePending);
  offline.dataset.testid = 'offline-badge';
  offline.dataset.state = 'pending';
  const build = el('span', 'chip', `${S.shell.build} ${BUILD_ID}`);
  build.dataset.testid = 'build-id';
  const expectation = checkExpectedBuild(location.search, BUILD_ID);
  build.dataset.expect = expectation;
  const sw = el('span', 'chip', '');
  sw.dataset.testid = 'sw-state';
  sw.hidden = true;
  status.append(offline, build, sw);

  const actions = el('div', 'shell-row shell-actions');
  const check = el('button', 'btn secondary', S.pwa.checkUpdate);
  check.type = 'button';
  check.dataset.testid = 'check-update';
  const apply = el('button', 'btn accent', `${S.pwa.updateAvailable} – ${S.pwa.applyUpdate}`);
  apply.type = 'button';
  apply.dataset.testid = 'apply-update';
  apply.hidden = true;
  actions.append(check, apply);
  for (const link of options.links) {
    const a = el('a', 'btn', link.label);
    a.href = link.href;
    actions.append(a);
  }

  root.append(title, sub, note, status, actions);

  // Der Knopf steht IM Status-Streifen und bleibt deshalb auch eingeklappt sichtbar und bedienbar.
  // Er ist die einzige Stelle, die `data-collapsed` schreibt – `ShellHandles` bekommt bewusst kein
  // `setCollapsed`: eine Schnittstelle ohne Aufrufer bräche nur die Hüllen-Attrappe in den Tests.
  const collapsible = options.collapsible;
  if (collapsible !== undefined) {
    let collapsed = collapsible.collapsed;
    const toggle = el('button', 'btn secondary shell-toggle', collapsed ? collapsible.expandLabel : collapsible.collapseLabel);
    toggle.type = 'button';
    toggle.dataset.testid = 'shell-toggle';
    const paint = (): void => {
      root.dataset.collapsed = collapsed ? 'true' : 'false';
      toggle.textContent = collapsed ? collapsible.expandLabel : collapsible.collapseLabel;
      toggle.dataset.collapsed = collapsed ? 'true' : 'false';
    };
    toggle.onclick = () => {
      collapsed = !collapsed;
      paint();
    };
    status.append(toggle);
    paint();
  }

  if (expectation === 'mismatch') {
    root.append(el('p', 'shell-note', fmt(S.shell.buildMismatch, { expected: expectedBuild(location.search) ?? '' })));
  }
  if (options.info !== undefined && options.info.length > 0) {
    const list = el('ul', 'info-list');
    for (const row of options.info) list.append(el('li', '', `${row.label}: ${row.value}`));
    root.append(list);
  }

  let swState = '';
  return {
    setOfflineReady() {
      offline.textContent = S.pwa.offlineReady;
      offline.dataset.state = 'ready';
    },
    setSwState(text) {
      swState = text;
      sw.textContent = text;
      sw.hidden = text === '';
    },
    getSwState: () => swState,
    setUpdateAvailable(applyUpdate) {
      apply.hidden = false;
      apply.onclick = () => applyUpdate();
    },
    onCheckUpdate(handler) {
      check.onclick = () => handler();
    },
  };
}
