// Wartet, bis die erwartete Build-ID auf GitHub Pages live ist (funktioniert ohne Token – das Repo ist öffentlich).
const SITE = 'https://codecrafter-wizard.github.io/mouseraid/';
const expected = process.argv[2];
if (!expected) {
  console.error('Aufruf: node scripts/wait-for-deploy.mjs <buildId>');
  process.exit(2);
}
const deadline = Date.now() + 15 * 60 * 1000;
let last = '';
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${SITE}version.json?t=${Date.now()}`, { cache: 'no-store' });
    last = response.ok ? (await response.json()).buildId : `HTTP ${response.status}`;
  } catch (error) {
    last = String(error);
  }
  if (last === expected) {
    console.log(`✓ Build ${expected} ist live: ${SITE}`);
    process.exit(0);
  }
  console.log(`… live ist „${last}“, warte auf „${expected}“`);
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}
console.error(`✗ Zeitüberschreitung – zuletzt gesehen: ${last}`);
process.exit(1);
