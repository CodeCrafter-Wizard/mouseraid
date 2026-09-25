import { describe, expect, it } from 'vitest';
import { BalanceError, loadBalance } from '../../../../src/core/data/balanceLoad';
import realBalance from '../../../../src/data/balance.json';
import testBalance from '../../../fixtures/core/test-balance.json';

type Json = Record<string, unknown>;

/** Tiefe Kopie der eingefrorenen Fixture, danach EINE gezielte Verletzung. */
function variant(patch: (balance: Json) => void): Json {
  const copy = JSON.parse(JSON.stringify(testBalance)) as Json;
  patch(copy);
  return copy;
}

function sub(source: Json, key: string): Json {
  return source[key] as Json;
}

/** Liefert den Feldpfad des geworfenen BalanceError – oder scheitert, wenn nichts geworfen wurde. */
function errorPath(json: unknown): string {
  try {
    loadBalance(json);
  } catch (error) {
    if (error instanceof BalanceError) return error.path;
    throw error;
  }
  throw new Error('loadBalance hat nicht geworfen');
}

describe('loadBalance – Umrechnung (gepinnt, Vertrag)', () => {
  const balance = loadBalance(testBalance);

  it('tickRate bleibt stehen, Sekunden werden zu Ticks', () => {
    expect(balance.tickRate).toBe(30);
    expect(balance.dayTicks).toBe(60); // 2 s * 30
    expect(balance.nightTicks).toBe(90); // 3 s * 30
  });

  it('Tempo: cm/s / (10 * tickRate) – 60 cm/s ergibt 0.2 u/Tick', () => {
    expect(balance.mouse.walkSpeed).toBe(0.2);
    expect(balance.mouse.sprintSpeed).toBe(0.4); // walkSpeed * sprintMul 2
    expect(balance.mouse.sneakSpeed).toBe(0.1); // walkSpeed * sneakBelowRatio 0.5
  });

  it('Beschleunigung: cm/s² / (10 * tickRate²) – 900 ergibt 0.1 u/Tick²', () => {
    expect(balance.mouse.accel).toBe(0.1);
  });

  it('Längen: cm / 10, und yRange steht auf dem Boden', () => {
    expect(balance.mouse.radius).toBe(0.5);
    expect(balance.mouse.height).toBe(0.8);
    expect(balance.mouse.yRange).toEqual({ y0: 0, y1: 0.8 });
    expect(balance.cat.radius).toBe(1);
    expect(balance.cat.height).toBe(2.5);
    expect(balance.cat.yRange).toEqual({ y0: 0, y1: 2.5 });
  });

  it('Verhältnisse werden unverändert durchgereicht', () => {
    expect(balance.mouse.friction).toBe(0.5);
    expect(balance.mouse.weakenedMul).toBe(0.5);
    expect(balance.mouse.deadZone).toBe(0.2);
    expect(balance.mouse.sprintRingMag).toBe(0.9);
    expect(balance.mouse.loudSneak).toBe(0.1);
    expect(balance.mouse.loudWalk).toBe(0.4);
    expect(balance.mouse.loudSprint).toBe(0.9);
    expect(balance.noiseEventMinLoudness).toBe(0.5);
  });

  it('die Roh-Verhältnisse sind aufgebraucht: sprintMul und sneakBelowRatio stehen nicht mehr im Ergebnis', () => {
    const asRecord = balance.mouse as unknown as Json;
    expect(asRecord['sprintMul']).toBeUndefined();
    expect(asRecord['sneakBelowRatio']).toBeUndefined();
  });
});

