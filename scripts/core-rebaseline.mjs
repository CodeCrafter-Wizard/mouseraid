// Schreibt die Golden-Baseline neu (`npm run core:rebaseline`).
// Dieses Skript IMPORTIERT DEN KERN NICHT: die Kern-Module benutzen erweiterungslose Importe
// (`moduleResolution: "bundler"`), Nodes ESM-Auflösung verlangt `./vec.ts`, und
// `allowImportingTsExtensions` hieße `tsconfig.core.json` zu ändern. Es setzt deshalb nur eine
// Umgebungsvariable – in einem npm-Skript wäre das nicht plattformübergreifend – und startet den
// Vitest-Lauf, der die Fixture im Schreibmodus neu rechnet.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));

console.log('Golden-Baseline wird neu gerechnet (MB_REBASELINE=1) …');
const result = spawnSync(process.execPath, [vitest, 'run', 'tests/node/golden.test.ts'], {
  cwd: root,
  env: { ...process.env, MB_REBASELINE: '1' },
  stdio: 'inherit',
});
if (result.error) {
  console.error(`✗ Vitest ließ sich nicht starten: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error('✗ Der Schreiblauf ist fehlgeschlagen – die Fixture wurde nicht geschrieben.');
  process.exit(result.status ?? 1);
}
console.log('');
console.log('Fertig. Vor dem Commit: `Rebaseline: <Grund>` in docs/decisions.md ergänzen,');
console.log('sonst meldet tests/node/golden-guard.test.ts die Änderung als unbegründet.');
