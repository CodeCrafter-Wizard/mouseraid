// Misst den Kern (`npm run core:bench`): Kosten von step() und hashState().
// Wie core-rebaseline.mjs startet dieses Skript nur Vitest mit einer Umgebungsvariablen – es
// importiert den Kern nicht selbst (erweiterungslose Importe, siehe dort). Der Messlauf sichert
// NICHTS über die Laufzeit zu; die Zahlen gehören mit Hardware-Vorbehalt nach docs/decisions.md.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));

console.log('Kern-Messlauf (MB_BENCH=1) – die Zahlen gelten nur für diese Maschine …');
const result = spawnSync(process.execPath, [vitest, 'run', 'tests/node/core-bench.test.ts'], {
  cwd: root,
  env: { ...process.env, MB_BENCH: '1' },
  stdio: 'inherit',
});
if (result.error) {
  console.error(`✗ Vitest ließ sich nicht starten: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