describe('loadBalance – Feldverwechslungen zwischen gleichwertigen Rohwerten', () => {
  // Die Fixture setzt mehrere Rohfelder absichtlich auf denselben Wert (0.5 bzw. 0.9, siehe
  // Kommentar oben in der Fixture), damit ist ein stiller Tausch zweier Ausgabefelder im
  // Rueckgabeobjekt (z. B. `friction: weakenedMul` statt `friction: frictionPerTick`) fuer die
  // obigen Tests unsichtbar: beide Ausgabefelder blieben bei 0.5 bzw. 0.9 stehen. Jeder Test
  // hier variiert GENAU EIN Rohfeld eines Paars und prueft, dass NUR das dazugehoerige
  // Ausgabefeld sich aendert, waehrend das gleichwertige Feld unveraendert bleibt.

  it('weakenedMul aendert sich, friction (frictionPerTick) bleibt stehen', () => {
    const mouse = loadBalance(variant((b) => { sub(b, 'mouse')['weakenedMul'] = 0.25; })).mouse;
    expect(mouse.weakenedMul).toBe(0.25);
    expect(mouse.friction).toBe(0.5);
  });

  it('frictionPerTick aendert sich, weakenedMul bleibt stehen', () => {
    const mouse = loadBalance(variant((b) => { sub(b, 'mouse')['frictionPerTick'] = 0.75; })).mouse;
    expect(mouse.friction).toBe(0.75);
    expect(mouse.weakenedMul).toBe(0.5);
  });

  it('sneakBelowRatio wirkt nur auf sneakSpeed, friction und weakenedMul bleiben stehen', () => {
    const mouse = loadBalance(variant((b) => { sub(b, 'mouse')['sneakBelowRatio'] = 0.25; })).mouse;
    expect(mouse.sneakSpeed).toBeCloseTo(0.05, 12); // walkSpeed 0.2 * 0.25
    expect(mouse.friction).toBe(0.5);
    expect(mouse.weakenedMul).toBe(0.5);
  });

  it('sprintRingMag aendert sich, loudSprint (loudness.sprint) bleibt stehen', () => {
    const mouse = loadBalance(variant((b) => { sub(b, 'mouse')['sprintRingMag'] = 0.85; })).mouse;
    expect(mouse.sprintRingMag).toBe(0.85);
    expect(mouse.loudSprint).toBe(0.9);
  });

  it('loudness.sprint (loudSprint) aendert sich, sprintRingMag bleibt stehen', () => {
    const mouse = loadBalance(variant((b) => { sub(sub(b, 'mouse'), 'loudness')['sprint'] = 0.6; })).mouse;
    expect(mouse.loudSprint).toBe(0.6);
    expect(mouse.sprintRingMag).toBe(0.9);
  });
});

describe('loadBalance – die echte (provisorische) Balance', () => {
  const balance = loadBalance(realBalance);

  it('300 s ergeben 9000 Ticks je Phase', () => {
    expect(balance.dayTicks).toBe(9000);
    expect(balance.nightTicks).toBe(9000);
  });

  it('R1: 100 cm/s Gehen, Sprint x1.8, 600 cm/s² Beschleunigung', () => {
    expect(balance.mouse.walkSpeed).toBeCloseTo(1 / 3, 12);
    expect(balance.mouse.sprintSpeed).toBeCloseTo(0.6, 12);
    expect(balance.mouse.accel).toBeCloseTo(1 / 15, 12);
  });

  it('die Fixture unterscheidet sich von der echten Balance (CLAUDE.md: Golden gegen Fixtures)', () => {
    expect(testBalance).not.toEqual(realBalance);
    expect(testBalance.mouse.walkCmPerS).not.toBe(realBalance.mouse.walkCmPerS);
    expect(testBalance.dayLengthS).not.toBe(realBalance.dayLengthS);
    expect(testBalance.cat.heightCm).not.toBe(realBalance.cat.heightCm);
  });
});

