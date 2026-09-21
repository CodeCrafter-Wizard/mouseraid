import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Das Build-Ziel ist es2022 – SYNTAX übersetzt Vite, BIBLIOTHEKSfunktionen nicht. Ein Aufruf aus
// dieser Liste wirft auf älteren Safari-/iOS-Versionen zur Laufzeit, also genau auf den Geräten,
// die das Testlabor vermessen soll. Ein Polyfill wäre Ballast; die Alternativen sind trivial.
const BANNED: ReadonlyArray<{ call: string; instead: string }> = [
  { call: 'Object.hasOwn(', instead: 'Object.prototype.hasOwnProperty.call(…)' },
  { call: 'Object.groupBy(', instead: 'eigene Schleife' },
  { call: 'Map.groupBy(', instead: 'eigene Schleife' },
  { call: 'Array.fromAsync(', instead: 'for await …' },
  { call: 'structuredClone(', instead: 'JSON-Kopie oder eigene Kopierfunktion' },
  { call: '.replaceAll(', instead: '.replace(/…/g, …)' },
  { call: '.findLast(', instead: 'Schleife von hinten' },
  { call: '.findLastIndex(', instead: 'Schleife von hinten' },
  { call: '.toSorted(', instead: '[...liste].sort(…)' },
  { call: '.toReversed(', instead: '[...liste].reverse()' },
  { call: '.toSpliced(', instead: 'slice/concat' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('Alte Browser: keine neuen Bibliotheksfunktionen in src/', () => {
  it('findet überhaupt Quelldateien', () => {
    expect(sourceFiles('src').length).toBeGreaterThan(10);
  });

  it('kein Modul unter src/ ruft eine Funktion auf, die ältere Safari-Versionen nicht kennen', () => {
    const findings = sourceFiles('src').flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      // Nur echter Code zählt: eine Erwähnung im Kommentar (etwa als Begründung) ist kein Aufruf.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      return BANNED.filter(({ call }) => code.includes(call)).map(({ call, instead }) => `${file}: ${call} → ${instead}`);
    });
    expect(findings).toEqual([]);
  });
});
