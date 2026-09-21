import { registerSW } from 'virtual:pwa-register';
import type { ShellHandles } from '../ui/shell';
import { S } from '../ui/strings';

/**
 * Registriert den Service Worker (Update nur auf Nachfrage – nie Auto-Reload mitten im Spiel)
 * und verdrahtet Offline-Status sowie „Nach Update suchen" mit der Hülle.
 */
export function initPwa(ui: ShellHandles): void {
  if (import.meta.env.MODE === 'phone') {
    ui.setSwState(S.pwa.phoneMode);
    return;
  }
  if (!('serviceWorker' in navigator)) {
    ui.setSwState(S.pwa.unsupported);
    return;
  }

  let registration: ServiceWorkerRegistration | undefined;
  const updateSW = registerSW({
    immediate: true,
    onOfflineReady: () => ui.setOfflineReady(),
    onNeedRefresh: () => ui.setUpdateAvailable(() => { void updateSW(true); }),
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
    if (registration === undefined) {
      ui.setSwState(S.pwa.notRegistered);
      return;
    }
    ui.setSwState(S.pwa.checking);
    registration.update().then(
      () => ui.setSwState(S.pwa.upToDate),
      () => ui.setSwState(S.pwa.registerError),
    );
  });
}
