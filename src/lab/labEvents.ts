import { createTimeline, type Timeline } from '../net/timeline';

/**
 * Seiten-Ereignisse des Labors: Wake Lock und Kamera-Spuren gehören zum SEITENAUFRUF, nicht zu einer
 * einzelnen Verbindung – sie entstehen, bevor der erste Platz existiert, und betreffen danach jeden.
 * `finishRun` schreibt sie deshalb in die Zeitleiste jedes Laufs, so wie die Kamera-Zeile aus M1.
 * Rein (DOM-frei), damit der Puffer ohne Browser testbar bleibt.
 *
 * Die Zeit im Eintrag ist die des Laufs, nicht die des Ereignisses: eine Zeitleiste beginnt erst mit
 * ihrer Verbindung, ein früheres Seiten-Ereignis hat dort keinen eigenen Zeitpunkt.
 */
export interface LabEvent {
  kind: string;
  detail: string;
}

/** Deckel gegen eine flatternde Kamera-Spur; ältere Einträge fallen heraus. */
const MAX_EVENTS = 200;

const events: LabEvent[] = [];
/** Wie viele Einträge vorne herausgefallen sind – hält die Merker unten in globaler Zählung. */
let dropped = 0;
let flushedUpTo = new WeakMap<Timeline, number>();

/**
 * NUR für Tests: leert den Seiten-Puffer samt Buchführung. Im Browser gibt es diesen Zustand genau
 * einmal je Seitenaufruf, und nichts darf ihn dort zurücksetzen – ein Report soll jedes Ereignis
 * dieses Aufrufs zeigen. In Vitest teilen sich dagegen alle Tests EIN Modul: ohne diese Naht hinge
 * das Ergebnis eines Kamera-Tests daran, welcher Test vor ihm lief.
 */
export function resetLabEvents(): void {
  events.length = 0;
  dropped = 0;
  flushedUpTo = new WeakMap<Timeline, number>();
}

export function recordLabEvent(kind: string, detail = ''): void {
  events.push({ kind, detail });
  if (events.length > MAX_EVENTS) {
    const surplus = events.length - MAX_EVENTS;
    dropped += surplus;
    events.splice(0, surplus);
  }
}

/** Schreibt alle Ereignisse in die Zeitleiste, die DIESE Zeitleiste noch nicht bekommen hat. */
export function flushLabEvents(timeline: Timeline): void {
  const from = Math.max(flushedUpTo.get(timeline) ?? 0, dropped);
  for (const event of events.slice(from - dropped)) timeline.push(event.kind, event.detail);
  flushedUpTo.set(timeline, dropped + events.length);
}

/**
 * Zeitleiste, die puffert, bis es die echte gibt. Der Client scannt das Angebot, BEVOR `acceptOffer`
 * seine Zeitleiste anlegt – ohne Puffer fehlten `qr:backend` und `qr:decoded` des Angebots-Scans
 * genau in dem Report, der sie belegen soll. Zweiter Puffer derselben Art wie oben, deshalb hier und
 * nicht in einem DOM-Modul: `connectPanels.ts` soll keine eigene Ereignis-Mechanik bekommen.
 * Die Zeitstempel entstehen beim Nachtragen; gemessen wird die Paarung ohnehin über `PairingMarks`.
 *
 * Der Puffer sammelt JEDEN Eintrag weiter, auch nach dem Andocken – ein zweiter Versuch legt eine
 * ZWEITE Zeitleiste an (erneutes `acceptOffer` nach „Erneut scannen"), und die soll den ganzen
 * bisherigen Verlauf bekommen, nicht nur den Teil vor dem ersten Andocken. Wer wie viel davon schon
 * hat, steht je Zeitleiste in `seen` – dieselbe Buchführung wie `flushedUpTo` oben, damit ein
 * zweites Andocken derselben Zeitleiste nichts doppelt. Geschrieben wird immer nur in die NEUESTE.
 * Die Ausnahme ist `reset()`: „Neu verbinden" beginnt einen NEUEN Austausch, und der erbt nichts.
 */
export function createRelayTimeline(now: () => number): { timeline: Timeline; drainInto(target: Timeline): void; reset(): void } {
  let buffer = createTimeline(now);
  let seen = new WeakMap<Timeline, number>();
  let target: Timeline | null = null;
  return {
    timeline: {
      push: (kind, detail) => {
        buffer.push(kind, detail);
        if (target === null) return;
        target.push(kind, detail);
        // Das Ziel hat den Eintrag schon – ohne diese Zeile bekäme es ihn beim nächsten Andocken erneut.
        seen.set(target, buffer.events().length);
      },
      events: () => (target ?? buffer).events(),
    },
    drainInto(next) {
      const events = buffer.events();
      for (const event of events.slice(seen.get(next) ?? 0)) next.push(event.kind, event.detail);
      seen.set(next, events.length);
      target = next;
    },
    /**
     * „Neu verbinden" (Sperrtest, D9): ab hier zählt nur noch der frische Austausch. Frischer Puffer,
     * frische Buchführung, kein Ziel – sonst trüge der Report der neuen Verbindung die `qr:error`s des
     * toten Peers und damit ein F9, das mit ihr nichts zu tun hat. Der zweite Versuch am SELBEN
     * Austausch („Erneut scannen") geht weiterhin durch `drainInto` und behält alles (D7).
     */
    reset() {
      buffer = createTimeline(now);
      seen = new WeakMap<Timeline, number>();
      target = null;
    },
  };
}
