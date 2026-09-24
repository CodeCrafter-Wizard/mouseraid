import { describe, expect, it } from 'vitest';
import {
  createExchangeMarks,
  createPairingTracker,
  EMPTY_PAIRING_MARKS,
  measuredPairing,
  projectLobbyFull,
  type PairingMarks,
  type PairingReport,
} from '../../../src/lab/pairing';

/** Verstellbare Uhr: `at(ms)` setzt den nächsten Rückgabewert. */
function fakeClock(): { now: () => number; at(ms: number): void } {
  let value = 0;
  return { now: () => value, at: (ms) => { value = ms; } };
}

const marks = (overrides: Partial<PairingMarks> = {}): PairingMarks => ({ ...EMPTY_PAIRING_MARKS, ...overrides });

describe('EMPTY_PAIRING_MARKS', () => {
  it('ist durchgehend null und lässt sich nicht verändern', () => {
    expect(EMPTY_PAIRING_MARKS).toEqual({
      offerShownAt: null,
      offerScannedMs: null,
      answerShownAt: null,
      answerScannedMs: null,
      connectedMs: null,
    });
    expect(Object.isFrozen(EMPTY_PAIRING_MARKS)).toBe(true);
  });
});

describe('createPairingTracker', () => {
  it('der erste mark() setzt den Nullpunkt und trägt 0', () => {
    const clock = fakeClock();
    clock.at(5000);
    const tracker = createPairingTracker(clock.now);
    tracker.mark('offerShownAt');
    expect(tracker.marks().offerShownAt).toBe(0);
  });

  it('spätere Marken zählen relativ zum ersten gezeigten Code, auf ganze ms gerundet', () => {
    const clock = fakeClock();
    clock.at(1000);
    const tracker = createPairingTracker(clock.now);
    tracker.mark('offerShownAt');
    clock.at(4200.4);
    tracker.mark('offerScannedMs');
    clock.at(9300.6);
    tracker.mark('connectedMs');
    expect(tracker.marks()).toEqual(marks({ offerShownAt: 0, offerScannedMs: 3200, connectedMs: 8301 }));
  });

  it('die erste Marke eines Namens gilt – ein zweites Anzeigen verkürzt keine Messung', () => {
    const clock = fakeClock();
    const tracker = createPairingTracker(clock.now);
    tracker.mark('offerShownAt');
    clock.at(7000);
    tracker.mark('offerShownAt');
    expect(tracker.marks().offerShownAt).toBe(0);
  });

  it('marks() liefert eine Kopie – wer sie verändert, erreicht den Tracker nicht', () => {
    const tracker = createPairingTracker(() => 0);
    tracker.mark('offerShownAt');
    const copy = tracker.marks();
    copy.offerShownAt = 999;
    expect(tracker.marks().offerShownAt).toBe(0);
  });

  it('report() hängt die Hochrechnung an dieselben Marken', () => {
    const clock = fakeClock();
    const tracker = createPairingTracker(clock.now);
    tracker.mark('offerShownAt');
    clock.at(4000);
    tracker.mark('offerScannedMs');
    clock.at(11_000);
    tracker.mark('connectedMs');
    expect(tracker.report()).toEqual({
      offerShownAt: 0,
      offerScannedMs: 4000,
      answerShownAt: null,
      answerScannedMs: null,
      connectedMs: 11_000,
      projectedLobbyFullMs: 6 * 4000 + 3 * 7000,
    });
  });
});

// „Neu verbinden" (Sperrtest, D9) beginnt einen NEUEN Austausch: seine Paarung ist neu zu messen.
// Der QR-Block des Clients lebt dabei weiter und hält seine Marken-Buchführung fest – deshalb zeigt er
// nicht auf einen bestimmten Tracker, sondern auf den JEWEILS aktuellen.
describe('createExchangeMarks', () => {
  it('reicht Marken an die aktuelle Buchführung weiter', () => {
    const clock = fakeClock();
    clock.at(1000);
    const exchange = createExchangeMarks(clock.now);
    exchange.mark('offerShownAt');
    clock.at(4000);
    exchange.mark('connectedMs');
    expect(exchange.marks()).toEqual(marks({ offerShownAt: 0, connectedMs: 3000 }));
    expect(exchange.report().projectedLobbyFullMs).toBeNull();
  });

  it('renew(): der neue Austausch beginnt leer und misst seinen eigenen Nullpunkt', () => {
    const clock = fakeClock();
    const exchange = createExchangeMarks(clock.now);
    exchange.mark('offerShownAt');
    clock.at(8000);
    exchange.mark('connectedMs');

    exchange.renew();
    expect(exchange.marks()).toEqual(EMPTY_PAIRING_MARKS);
    expect(exchange.report()).toEqual({ ...EMPTY_PAIRING_MARKS, projectedLobbyFullMs: null });

    // Ohne den frischen Tracker blieben die Marken des TOTEN Austauschs stehen (sie rasten je Name
    // ein) – der Report der neuen Verbindung zeigte dann die Paarungsdauer der alten.
    clock.at(20_000);
    exchange.mark('offerShownAt');
    clock.at(21_500);
    exchange.mark('connectedMs');
    expect(exchange.marks()).toEqual(marks({ offerShownAt: 0, connectedMs: 1500 }));
  });

  it('eine vor renew() gelesene Kopie bleibt unberührt – der alte Report behält seine Zahlen', () => {
    const exchange = createExchangeMarks(fakeClock().now);
    exchange.mark('answerShownAt');
    const before = exchange.report();
    exchange.renew();
    expect(before.answerShownAt).toBe(0);
    expect(exchange.marks().answerShownAt).toBeNull();
  });
});

