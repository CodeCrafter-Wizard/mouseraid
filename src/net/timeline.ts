// Zeitleiste eines Verbindungsversuchs. Reine Logik: die Uhr wird injiziert (im Browser
// `() => performance.now()`, im Test eine verstellbare Attrappe).

export interface TimelineEvent {
  /** ganze Millisekunden seit `createTimeline`. */
  tMs: number;
  kind: string;
  detail: string;
}

export interface Timeline {
  push(kind: string, detail?: string): void;
  events(): readonly TimelineEvent[];
}

export function createTimeline(now: () => number): Timeline {
  const startedAt = now();
  const items: TimelineEvent[] = [];
  return {
    push(kind, detail = '') {
      items.push({ tMs: Math.round(now() - startedAt), kind, detail });
    },
    // Kopie samt Einträgen: wer das Ergebnis verändert (Report, UI), erreicht die Zeitleiste nicht.
    events: () => items.map((event) => ({ ...event })),
  };
}
