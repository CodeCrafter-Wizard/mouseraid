import { describe, expect, it } from 'vitest';
import {
  devicePixels,
  hardwareScaling,
  QUALITY_TIERS,
  TIER_MAX_DPR,
  tierIndex,
  type QualityTier,
} from '../../../src/render/quality';

describe('Qualitätsstufen', () => {
  it('hält drei Stufen in aufsteigender Reihenfolge', () => {
    expect(QUALITY_TIERS).toEqual(['low', 'medium', 'high']);
    expect(TIER_MAX_DPR).toEqual({ low: 1, medium: 1.5, high: 2 });
  });

  // Die Tabelle ist die eigentliche Zusicherung: am Entwicklungsrechner ist DPR 1,0 (gemessen
  // 1,0000000149), dort ergeben alle drei Stufen dasselbe Bild. Nur die reine Funktion kann zeigen,
  // dass die Stufen überhaupt auseinanderliegen.
  it.each<[QualityTier, number]>([
    ['low', 1],
    ['medium', 1.5],
    ['high', 2],
  ])('bei dpr 2,5 liefert %s %s Gerätepixel', (tier, expected) => {
    expect(devicePixels(tier, 2.5)).toBe(expected);
  });

  it('bei dpr 1 liefern alle drei Stufen 1 – der Stufen-Sweep ist an diesem Rechner nicht sichtbar', () => {
    expect(QUALITY_TIERS.map((tier) => devicePixels(tier, 1))).toEqual([1, 1, 1]);
  });

  it('low bleibt hart 1,0, auch unter dpr 1 – weniger als ein Gerätepixel ist nicht schärfer', () => {
    expect(devicePixels('low', 0.75)).toBe(1);
    expect(devicePixels('low', 2.5)).toBe(1);
  });

  it('medium und high folgen einem dpr unter 1 nach unten', () => {
    expect(devicePixels('medium', 0.75)).toBe(0.75);
    expect(devicePixels('high', 0.75)).toBe(0.75);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -2])('ein dpr von %s ergibt 1 Gerätepixel', (dpr) => {
    expect(devicePixels('medium', dpr)).toBe(1);
    expect(devicePixels('high', dpr)).toBe(1);
  });

  it('hardwareScaling ist der Kehrwert – Babylon rechnet umgekehrt', () => {
    expect(hardwareScaling('low', 2.5)).toBe(1);
    expect(hardwareScaling('medium', 2.5)).toBeCloseTo(1 / 1.5, 12);
    expect(hardwareScaling('high', 2.5)).toBe(0.5);
    expect(hardwareScaling('high', 1)).toBe(1);
  });

  it('tierIndex gibt die Position in QUALITY_TIERS', () => {
    expect(tierIndex('low')).toBe(0);
    expect(tierIndex('medium')).toBe(1);
    expect(tierIndex('high')).toBe(2);
  });

  // Der Rückfall ist die Sicherung gegen eine vierte Stufe, die ins Einstellungs-Schema wandert,
  // aber nicht in QUALITY_TIERS: dann fällt dieser Fall, nicht erst das Bild.
  it('ein unbekannter Name liefert -1', () => {
    expect(tierIndex('ultra' as unknown as QualityTier)).toBe(-1);
  });
});