describe('projectLobbyFull', () => {
  it('ohne connectedMs gibt es keine Hochrechnung', () => {
    expect(projectLobbyFull(marks({ offerShownAt: 0, offerScannedMs: 4000 }))).toBeNull();
  });

  it('ohne eine einzige messbare Scan-Dauer gibt es keine Hochrechnung', () => {
    expect(projectLobbyFull(marks({ connectedMs: 9000 }))).toBeNull();
    expect(projectLobbyFull(marks({ offerShownAt: 0, connectedMs: 9000 }))).toBeNull();
    expect(projectLobbyFull(marks({ offerScannedMs: 4000, connectedMs: 9000 }))).toBeNull();
  });

  it('eine Scan-Dauer: 6 × Dauer + 3 × Rest', () => {
    // d1 = 4000; Rest = 11000 − 4000 = 7000 → 6·4000 + 3·7000 = 45000
    expect(projectLobbyFull(marks({ offerShownAt: 0, offerScannedMs: 4000, connectedMs: 11_000 }))).toBe(45_000);
  });

  it('zwei Scan-Dauern: Median ist der Nearest-Rank-50 % (bei zwei Werten der kleinere)', () => {
    // d1 = 4000, d2 = 3000 → Median 3000; Rest = 11000 − 7000 = 4000 → 6·3000 + 3·4000 = 30000
    const both = marks({ offerShownAt: 0, offerScannedMs: 4000, answerShownAt: 5000, answerScannedMs: 8000, connectedMs: 11_000 });
    expect(projectLobbyFull(both)).toBe(30_000);
  });

  it('eine negative Differenz zählt nicht als Dauer', () => {
    const backwards = marks({ offerShownAt: 5000, offerScannedMs: 4000, answerShownAt: 5000, answerScannedMs: 8000, connectedMs: 11_000 });
    // nur d2 = 3000 zählt; Rest = 11000 − 3000 = 8000 → 6·3000 + 3·8000 = 42000
    expect(projectLobbyFull(backwards)).toBe(42_000);
  });

  it('eine Dauer von 0 zählt mit', () => {
    expect(projectLobbyFull(marks({ offerShownAt: 900, offerScannedMs: 900, connectedMs: 1000 }))).toBe(3000);
  });

  it('der Rest wird nie negativ', () => {
    // Summe der Dauern (9000) ist größer als connectedMs (5000) → Rest 0
    expect(projectLobbyFull(marks({ offerShownAt: 0, offerScannedMs: 9000, connectedMs: 5000 }))).toBe(54_000);
  });

  it('das Ergebnis ist ganzzahlig gerundet', () => {
    expect(projectLobbyFull(marks({ offerShownAt: 0, offerScannedMs: 100.5, connectedMs: 200.5 }))).toBe(Math.round(6 * 100.5 + 3 * 100));
  });
});

describe('measuredPairing', () => {
  const report = (overrides: Partial<PairingReport> = {}): PairingReport => ({
    ...EMPTY_PAIRING_MARKS,
    projectedLobbyFullMs: null,
    ...overrides,
  });

  it('ohne einen einzigen gezeigten Code gab es keine Paarung – null statt lauter Nullen', () => {
    expect(measuredPairing(report())).toBeNull();
    // Auch „verbunden" allein ist keine Paarung: gezeigt wurde nie etwas (Text-Pfad von Anfang an).
    expect(measuredPairing(report({ connectedMs: 9000 }))).toBeNull();
  });

  it('ein gezeigtes Angebot genügt – der Bericht kommt unverändert zurück', () => {
    const shown = report({ offerShownAt: 0, connectedMs: 9000 });
    expect(measuredPairing(shown)).toBe(shown);
  });

  it('auch eine nur gezeigte Antwort zählt (der Client zeigt zuerst die Antwort)', () => {
    const shown = report({ answerShownAt: 0 });
    expect(measuredPairing(shown)).toBe(shown);
  });
});
