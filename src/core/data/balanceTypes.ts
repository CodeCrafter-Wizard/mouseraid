import type { YRange } from '../world/colliderTypes';

/**
 * ALLE Zahlen dieser Datei sind PROVISORISCH (D10/R1) und gehen nach M14 ans Spaß-GATE.
 * Kein Test hängt an ihnen – Tests benutzen `tests/fixtures/core/test-balance.json`.
 *
 * `BalanceJson` ist die MENSCHEN-Form (cm, cm/s, Sekunden, Verhältnisse),
 * `Balance` die TICK-Form (Einheiten, Einheiten je Tick, Ticks). `loadBalance` rechnet EINMAL um.
 */

export interface LoudnessJson { sneak: number; walk: number; sprint: number }

export interface MouseJson {
  radiusCm: number; heightCm: number; walkCmPerS: number; sprintMul: number; accelCmPerS2: number;
  frictionPerTick: number; sneakBelowRatio: number; weakenedMul: number;
  deadZone: number; sprintRingMag: number; loudness: LoudnessJson;
}

export interface CatJson { radiusCm: number; heightCm: number }

export interface BalanceJson {
  tickRate: number; dayLengthS: number; nightLengthS: number;
  noiseEventMinLoudness: number; mouse: MouseJson; cat: CatJson;
}

export interface MouseBalance {
  radius: number; height: number; yRange: YRange;
  /** EINHEITEN JE TICK. */
  sneakSpeed: number; walkSpeed: number; sprintSpeed: number;
  /** Einheiten je Tick². */
  accel: number;
  /** Faktor je Tick, unverändert aus `frictionPerTick`. */
  friction: number;
  weakenedMul: number;
  deadZone: number; sprintRingMag: number;
  loudSneak: number; loudWalk: number; loudSprint: number;
}

export interface CatBalance { radius: number; height: number; yRange: YRange }

export interface Balance {
  tickRate: number; dayTicks: number; nightTicks: number;
  noiseEventMinLoudness: number; mouse: MouseBalance; cat: CatBalance;
}
