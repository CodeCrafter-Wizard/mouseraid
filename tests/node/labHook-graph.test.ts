import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Alles, was `labHook.ts` bzw. `view2d/hook.ts` exportiert, landet über `import type { … }` im
// Typgraphen der E2E-Specs (tests/e2e/lab-rtc.spec.ts, tests/e2e/view2d.spec.ts). Erreicht dieser
// Graph `src/platform/buildInfo.ts`, fehlt dem Node-Projekt die Vite-Konstante `__BUILD_ID__` und
// `npm run typecheck` bricht ab; erreicht er eine `.css`-Datei, bricht er mit TS2882. Beides wird
// im MODUL repariert, nie in tsconfig.node.json.
const ROOT = resolve(__dirname, '../..');
const FORBIDDEN = ['src/platform/buildInfo.ts', 'src/net/environment.ts', 'src/lab/report.ts', 'src/lab/labSession.ts'];
// `draw.ts` steht mit im Wächter, weil der Tor-Spec die Farbtafel daraus importiert, statt
// Hexwerte zu verdoppeln. Ein zweiter, fast gleicher Wächter je Datei wäre dieselbe Prüfung dreimal.
const ENTRIES = ['src/lab/labHook.ts', 'src/render/view2d/hook.ts', 'src/render/view2d/draw.ts'];

/**
 * Jede Import-Angabe einer Datei – statisch (`from '…'`, `import '…'`) UND dynamisch
 * (`import("…")`), in einfachen wie doppelten Anführungszeichen. Relative Pfade werden aufgelöst,
 * Pakete übersprungen. Ein `await import("./report")` würde report.ts genauso in den Graphen holen
 * wie ein statischer Import und darf dem Wächter deshalb nicht entgehen.
 */
const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

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
    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      const spec = match[1] ?? '';
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

for (const entry of ENTRIES) {
  describe(`Importgraph von ${entry}`, () => {
    it('erreicht weder buildInfo noch environment, report oder labSession', () => {
      const reached = asRel(walk(entry).files);
      expect(reached.filter((file) => FORBIDDEN.includes(file))).toEqual([]);
    });

    it('erreicht kein Stylesheet (CSS wird nur aus labMain.ts bzw. src/ui/shell.css geladen)', () => {
      expect(walk(entry).styles).toEqual([]);
    });
  });
}

describe('Besonderheiten der beiden Haken-Graphen', () => {
  it('src/render/view2d/hook.ts ist IMPORTFREI – der Graph ist die Datei selbst', () => {
    // Schärfer als „erreicht nichts Verbotenes": das Modul darf auch keinen Core-Typ importieren,
    // sonst wächst sein Graph mit jedem späteren Umbau des Kerns mit.
    expect(asRel(walk('src/render/view2d/hook.ts').files)).toEqual(['src/render/view2d/hook.ts']);
  });

  it('die Gegenprobe greift: über labMain.ts sind ALLE verbotenen Module erreichbar', () => {
    const main = walk('src/lab/labMain.ts');
    // Nicht nur buildInfo: fände der Wächter nur eines der vier, wäre er für die anderen drei blind.
    expect(asRel(main.files)).toEqual(expect.arrayContaining(FORBIDDEN));
    expect(main.styles.length).toBeGreaterThan(0);
  });

  it('die zweite Gegenprobe greift: src/main.ts erreicht buildInfo, ein Stylesheet UND view2d/main.ts', () => {
    const main = walk('src/main.ts');
    const reached = asRel(main.files);
    expect(reached).toContain('src/platform/buildInfo.ts');
    expect(main.styles).toContain('src/ui/shell.css');
    // view2d/main.ts hängt NUR am dynamischen `import()` – dieser Fall prüft also gleich mit,
    // dass der Wächter `import()` sieht.
    expect(reached).toContain('src/render/view2d/main.ts');
  });

  it('sieht auch dynamische Importe und doppelte Anführungszeichen', () => {
    // Gegenprobe ohne Repo-Datei: ein `await import("./report")` darf dem Wächter nicht entgehen,
    // sonst könnte genau so ein Import report.ts in den Haken-Graphen holen, ohne aufzufallen.
    const dir = mkdtempSync(join(tmpdir(), 'labhook-graph-'));
    try {
      writeFileSync(join(dir, 'report.ts'), 'export const marker = 1;\n', 'utf8');
      writeFileSync(join(dir, 'entry.ts'), 'export async function load() {\n  return await import("./report");\n}\n', 'utf8');
      expect([...walk(join(dir, 'entry.ts')).files]).toContain(resolve(dir, 'report.ts'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
