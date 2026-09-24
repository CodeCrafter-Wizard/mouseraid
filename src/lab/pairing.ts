// Paarungs-Marken des QR-Pfads und die Hochrechnung „Zeit bis Lobby voll".
// REIN und DOM-frei: kein Import aus scannerAdapter/camera/qrRender/qrPanels, die Uhr wird injiziert –
// nur so bleibt die Rechnung mit einer Attrappen-Uhr prüfbar (Global Constraints, M2-Plan).

export interface PairingMarks {
  offerShownAt: number | null;
  offerScannedMs: number | null;
  answerShownAt: number | null;
  answerScannedMs: number | null;
  /** alle in ms RELATIV zum ersten gezeigten QR-Code. */
  connectedMs: number | null;
}

export interface PairingReport extends PairingMarks {
  projectedLobbyFullMs: number | null;
}

export interface PairingTracker {
  mark(name: keyof PairingMarks): void;
  marks(): PairingMarks;
  report(): PairingReport;
}

export const EMPTY_PAIRING_MARKS: PairingMarks = Object.freeze({
  offerShownAt: null,
  offerScannedMs: null,
  answerShownAt: null,
  answerScannedMs: null,
  connectedMs: null,
});

/** Die Lobby ist mit 3 Clients voll; jeder kostet 2 Scans (Angebot + Antwort). */
const CLIENTS = 3;
const SCANS_PER_CLIENT = 2;

/**
 * Nearest-Rank-50 % über die aufsteigend sortierten Werte – dieselbe Regel wie `computePingStats`
 * in src/net/pingTest.ts. Bei zwei Messwerten ist das der kleinere: mit so wenigen Proben ist der
 * Mittelwert leichter von einem einzelnen Ausrutscher zu verziehen als der Rang.
 */
function nearestRank50(sortedAscending: readonly number[]): number {
  const rank = Math.max(1, Math.ceil(sortedAscending.length / 2));
  return sortedAscending[rank - 1] ?? 0;
}

/** Eine messbare Scan-Dauer: beide Marken gesetzt und die Differenz nicht negativ. */
function duration(shownAt: number | null, scannedMs: number | null): number | null {
  if (shownAt === null || scannedMs === null) return null;
  const value = scannedMs - shownAt;
  return value >= 0 ? value : null;
}

/**
 * Hochrechnung „Zeit bis Lobby voll" = 3 Clients × 2 Scans = 6 Scans plus dreimal alles, was NICHT
 * Scannen war (Gathering, ICE, Tippen). Der Rest wird aus DIESEM Lauf abgeleitet: was zwischen dem
 * ersten gezeigten Code und „verbunden" liegt und nicht auf eine gemessene Scan-Dauer entfällt.
 * @returns null, wenn die Verbindung nie zustande kam oder keine einzige Scan-Dauer messbar war.
 */
export function projectLobbyFull(marks: PairingMarks): number | null {
  if (marks.connectedMs === null) return null;
  const durations = [duration(marks.offerShownAt, marks.offerScannedMs), duration(marks.answerShownAt, marks.answerScannedMs)]
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const median = nearestRank50(durations);
  const scanned = durations.reduce((sum, value) => sum + value, 0);
  const rest = Math.max(0, marks.connectedMs - scanned);
  return Math.round(CLIENTS * SCANS_PER_CLIENT * median + CLIENTS * rest);
}

/**
 * Eine Paarung, die nie einen Code gezeigt hat, ist keine Messung: Der Nutzer war von Anfang an auf
 * dem Text-Pfad, und ein Bericht aus lauter Nullen behauptete eine Paarungsdauer, die es nie gab.
 * @returns den Bericht unverändert, sobald mindestens ein Code gezeigt wurde – sonst null.
 */
export function measuredPairing(report: PairingReport): PairingReport | null {
  return report.offerShownAt === null && report.answerShownAt === null ? null : report;
}

/**
 * Sammelt die Marken einer Paarung. Der ERSTE `mark()` setzt den Nullpunkt (= erster gezeigter
 * QR-Code) und trägt deshalb 0. Je Name gilt die ERSTE Marke: ein zweites Anzeigen desselben Codes
 * (Overlay, Neuzeichnen) darf die gemessene Dauer nicht nachträglich verkürzen.
 */
export function createPairingTracker(now: () => number): PairingTracker {
  const values: PairingMarks = { ...EMPTY_PAIRING_MARKS };
  let zero: number | null = null;
  const marks = (): PairingMarks => ({ ...values });
  return {
    mark(name) {
      if (values[name] !== null) return;
      zero ??= now();
      values[name] = Math.round(now() - zero);
    },
    marks,
    report: () => ({ ...values, projectedLobbyFullMs: projectLobbyFull(values) }),
  };
}
