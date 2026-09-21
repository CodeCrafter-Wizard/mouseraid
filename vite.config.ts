import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** GitHub-Pages-Pfad des Repos `CodeCrafter-Wizard/mouseraid`. */
const PAGES_BASE = '/mouseraid/';

function git(command: string): string {
  return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

/** Build-ID = Git-Kurz-SHA; bei ungespeicherten Änderungen mit Suffix `-dirty`. */
function resolveBuildId(): string {
  try {
    const sha = git('git rev-parse --short=8 HEAD');
    return git('git status --porcelain') === '' ? sha : `${sha}-dirty`;
  } catch {
    return 'nogit';
  }
}

/** Schreibt `version.json` ins Build, damit Deploys von außen überprüfbar sind. */
function versionFile(buildId: string, base: string): Plugin {
  return {
    name: 'maeusebau-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ buildId, base })}\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const base = process.env.VITE_BASE ?? (mode === 'pages' ? PAGES_BASE : '/');
  const buildId = resolveBuildId();
  return {
    base,
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    build: {
      target: 'es2022',
      rolldownOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          lab: resolve(import.meta.dirname, 'lab.html'),
        },
      },
    },
    plugins: [versionFile(buildId, base)],
  };
});
