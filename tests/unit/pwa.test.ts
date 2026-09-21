import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellHandles } from '../../src/ui/shell';
import { S } from '../../src/ui/strings';

// `virtual:pwa-register` gibt es nur im Vite-Build. Der Ersatz merkt sich die Rückrufe, die
// `initPwa` übergibt, damit der Test sie wie der echte Service Worker auslösen kann.
interface RegisterOptions {
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string, registration: unknown) => void;
}
const pwaRegister = vi.hoisted(() => ({
  options: null as RegisterOptions | null,
  updateSW: vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: RegisterOptions) => {
    pwaRegister.options = options;
    return pwaRegister.updateSW;
  },
}));

class FakeWorker {
  readonly listeners: (() => void)[] = [];
  constructor(public state: string) {}
  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }
  become(state: string): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

interface FakeRegistration {
  installing: FakeWorker | null;
  waiting: FakeWorker | null;
  update: () => Promise<void>;
}

function fakeUi() {
  const states: string[] = [];
  let check: () => void = () => {};
  let apply: (() => void) | null = null;
  let applyOffers = 0;
  const ui: ShellHandles = {
    setOfflineReady: () => {},
    setSwState: (text) => { states.push(text); },
    getSwState: () => states.at(-1) ?? '',
    setUpdateAvailable: (handler) => { apply = handler; applyOffers += 1; },
    onCheckUpdate: (handler) => { check = handler; },
  };
  return {
    ui,
    states,
    clickCheck: () => check(),
    clickApply: () => { if (apply === null) throw new Error('„Jetzt aktualisieren" wurde nie angeboten'); apply(); },
    applyOffers: () => applyOffers,
  };
}

/** Lässt die `then`-Kette hinter `registration.update()` ablaufen. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const reload = vi.fn();

async function start(registration: FakeRegistration) {
  const { initPwa } = await import('../../src/platform/pwa');
  const shell = fakeUi();
  initPwa(shell.ui);
  pwaRegister.options?.onRegisteredSW?.('sw.js', registration);
  return shell;
}

describe('initPwa – Listener stapeln sich nicht', () => {
  beforeEach(() => {
    reload.mockClear();
    pwaRegister.updateSW.mockClear();
    vi.stubGlobal('navigator', { serviceWorker: { ready: new Promise<void>(() => {}) } });
    vi.stubGlobal('location', { reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('„Jetzt aktualisieren" hängt auch bei drei Klicks nur einen Listener an den wartenden Worker', async () => {
    const waiting = new FakeWorker('installed');
    const shell = await start({ installing: null, waiting, update: () => Promise.resolve() });
    pwaRegister.options?.onNeedRefresh?.();

    shell.clickApply();
    shell.clickApply();
    shell.clickApply();

    expect(waiting.listeners).toHaveLength(1);
    expect(pwaRegister.updateSW).toHaveBeenCalledTimes(3);
    expect(pwaRegister.updateSW).toHaveBeenLastCalledWith(true);
    waiting.become('activating');
    expect(reload).not.toHaveBeenCalled();
    waiting.become('activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('„Nach Update suchen" hängt auch bei drei Klicks nur einen Listener an den ladenden Worker', async () => {
    const installing = new FakeWorker('installing');
    const shell = await start({ installing, waiting: null, update: () => Promise.resolve() });

    shell.clickCheck();
    shell.clickCheck();
    shell.clickCheck();
    await flush();

    expect(installing.listeners).toHaveLength(1);
    expect(shell.states.filter((text) => text === S.pwa.updateLoading)).toHaveLength(3);
    installing.become('installed');
    expect(shell.applyOffers()).toBe(1);
    expect(shell.states.at(-1)).toBe(S.pwa.updateReady);
  });

  it('derselbe Worker wird erst beim Laden und danach beim Aktivieren beobachtet – beides wirkt', async () => {
    const worker = new FakeWorker('installing');
    const registration: FakeRegistration = { installing: worker, waiting: null, update: () => Promise.resolve() };
    const shell = await start(registration);

    shell.clickCheck();
    await flush();
    registration.installing = null;
    registration.waiting = worker;
    worker.become('installed');
    shell.clickApply();
    shell.clickApply();

    expect(worker.listeners).toHaveLength(2);
    worker.become('activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ohne wartenden Worker lädt „Jetzt aktualisieren" sofort neu (unkontrollierte Seite)', async () => {
    const shell = await start({ installing: null, waiting: null, update: () => Promise.resolve() });
    pwaRegister.options?.onNeedRefresh?.();

    shell.clickApply();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(pwaRegister.updateSW).not.toHaveBeenCalled();
  });
});
