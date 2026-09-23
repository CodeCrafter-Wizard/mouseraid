export type ErrorKind = 'error' | 'unhandledrejection' | 'webglcontextlost' | 'manual';

export interface ErrorEntry {
  at: string;
  kind: ErrorKind;
  message: string;
  stack?: string;
}

export interface ErrorLog {
  push(entry: ErrorEntry): void;
  entries(): readonly ErrorEntry[];
  clear(): void;
}

export interface DiagnosisInfo {
  buildId: string;
  url: string;
  userAgent: string;
  displayMode: string;
  online: boolean;
  swState: string;
}

/** Ringpuffer für die letzten Laufzeitfehler (für „Diagnose kopieren"). */
export function createErrorLog(max = 20): ErrorLog {
  let items: ErrorEntry[] = [];
  return {
    push(entry) {
      items.push(entry);
      if (items.length > max) items = items.slice(items.length - max);
    },
    entries: () => items,
    clear() {
      items = [];
    },
  };
}

/** Macht aus einem beliebigen geworfenen Wert Nachricht + optionalen Stack. */
export function describeError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return value.stack === undefined ? { message: value.message } : { message: value.message, stack: value.stack };
  }
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

/**
 * Kopierbarer Diagnose-Text: der Nutzer hat am Handy keine Konsole.
 * `scrub` säubert Nachricht und Stack – auf lab.html kann ein Laufzeitfehler eine echte Adresse
 * zitieren (SDP-Parserfehler), und „Diagnose kopieren" ist ein Kopierweg wie jeder andere. Der Kopf
 * bleibt unangetastet (Build, URL, User-Agent – dieselbe Ausnahmeliste wie in `redactReport`).
 */
export function formatDiagnosis(info: DiagnosisInfo, entries: readonly ErrorEntry[], scrub: (text: string) => string = (text) => text): string {
  const head = [
    'Mäusebau-Diagnose',
    `Build: ${info.buildId}`,
    `URL: ${info.url}`,
    `Anzeige: ${info.displayMode}`,
    `Online: ${info.online ? 'ja' : 'nein'}`,
    `Service Worker: ${info.swState}`,
    `Browser: ${info.userAgent}`,
    `Fehler: ${entries.length}`,
  ];
  const body = entries.map((e) => `\n${e.at} [${e.kind}] ${scrub(e.message)}${e.stack === undefined ? '' : `\n${scrub(e.stack)}`}`);
  return `${head.join('\n')}\n${body.join('\n')}`;
}
