import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/wait-for-deploy.mjs';

describe('scripts/wait-for-deploy.mjs', () => {
  it('benutzt die eine Build-ID-Regel aus src/platform/buildIdMatch.ts statt einer eigenen Kopie', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).toContain("from '../src/platform/buildIdMatch.ts'");
    expect(source).not.toMatch(/function\s+matchesBuildId/);
  });

  it('lädt unter blankem Node ohne Build-Schritt: ohne Argument Aufruf-Hinweis und Exit-Code 2', () => {
    // Importe werden vor dem ersten Befehl geladen – Exit-Code 2 beweist, dass Node das TS-Modul laden konnte.
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(result.stderr).toContain('Aufruf: node scripts/wait-for-deploy.mjs');
    expect(result.status).toBe(2);
  });
});
