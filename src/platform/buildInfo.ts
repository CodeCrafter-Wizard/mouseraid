import { matchesBuildId } from './buildIdMatch';

export const BUILD_ID: string = __BUILD_ID__;

export type BuildExpectation = 'none' | 'match' | 'mismatch';

// Die Regel selbst liegt in `buildIdMatch.ts`, damit `scripts/wait-for-deploy.mjs` dieselbe benutzt.
export { matchesBuildId };

/** Wert von `?expect=` oder null, wenn nicht gesetzt/leer. */
export function expectedBuild(search: string): string | null {
  const value = new URLSearchParams(search).get('expect');
  return value === null || value === '' ? null : value;
}

/** Vergleicht `?expect=<buildId>` mit der laufenden Build-ID (für den Handy-Loop). */
export function checkExpectedBuild(search: string, buildId: string): BuildExpectation {
  const expected = expectedBuild(search);
  if (expected === null) return 'none';
  return matchesBuildId(expected, buildId) ? 'match' : 'mismatch';
}
