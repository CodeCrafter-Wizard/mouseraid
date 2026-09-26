import { describe, expect, it } from 'vitest';
import {
  createPanelMeter,
  FPS_LIMIT_HALF,
  medianOf,
  PANEL_HZ_UNKNOWN,
  PANEL_SAMPLE_FRAMES,
  PANEL_WARMUP_FRAMES,
  panelHzFromDeltas,
  renderDivider,
  TARGET_HZ,
} from '../../../src/render/cadence';

describe('renderDivider', () => {
  it('hält die Konstanten des Vertrags', () => {
    expect(TARGET_HZ).toBe(60);
    expect(PANEL_WARMUP_FRAMES).toBe(10);
    expect(PANEL_SAMPLE_FRAMES).toBe(60);
    expect(PANEL_HZ_UNKNOWN).toBe(0);
    expect(FPS_LIMIT_HALF).toBe(30);
  });

  // Die gepinnte Tabelle aus Q1. `floor`, NICHT `round`: mit `round` ergäbe 90 Hz den Teiler 2 und
  // damit 45 fps – die Spec will „90 ungedrosselt". Genau daran ist der Prototyp gescheitert.
  it.each([
    [60, 1],
    [90, 1],
    [100, 1],
    [120, 2],
    [137, 2],
    [144, 2],
    [240, 4],
  ])('%s Hz ergibt den Teiler %s', (panelHz, expected) => {
    expect(renderDivider(panelHz)).toBe(expected);
  });

  it('unter 60 Hz bleibt der Teiler 1 – ein langsames Panel wird nicht noch gedrosselt', () => {
    expect(renderDivider(59)).toBe(1);
    expect(renderDivider(30)).toBe(1);
  });

  // M17 darf die Rate halbieren; der Teiler verdoppelt sich dafür.
  it.each([
    [60, 2],
    [120, 4],
    [240, 8],
  ])('mit fpsLimit 30 ergibt %s Hz den Teiler %s', (panelHz, expected) => {
    expect(renderDivider(panelHz, FPS_LIMIT_HALF)).toBe(expected);
  });

  it('jeder andere fpsLimit-Wert lässt den Teiler in Ruhe', () => {
    expect(renderDivider(120, 0)).toBe(2);
    expect(renderDivider(120, 60)).toBe(2);
    expect(renderDivider(120, undefined)).toBe(2);
  });

  // Solange die Panel-Rate nicht gemessen ist (PANEL_HZ_UNKNOWN, auch bei `?clock=manual`), fehlt
  // die Grundlage zum Drosseln – dann wird JEDES Bild gezeichnet, auch mit fpsLimit.
  it.each([PANEL_HZ_UNKNOWN, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'ein panelHz von %s ergibt den Teiler 1',
    (panelHz) => {
      expect(renderDivider(panelHz)).toBe(1);
      expect(renderDivider(panelHz, FPS_LIMIT_HALF)).toBe(1);
    },
  );
});

describe('medianOf', () => {
  it('liefert bei leerer Liste 0', () => {
    expect(medianOf([])).toBe(0);
  });

  it('liefert bei einem Wert den Wert', () => {
    expect(medianOf([7.5])).toBe(7.5);
  });

  it('nimmt bei gerader Länge das Mittel der beiden Mittleren', () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([10, 20])).toBe(15);
  });

  it('sortiert numerisch, nicht als Zeichenkette', () => {
    // Ein `.sort()` ohne Vergleichsfunktion ergäbe hier 100 statt 9.
    expect(medianOf([9, 100, 8])).toBe(9);
  });

  it('lässt die Liste des Aufrufers unverändert – der Median läuft über eine Kopie', () => {
    const deltas = [3, 1, 2];
    medianOf(deltas);
    expect(deltas).toEqual([3, 1, 2]);
  });
});

describe('panelHzFromDeltas', () => {
  it('rechnet den Median in eine ganze Hertz-Zahl um', () => {
    // GEMESSEN: dieser PC 7,30 ms Median -> 137 Hz; Headless 16,67 ms -> 60 Hz.
    expect(panelHzFromDeltas([7.3, 7.3, 7.3])).toBe(137);
    expect(panelHzFromDeltas([1000 / 60])).toBe(60);
    expect(panelHzFromDeltas([8, 8, 8, 8])).toBe(125);
  });

  it('meldet einen unbrauchbaren Median als PANEL_HZ_UNKNOWN', () => {
    expect(panelHzFromDeltas([])).toBe(PANEL_HZ_UNKNOWN);
    expect(panelHzFromDeltas([0, 0, 0])).toBe(PANEL_HZ_UNKNOWN);
    expect(panelHzFromDeltas([-4, -4])).toBe(PANEL_HZ_UNKNOWN);
  });
});

describe('createPanelMeter', () => {
  it('verwirft 10 Bilder und sammelt dann 60', () => {
    const meter = createPanelMeter();
    for (let i = 0; i < PANEL_WARMUP_FRAMES; i += 1) meter.push(999);
    expect(meter.ready()).toBe(false);
    expect(meter.hz()).toBe(PANEL_HZ_UNKNOWN);

    for (let i = 0; i < PANEL_SAMPLE_FRAMES - 1; i += 1) meter.push(8);
    expect(meter.ready()).toBe(false);
    expect(meter.hz()).toBe(PANEL_HZ_UNKNOWN);

    meter.push(8);
    expect(meter.ready()).toBe(true);
    // Die zehn Aufwärmwerte (999 ms) sind draußen – sonst stünde hier nicht 125 Hz.
    expect(meter.hz()).toBe(125);
  });

  it('bleibt nach dem Messen stehen, bis restart() neu sammelt', () => {
    const meter = createPanelMeter(2, 3);
    for (let i = 0; i < 2; i += 1) meter.push(999);
    meter.push(10);
    meter.push(10);
    meter.push(10);
    expect(meter.hz()).toBe(100);

    meter.push(4);
    expect(meter.hz()).toBe(100);

    meter.restart();
    expect(meter.ready()).toBe(false);
    expect(meter.hz()).toBe(PANEL_HZ_UNKNOWN);
    for (let i = 0; i < 2; i += 1) meter.push(999);
    meter.push(4);
    meter.push(4);
    meter.push(4);
    expect(meter.hz()).toBe(250);
  });
});
