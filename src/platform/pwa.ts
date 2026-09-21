import { registerSW } from 'virtual:pwa-register';
import type { ShellHandles } from '../ui/shell';
import { S } from '../ui/strings';
import { updateCheckOutcome } from './updateStatus';

/**
 * Liefert eine Funktion, die je Worker höchstens EINEN `statechange`-Listener anhängt – sonst
 * stapelt jeder weitere Klick einen Listener auf denselben Worker. `{ once: true }` wäre falsch:
 * der erste Zustandswechsel (`installed` → `activating`) ist noch nicht der gesuchte.
 */
function oncePerWorker(): (worker: ServiceWorker, listener: () => void) => void {
  const seen = new WeakSet<ServiceWorker>();
  return (worker, listener) => {
    if (seen.has(worker)) return;
    seen.add(worker);
    worker.addEventListener('statechange', listener);
  };
}

/**
 * Registriert den Service Worker (Update nur auf Nachfrage – nie Auto-Reload mitten im Spiel)
 * und verdrahtet Offline-Status sowie „Nach Update suchen" mit der Hülle.
 */
export function initPwa(ui: ShellHandles): void {
  // Ohne Service Worker kann nur ein Neuladen eine neue Version holen. Der Knopf bleibt sichtbar
  // und tut etwas Ehrliches – der `?expect=`-Hinweis schickt den Nutzer genau dorthin.
  if (import.meta.env.MODE === 'phone') {
    ui.setSwState(S.pwa.phoneMode);
    ui.onCheckUpdate(() => { location.reload(); });
    return;
  }
  if (!('serviceWorker' in navigator)) {
    ui.setSwState(S.pwa.unsupported);
    ui.onCheckUpdate(() => { location.reload(); });
    return;
  }

  let registration: ServiceWorkerRegistration | undefined;
  // Zwei getrennte Merker: derselbe Worker ist erst `installing` und später `waiting`.
  const watchLoading = oncePerWorker();
  const watchWaiting = oncePerWorker();

  /** Neuer Worker wartet: Chip und Knopf sagen dasselbe. Mehrfach aufrufbar. */
  function showUpdateReady(): void {
    ui.setSwState(S.pwa.updateReady);
    ui.setUpdateAvailable(applyUpdate);
  }

  function applyUpdate(): void {
    // Auf einer noch unkontrollierten Seite ist der neue Worker schon aktiv – dann gibt es nichts
    // zu „skipWaiting", und nur ein Neuladen holt die neue Version. Sonst erst nach `activated`
    // neu laden, damit der frische Worker die Seite auch wirklich ausliefert.
    const waiting = registration?.waiting ?? null;
    if (waiting === null) {
      location.reload();
      return;
    }
    watchWaiting(waiting, () => {
      if (waiting.state === 'activated') location.reload();
    });
    void updateSW(true);
  }

  /** `update()` ist fertig, der gefundene Worker lädt aber noch – sein Ende abwarten. */
  function watchInstalling(worker: ServiceWorker | null): void {
    if (worker === null) return;
    watchLoading(worker, () => {
      if (worker.state === 'installed' || worker.state === 'activated') showUpdateReady();
      else if (worker.state === 'redundant') ui.setSwState(S.pwa.checkFailed);
    });
  }

  const updateSW = registerSW({
    immediate: true,
    onOfflineReady: () => ui.setOfflineReady(),
    onNeedRefresh: () => showUpdateReady(),
    onRegisteredSW(_url, reg) {
      registration = reg;
      ui.setSwState(reg === undefined ? S.pwa.notRegistered : S.pwa.registered);
    },
    onRegisterError: () => ui.setSwState(S.pwa.registerError),
  });

  // `ready` löst erst auf, wenn ein SW aktiv ist – der Precache ist dann vollständig.
  // Deckt auch Wiederbesuche ab, bei denen `onOfflineReady` nicht erneut feuert.
  void navigator.serviceWorker.ready.then(() => ui.setOfflineReady());

  ui.onCheckUpdate(() => {
    const reg = registration;
    if (reg === undefined) {
      ui.setSwState(S.pwa.notRegistered);
      return;
    }
    ui.setSwState(S.pwa.checking);
    // `update()` löst auch bei GEFUNDENEM Update auf – erst die Registrierung verrät das Ergebnis.
    reg.update().then(
      () => {
        const outcome = updateCheckOutcome(reg);
        if (outcome === 'loading') {
          ui.setSwState(S.pwa.updateLoading);
          watchInstalling(reg.installing);
          return;
        }
        if (outcome === 'ready') {
          showUpdateReady();
          return;
        }
        ui.setSwState(S.pwa.upToDate);
      },
      () => ui.setSwState(S.pwa.checkFailed),
    );
  });
}
