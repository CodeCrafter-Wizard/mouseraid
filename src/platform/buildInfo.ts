export const BUILD_ID: string = __BUILD_ID__;

export type BuildExpectation = 'none' | 'match' | 'mismatch';

/** Wert von `?expect=` oder null, wenn nicht gesetzt/leer. */
export function expectedBuild(search: string): string | null {
  const value = new URLSearchParams(search).get('expect');
  return value === null || value === '' ? null : value;
}

/**
 * Passt die erwartete Build-ID zur laufenden?
 *
 * Exakt – oder als Präfix ab 7 Zeichen, weil `git rev-parse --short HEAD` per Voreinstellung
 * 7 Stellen liefert, die Build-ID aber 8 hat. Auf Dirty-Builds (`<sha>-dirty-<HHmmss>`) greift die
 * Präfix-Regel bewusst nicht: sonst gälte ein alter Handy-Build als die erwartete saubere Version.
 */
export function matchesBuildId(expected: string, buildId: string): boolean {
  if (expected === buildId) return true;
  if (expected.length < 7 || buildId.includes('-')) return false;
  return buildId.startsWith(expected);
}

/** Vergleicht `?expect=<buildId>` mit der laufenden Build-ID (für den Handy-Loop). */
export function checkExpectedBuild(search: string, buildId: string): BuildExpectation {
  const expected = expectedBuild(search);
  if (expected === null) return 'none';
  return matchesBuildId(expected, buildId) ? 'match' : 'mismatch';
}
