// Qualitätsstufen und die DPR-Politik – REIN (keine Engine, kein DOM, kein Babylon), damit die
// Tabelle in Vitest gepinnt werden kann. Umgesetzt wird sie in `engine.ts` über
// `setHardwareScalingLevel`.
import type { Settings } from '../platform/storage';

/**
 * EINE Definition der Stufe: `src/platform` darf `src/render` nicht kennen, `src/render`
 * `src/platform` aber schon. Deshalb wohnt das Literal im Einstellungs-Schema und wird hier
 * abgeleitet – eine zweite Liste liefe beim ersten neuen Namen auseinander.
 */
export type QualityTier = Settings['qualityTier'];

export const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

/** Obergrenze der Gerätepixel je Stufe; `low` ist zusätzlich hart 1,0 (siehe `devicePixels`). */
export const TIER_MAX_DPR: Readonly<Record<QualityTier, number>> = { low: 1, medium: 1.5, high: 2 };

/**
 * Gerätepixel je CSS-Pixel. `low` liefert HART 1,0 – auch bei `dpr < 1`, wo `min` kleiner wäre:
 * unter 1 Gerätepixel je CSS-Pixel ist das Bild nicht schärfer, nur unlesbar. Ein nicht endlicher
 * oder nicht positiver `dpr` (ein Browser ohne `devicePixelRatio`) ergibt ebenfalls 1.
 */
export function devicePixels(tier: QualityTier, dpr: number): number {
  if (tier === 'low' || !Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(dpr, TIER_MAX_DPR[tier]);
}

/** Das Argument für `engine.setHardwareScalingLevel` – Babylon rechnet umgekehrt. */
export function hardwareScaling(tier: QualityTier, dpr: number): number {
  return 1 / devicePixels(tier, dpr);
}

/** Position in `QUALITY_TIERS` (0 … 2); -1 für einen unbekannten Namen. */
export function tierIndex(tier: QualityTier): number {
  return QUALITY_TIERS.indexOf(tier);
}
