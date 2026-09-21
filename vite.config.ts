import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
    plugins: [
      versionFile(buildId, base),
      VitePWA({
        registerType: 'prompt',
        // Modus `phone` (adb-Loop): vorhandenen SW entfernen, damit nie ein alter Build aus dem Cache kommt.
        selfDestroying: mode === 'phone',
        manifest: {
          id: base,
          name: 'Mäusebau',
          short_name: 'Mäusebau',
          description: 'Kooperatives Mäuse-Abenteuer im Feinkostladen – offline spielbar.',
          lang: 'de',
          start_url: base,
          scope: base,
          display: 'standalone',
          display_override: ['fullscreen', 'standalone'],
          orientation: 'landscape',
          theme_color: '#1b2140',
          background_color: '#1b2140',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Workbox lässt alles > 2 MiB sonst STILL weg → Offline-Bruch nur auf dem Handy.
          globPatterns: ['**/*.{js,css,html,wasm,png,webp,svg,woff2,json,glb,mp3,ogg}'],
          globIgnores: ['**/node_modules/**/*', '**/version.json'],
          maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
          // Dev-/Test-Parameter (?view=2d, ?station=…, ?expect=…) dürfen den Precache nie verfehlen.
          ignoreURLParametersMatching: [/.*/],
          navigateFallbackDenylist: [/\/lab\.html/],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});