describe('loadBalance – jede Wurf-Bedingung mit ihrem Feldpfad', () => {
  const CASES: readonly { readonly name: string; readonly json: unknown; readonly path: string }[] = [
    { name: 'null statt Objekt', json: null, path: '' },
    { name: 'Liste statt Objekt', json: [], path: '' },
    { name: 'Zahl statt Objekt', json: 42, path: '' },
    { name: 'tickRate fehlt', json: variant((b) => { delete b['tickRate']; }), path: 'tickRate' },
    { name: 'tickRate ist eine Zeichenkette', json: variant((b) => { b['tickRate'] = '30'; }), path: 'tickRate' },
    { name: 'tickRate ist nicht 30', json: variant((b) => { b['tickRate'] = 60; }), path: 'tickRate' },
    { name: 'dayLengthS ist 0', json: variant((b) => { b['dayLengthS'] = 0; }), path: 'dayLengthS' },
    { name: 'dayLengthS ergibt keinen ganzen Tick', json: variant((b) => { b['dayLengthS'] = 0.01; }), path: 'dayLengthS' },
    { name: 'dayLengthS ist unendlich', json: variant((b) => { b['dayLengthS'] = Number.POSITIVE_INFINITY; }), path: 'dayLengthS' },
    { name: 'nightLengthS ist negativ', json: variant((b) => { b['nightLengthS'] = -1; }), path: 'nightLengthS' },
    { name: 'noiseEventMinLoudness über 1', json: variant((b) => { b['noiseEventMinLoudness'] = 1.5; }), path: 'noiseEventMinLoudness' },
    { name: 'mouse fehlt', json: variant((b) => { delete b['mouse']; }), path: 'mouse' },
    { name: 'mouse.radiusCm ist 0', json: variant((b) => { sub(b, 'mouse')['radiusCm'] = 0; }), path: 'mouse.radiusCm' },
    { name: 'mouse.radiusCm ist NaN', json: variant((b) => { sub(b, 'mouse')['radiusCm'] = Number.NaN; }), path: 'mouse.radiusCm' },
    { name: 'mouse.heightCm ist negativ', json: variant((b) => { sub(b, 'mouse')['heightCm'] = -2; }), path: 'mouse.heightCm' },
    { name: 'mouse.walkCmPerS ist 0', json: variant((b) => { sub(b, 'mouse')['walkCmPerS'] = 0; }), path: 'mouse.walkCmPerS' },
    { name: 'mouse.sprintMul unter 1', json: variant((b) => { sub(b, 'mouse')['sprintMul'] = 0.9; }), path: 'mouse.sprintMul' },
    { name: 'mouse.accelCmPerS2 ist 0', json: variant((b) => { sub(b, 'mouse')['accelCmPerS2'] = 0; }), path: 'mouse.accelCmPerS2' },
    { name: 'mouse.frictionPerTick ist 0', json: variant((b) => { sub(b, 'mouse')['frictionPerTick'] = 0; }), path: 'mouse.frictionPerTick' },
    { name: 'mouse.frictionPerTick über 1', json: variant((b) => { sub(b, 'mouse')['frictionPerTick'] = 1.2; }), path: 'mouse.frictionPerTick' },
    { name: 'mouse.sneakBelowRatio über 1', json: variant((b) => { sub(b, 'mouse')['sneakBelowRatio'] = 1.1; }), path: 'mouse.sneakBelowRatio' },
    { name: 'mouse.weakenedMul ist negativ', json: variant((b) => { sub(b, 'mouse')['weakenedMul'] = -0.1; }), path: 'mouse.weakenedMul' },
    { name: 'mouse.deadZone über 1', json: variant((b) => { sub(b, 'mouse')['deadZone'] = 1.4; }), path: 'mouse.deadZone' },
    { name: 'mouse.deadZone erreicht sprintRingMag', json: variant((b) => { sub(b, 'mouse')['deadZone'] = 0.9; }), path: 'mouse.deadZone' },
    { name: 'mouse.sprintRingMag über 1', json: variant((b) => { sub(b, 'mouse')['sprintRingMag'] = 1.4; }), path: 'mouse.sprintRingMag' },
    { name: 'mouse.loudness fehlt', json: variant((b) => { delete sub(b, 'mouse')['loudness']; }), path: 'mouse.loudness' },
    { name: 'mouse.loudness.sneak ist null', json: variant((b) => { sub(sub(b, 'mouse'), 'loudness')['sneak'] = null; }), path: 'mouse.loudness.sneak' },
    { name: 'mouse.loudness.walk über 1', json: variant((b) => { sub(sub(b, 'mouse'), 'loudness')['walk'] = 2; }), path: 'mouse.loudness.walk' },
    { name: 'mouse.loudness.sprint ist negativ', json: variant((b) => { sub(sub(b, 'mouse'), 'loudness')['sprint'] = -0.5; }), path: 'mouse.loudness.sprint' },
    { name: 'cat fehlt', json: variant((b) => { delete b['cat']; }), path: 'cat' },
    { name: 'cat.radiusCm ist 0', json: variant((b) => { sub(b, 'cat')['radiusCm'] = 0; }), path: 'cat.radiusCm' },
    { name: 'cat.heightCm ist 0', json: variant((b) => { sub(b, 'cat')['heightCm'] = 0; }), path: 'cat.heightCm' },
  ];

  it.each(CASES)('$name -> BalanceError auf "$path"', ({ json, path }) => {
    expect(() => loadBalance(json)).toThrow(BalanceError);
    expect(errorPath(json)).toBe(path);
  });

  it('die Fehlermeldung nennt den Feldpfad', () => {
    const bad = variant((b) => { sub(b, 'mouse')['radiusCm'] = 0; });
    expect(() => loadBalance(bad)).toThrow(/^mouse\.radiusCm: /);
  });

  it('frictionPerTick = 1 ist erlaubt (halboffenes Intervall (0,1])', () => {
    const ok = variant((b) => { sub(b, 'mouse')['frictionPerTick'] = 1; });
    expect(loadBalance(ok).mouse.friction).toBe(1);
  });

  it('unbekannte Zusatzfelder stören nicht', () => {
    const ok = variant((b) => { b['_spaeteresFeld'] = 'egal'; });
    expect(loadBalance(ok).tickRate).toBe(30);
  });
});
