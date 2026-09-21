import { describe, expect, it } from 'vitest';
import { computePingStats, type PingSample } from '../../../src/net/pingTest';

/** Proben mit seq 0,1,2,… in Ankunftsreihenfolge. */
const inOrder = (...rtts: number[]): PingSample[] => rtts.map((rttMs, seq) => ({ seq, rttMs }));

describe('computePingStats', () => {
  it('liefert bei sent 0 lauter Nullen – auch lossPct', () => {
    expect(computePingStats(0, [])).toEqual({
      sent: 0, received: 0, lossPct: 0, minMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, outOfOrder: 0,
    });
  });

  it('liefert ohne Antworten 100 % Verlust und Zeitwerte 0', () => {
    expect(computePingStats(10, [])).toEqual({
      sent: 10, received: 0, lossPct: 100, minMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, outOfOrder: 0,
    });
  });

  it('bestimmt min, Median, p95 und max auf den SORTIERTEN RTTs', () => {
    const stats = computePingStats(3, inOrder(30, 10, 20));

    expect(stats).toEqual({
      sent: 3, received: 3, lossPct: 0, minMs: 10, medianMs: 20, p95Ms: 30, maxMs: 30, outOfOrder: 0,
    });
  });

  it('Nearest-Rank: bei gerader Anzahl ist der Median der UNTERE mittlere Wert', () => {
    const stats = computePingStats(4, inOrder(40, 10, 30, 20));

    expect(stats.medianMs).toBe(20);
    expect(stats.p95Ms).toBe(40);
  });

  it('Nearest-Rank: p95 von 1…100 ist 95, von 1…20 ist 19', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);

    expect(computePingStats(100, inOrder(...hundred))).toMatchObject({ medianMs: 50, p95Ms: 95, minMs: 1, maxMs: 100 });
    expect(computePingStats(20, inOrder(...twenty))).toMatchObject({ medianMs: 10, p95Ms: 19 });
  });

  it('eine einzelne Probe ist zugleich min, Median, p95 und max', () => {
    expect(computePingStats(1, inOrder(12.5))).toMatchObject({ minMs: 12.5, medianMs: 12.5, p95Ms: 12.5, maxMs: 12.5 });
  });

  it('rundet lossPct auf eine Nachkommastelle', () => {
    expect(computePingStats(3, inOrder(5, 5)).lossPct).toBe(33.3);
    expect(computePingStats(7, inOrder(5, 5, 5, 5, 5, 5)).lossPct).toBe(14.3);
    expect(computePingStats(200, inOrder(...Array.from({ length: 197 }, () => 5))).lossPct).toBe(1.5);
  });

  it('zählt als outOfOrder jede Probe, deren seq kleiner ist als eine zuvor angekommene', () => {
    const swapped: PingSample[] = [0, 1, 3, 2, 4].map((seq) => ({ seq, rttMs: 5 }));
    const reversed: PingSample[] = [2, 1, 0].map((seq) => ({ seq, rttMs: 5 }));

    expect(computePingStats(5, swapped).outOfOrder).toBe(1);
    expect(computePingStats(3, reversed).outOfOrder).toBe(2);
  });

  it('zählt Duplikate (gleiche seq) nur einmal – die erste Ankunft gilt', () => {
    const samples: PingSample[] = [
      { seq: 0, rttMs: 10 },
      { seq: 1, rttMs: 20 },
      { seq: 1, rttMs: 999 },
      { seq: 2, rttMs: 30 },
      { seq: 1, rttMs: 999 },
    ];

    expect(computePingStats(3, samples)).toEqual({
      sent: 3, received: 3, lossPct: 0, minMs: 10, medianMs: 20, p95Ms: 30, maxMs: 30, outOfOrder: 0,
    });
  });

  it('meldet nie negativen Verlust, selbst wenn mehr Proben als Pings übergeben werden', () => {
    expect(computePingStats(1, inOrder(5, 6)).lossPct).toBe(0);
  });

  it('verändert die übergebene Liste nicht', () => {
    const samples = inOrder(30, 10, 20);

    computePingStats(3, samples);

    expect(samples.map((sample) => sample.rttMs)).toEqual([30, 10, 20]);
  });
});
