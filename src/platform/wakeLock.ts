/**
 * Bildschirm-Wachhaltung für lange Messläufe am Handy. Diese Schicht kennt das Labor NICHT
 * (`src/platform` darf `src/lab` nicht importieren) – jeder Zustandswechsel geht deshalb durch einen
 * Rückruf, den der Aufrufer in seine Zeitleiste schreibt (`wakelock:<state>`), genau wie bei
 * `installErrorPanel(getSwState, scrub)`.
 *
 * Bekannte Grenzen (Faktenblatt): in installierten iOS-Web-Apps unter iOS < 18.4 wirkt der Wake Lock
 * nicht (WebKit-Bug 254545); headless Chromium lehnt mit `NotAllowedError` ab (headful: erteilt).
 * Ein Fehlschlag ist deshalb nie fatal – er wird gemeldet, nicht geworfen.
 */

export type WakeLockState = 'acquired' | 'released' | 'denied' | 'unsupported';

/** Nur das, was wir vom `WakeLockSentinel` brauchen – so bleibt der Test ohne DOM. */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockEnv {
  /** `undefined` = der Browser kennt Wake Lock nicht. */
  request?: (type: 'screen') => Promise<WakeLockSentinelLike>;
  /** Hängt einen Seiten-Zuhörer ein und gibt seine Abmeldung zurück. */
  on(type: 'visibilitychange' | 'pagehide', listener: () => void): () => void;
  isVisible(): boolean;
}

export interface WakeLockHandle {
  readonly state: WakeLockState;
  /** Gibt die Sperre frei und meldet alle Zuhörer ab. Mehrfach aufrufbar. */
  release(): void;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** Der echte Browser als Umgebung: `visibilitychange` gibt es nur auf `document`, `pagehide` nur auf `window`. */
export function browserWakeLockEnv(): WakeLockEnv {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return {
    request: api === undefined ? undefined : (type) => api.request(type),
    on(type, listener) {
      const target: EventTarget = type === 'visibilitychange' ? document : window;
      target.addEventListener(type, listener);
      return () => { target.removeEventListener(type, listener); };
    },
    isVisible: () => document.visibilityState === 'visible',
  };
}

/**
 * Auf der ERSTEN Nutzergeste im Labor anfordern („Zelle übernehmen"). Wirft nie: ohne Unterstützung
 * bzw. bei Ablehnung kommt `null` zurück, `onState` meldet den Zustand trotzdem. Bei Erfolg hängt der
 * Handle selbst die Zuhörer ein: sichtbar → neu anfordern (der Browser gibt die Sperre bei
 * Unsichtbarkeit automatisch frei), `pagehide` → freigeben und abmelden.
 */
export async function requestWakeLock(
  onState?: (state: WakeLockState) => void,
  env: WakeLockEnv = browserWakeLockEnv(),
): Promise<WakeLockHandle | null> {
  const request = env.request;
  let current: WakeLockState = 'released';
  const report = (state: WakeLockState): void => {
    current = state;
    onState?.(state);
  };
  if (request === undefined) {
    report('unsupported');
    return null;
  }

  let sentinel: WakeLockSentinelLike | null = null;
  try {
    // `await` im try fängt auch ein synchrones Werfen der Anforderung ab.
    sentinel = await request('screen');
  } catch {
    report('denied');
    return null;
  }

  let released = false;
  /** Einmal „nein" heißt nein: ohne diesen Riegel liefe die Neuanforderung in eine Endlosschleife. */
  let denied = false;
  /**
   * Ein Gerät, das die Sperre sofort wieder einzieht (Energiesparmodus, Systementzug), flattert
   * sonst endlos: jede Freigabe fordert neu an, jede Anforderung kommt zurückgenommen an. Nach so
   * vielen Wiederholungen OHNE Zutun des Nutzers ist Schluss – der Report zeigt dann ehrlich, dass
   * die Sperre nicht zu halten war, statt die Zeitleiste mit hunderten Einträgen zu fluten.
   */
  const MAX_REACQUIRES = 5;
  let reacquires = 0;
  /** Genau eine Anforderung gleichzeitig – sonst entstünden zwei Sentinels, von denen nur einer freigegeben wird. */
  let requesting = false;
  const unsubscribe: (() => void)[] = [];
  const watch = (next: WakeLockSentinelLike): void => {
    sentinel = next;
    // Der Sentinel hat kein `removeEventListener` – der Riegel ist deshalb `released`.
    next.addEventListener('release', () => {
      if (released || sentinel !== next) return;
      report('released');
      // Der Browser nimmt die Sperre auch im Vordergrund zurück (Energiesparmodus, Systementzug).
      // Solange die Seite sichtbar ist, läuft der Messlauf weiter – also einmal neu anfordern.
      if (env.isVisible()) reacquire();
    });
  };
  const reacquire = (): void => {
    // Nichts zu tun, solange die Sperre noch gehalten wird, eine Anforderung läuft, sie schon
    // abgelehnt wurde oder der Handle endgültig freigegeben ist.
    if (released || denied || requesting || reacquires >= MAX_REACQUIRES) return;
    if (sentinel !== null && !sentinel.released) return;
    requesting = true;
    reacquires += 1;
    try {
      void request('screen').then((next) => {
        requesting = false;
        if (released) {
          // Rennen: der Nutzer hat die Seite verlassen, bevor die neue Sperre eintraf.
          void next.release().catch(() => undefined);
          return;
        }
        watch(next);
        // Eine Sperre, die schon zurückgenommen eintrifft, ist keine gehaltene Sperre – sie als
        // `acquired` zu melden, machte den Report unwahr. Ein neuer Versuch käme hier in eine
        // Schleife; er kommt erst mit dem nächsten echten `release`-Ereignis.
        report(next.released ? 'released' : 'acquired');
      }, () => {
        requesting = false;
        denied = true;
        report('denied');
      });
    } catch {
      requesting = false;
      denied = true;
      report('denied');
    }
  };

  const handle: WakeLockHandle = {
    get state() { return current; },
    release() {
      if (released) return;
      released = true;
      for (const off of unsubscribe.splice(0)) off();
      const open = sentinel;
      sentinel = null;
      // Nur eine wirklich gehaltene Sperre wird als Freigabe gemeldet – sonst stünde nach der
      // automatischen Freigabe des Browsers ein zweites `wakelock:released` in der Zeitleiste.
      if (current === 'acquired') report('released');
      if (open !== null && !open.released) void open.release().catch(() => undefined);
    },
  };

  watch(sentinel);
  unsubscribe.push(env.on('visibilitychange', () => {
    if (!env.isVisible()) return;
    // Der Wechsel auf „sichtbar" ist eine Handlung des Nutzers: er hebt sowohl den `denied`-Riegel
    // als auch den Zähler auf. Eine Schleife kann daraus nicht werden – sie müsste jemand treten.
    denied = false;
    reacquires = 0;
    reacquire();
  }));
  unsubscribe.push(env.on('pagehide', () => { handle.release(); }));
  // Auch die erste Sperre kann schon zurückgenommen ankommen (Energiesparmodus beim Antippen).
  report(sentinel.released ? 'released' : 'acquired');
  return handle;
}
