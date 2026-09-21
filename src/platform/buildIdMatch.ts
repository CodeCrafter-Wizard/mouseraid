/**
 * Passt die erwartete Build-ID zur laufenden?
 *
 * Exakt – oder als Präfix ab 7 Zeichen, weil `git rev-parse --short HEAD` per Voreinstellung
 * 7 Stellen liefert, die Build-ID aber 8 hat. Auf Dirty-Builds (`<sha>-dirty-<HHmmss>`) greift die
 * Präfix-Regel bewusst nicht: sonst gälte ein alter Handy-Build als die erwartete saubere Version.
 *
 * Eigenes Modul ohne Importe und ohne `__BUILD_ID__`: `scripts/wait-for-deploy.mjs` lädt genau
 * diese Datei direkt unter Node (Type-Stripping, kein Build-Schritt). Deshalb hier nur löschbare
 * TypeScript-Syntax benutzen – keine Enums, keine Namespaces, keine Parameter-Properties.
 */
export function matchesBuildId(expected: string, buildId: string): boolean {
  if (expected === buildId) return true;
  if (expected.length < 7 || buildId.includes('-')) return false;
  return buildId.startsWith(expected);
}
