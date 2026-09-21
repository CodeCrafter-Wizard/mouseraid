// Wartet, bis die erwartete Build-ID auf GitHub Pages live ist (funktioniert ohne Token – das Repo ist öffentlich).
const SITE = 'https://codecrafter-wizard.github.io/mouseraid/';
const expected = process.argv[2];
if (!expected) {
  console.error('Aufruf: node scripts/wait-for-deploy.mjs <buildId>  (8-stellig, `git rev-parse --short=8 HEAD`; ein Präfix ab 7 Stellen genügt)');
  process.exit(2);
}

/**
 * Gleiche Regel wie `matchesBuildId` in src/platform/buildInfo.ts (dort als Modul, hier bewusst
 * dupliziert – dieses Skript läuft ohne Build-Schritt): exakt oder Präfix ab 7 Stellen, weil
 * `git rev-parse --short HEAD` per Voreinstellung 7 Stellen liefert. Dirty-Builds
 * (`<sha>-dirty-<HHmmss>`) nur exakt.
 * @param {string} want
 * @param {string} live
 */
function matchesBuildId(want, live) {
  if (want === live) return true;
  if (want.length < 7 || live.includes('-')) return false;
  return live.startsWith(want);
}
const deadline = Date.now() + 15 * 60 * 1000;
let last = '';
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${SITE}version.json?t=${Date.now()}`, { cache: 'no-store' });
    last = response.ok ? String((await response.json()).buildId) : `HTTP ${response.status}`;
  } catch (error) {
    last = String(error);
  }
  if (matchesBuildId(expected, last)) {
    console.log(`✓ Build ${last} ist live: ${SITE}`);
    process.exit(0);
  }
  console.log(`… live ist „${last}“, warte auf „${expected}“`);
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}
console.error(`✗ Zeitüberschreitung – zuletzt gesehen: ${last}`);
process.exit(1);
