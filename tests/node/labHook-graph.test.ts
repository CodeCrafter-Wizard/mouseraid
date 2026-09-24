import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Alles, was `labHook.ts` exportiert, landet über `import type { LabHook }` im Typgraphen der
// E2E-Specs (tests/e2e/lab-rtc.spec.ts). Erreicht dieser Graph `src/platform/buildInfo.ts`, fehlt dem
// Node-Projekt die Vite-Konstante `__BUILD_ID__` und `npm run typecheck` bricht ab; erreicht er eine
// `.css`-Datei, bricht er mit TS2882. Beides wird im MODUL repariert, nie in tsconfig.node.json.
const ROOT = resolve(__dirname, '../..');
const FORBIDDEN = ['src/platform/buildInfo.ts', 'src/net/environment.ts', 'src/lab/report.ts', 'src/lab/labSession.ts'];

/** Statische `from '…'`-Importe einer Datei, relative Pfade aufgelöst; Pakete werden übersprungen. */
function walk(entry: string): { files: Set<string>; styles: string[] } {
  const files = new Set<string>();
  const styles: string[] = [];
  const queue = [resolve(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/from\s+'([^']+)'|import\s+'([^']+)'/g)) {
      const spec = match[1] ?? match[2] ?? '';
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (/\.css$/.test(spec)) { styles.push(relative(ROOT, target).replaceAll('\\', '/')); continue; }
      for (const candidate of [`${target}.ts`, join(target, 'index.ts'), target]) {
        if (existsSync(candidate) && candidate.endsWith('.ts')) { queue.push(candidate); break; }
      }
    }
  }
  return { files, styles };
}

const asRel = (files: Set<string>): string[] => [...files].map((file) => relative(ROOT, file).replaceAll('\\', '/'));

describe('Importgraph von src/lab/labHook.ts', () => {
  it('erreicht weder buildInfo noch environment, report oder labSession', () => {
    const reached = asRel(walk('src/lab/labHook.ts').files);
    expect(reached.filter((file) => FORBIDDEN.includes(file))).toEqual([]);
  });

  it('erreicht kein Stylesheet (R14: CSS wird nur aus labMain.ts importiert)', () => {
    expect(walk('src/lab/labHook.ts').styles).toEqual([]);
  });

  it('die Gegenprobe greift: über labMain.ts sind beide erreichbar', () => {
    const main = walk('src/lab/labMain.ts');
    expect(asRel(main.files)).toContain('src/platform/buildInfo.ts');
    expect(main.styles.length).toBeGreaterThan(0);
  });
});
