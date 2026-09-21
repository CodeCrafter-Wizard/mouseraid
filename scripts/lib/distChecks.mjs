// Reine Prüf-Funktionen für das Build-Ergebnis (von check-dist.mjs und Tests benutzt).

/** Babylon trägt diese beiden Basis-URLs fest in `Tools` – harmlos, solange nichts davon geladen wird. */
const ALLOWED_BABYLON_URLS = new Set(['https://cdn.babylonjs.com', 'https://assets.babylonjs.com', 'https://assets.babylonjs.com/core']);

const SIGNATURES = [
  { pattern: /draco_(decoder|wasm_wrapper)/i, reason: 'Draco-Decoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /ktx2Decoder/i, reason: 'KTX2-Decoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /meshopt_decoder/i, reason: 'Meshopt-Decoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /basis_transcoder/i, reason: 'Basis-Transcoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /@babylonjs\/core\/Legacy|\/Legacy\/legacy/, reason: 'Babylon-Legacy-Barrel im Bundle' },
  { pattern: /["'`](?:stun|turns?):/i, reason: 'STUN/TURN-Server (Offline-Modus verlangt iceServers: [])' },
];

/**
 * @param {string} fileName
 * @param {string} text
 * @returns {string[]} Fehlertexte
 */
export function findForbiddenSignatures(fileName, text) {
  const errors = [];
  for (const { pattern, reason } of SIGNATURES) {
    if (pattern.test(text)) errors.push(`${fileName}: ${reason}`);
  }
  for (const match of text.matchAll(/https?:\/\/[a-z0-9.-]*babylonjs\.com[^"'`\s)\\]*/gi)) {
    const url = match[0].replace(/\/$/, '');
    if (!ALLOWED_BABYLON_URLS.has(url)) errors.push(`${fileName}: fremde Babylon-URL ${match[0]}`);
  }
  return errors;
}

function dirOf(relPath) {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? '' : relPath.slice(0, index + 1);
}

function normalize(relPath) {
  const out = [];
  for (const part of relPath.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

// Jede gequotete Zeichenkette, die auf ".js" endet – bewusst grob, denn Vite/Rolldown erzeugen
// Referenzen in vielen Formen: `new URL("./x.js", import.meta.url)`, __vite__mapDeps-Preload-
// Listen (bare, dist-root-relative Pfade), absolute `/base/…`-Importe usw. Ein Treffer wird unten
// nur behalten, wenn er sich auf eine tatsächlich existierende dist-Datei auflösen lässt (siehe
// resolveCandidates). Über-Erkennung ist hier gewollt: ein False Positive fällt in der Fehlerliste
// auf und lässt sich verfeinern – ein False Negative (eine im Lab-Bundle übersehene Babylon-Datei
// oder ein unterschätztes Gzip-Budget) bliebe dagegen unsichtbar.
const JS_STRING_LITERAL = /(["'`])((?:(?!\1)[^\\])*\.js)\1/g;

/**
 * Lesarten, die für eine im Code gefundene ".js"-Zeichenkette infrage kommen. Der Aufrufer
 * entscheidet per Existenzprüfung, welche (falls überhaupt eine) tatsächlich zutrifft.
 * @param {string} raw
 * @param {string} currentDir
 * @param {string} base
 * @returns {string[]}
 */
function resolveCandidates(raw, currentDir, base) {
  if (raw.includes('://')) return [];
  if (raw.startsWith(base)) return [normalize(raw.slice(base.length))];
  if (raw.startsWith('./') || raw.startsWith('../')) return [normalize(currentDir + raw)];
  if (raw.startsWith('/')) return [normalize(raw.slice(1))];
  // Nackter Specifier: dist-root-relativ (z. B. __vite__mapDeps-Listen) oder relativ zur ladenden
  // Datei – beide Lesarten probieren, die Existenzprüfung entscheidet.
  return [normalize(raw), normalize(currentDir + raw)];
}

// sw.js registriert sich selbst per URL (`new Workbox('/base/sw.js')`) statt per ES-Modul-Import –
// und sein eigenes Precache-Manifest nennt jede Projekt-JS-Datei als Zeichenkette. Behandelte man
// es als Graph-Knoten, würde die Existenzprüfung oben jede dieser Zeichenketten bestätigen und
// beide Seiten "importierten" transitiv den kompletten Build – die Grenze zwischen Spiel- und
// Lab-Bundle (der eigentliche Zweck dieses Graphen) wäre dahin. Der von sw.js geladene Workbox-
// Runtime-Chunk (`workbox-<hash>.js`) ist aus demselben Grund kein echter Seiten-Import.
const NOT_A_PAGE_MODULE = /^(?:sw\.js|workbox-[\w-]+\.js)$/;

/**
 * Alle JS-Dateien, die eine HTML-Seite (transitiv) lädt – relativ zu dist/.
 * @param {string} entryHtml
 * @param {string} base
 * @param {(relPath: string) => string | null} readText
 * @returns {string[]}
 */
export function collectJsGraph(entryHtml, base, readText) {
  const queue = [];
  for (const match of entryHtml.matchAll(/(?:src|href)=(["'])([^"']+\.js)\1/g)) {
    const url = match[2];
    queue.push(normalize(url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, '')));
  }
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const text = readText(current);
    if (text === null) continue;
    const currentDir = dirOf(current);
    for (const match of text.matchAll(JS_STRING_LITERAL)) {
      for (const candidate of resolveCandidates(match[2], currentDir, base)) {
        if (NOT_A_PAGE_MODULE.test(candidate)) continue;
        if (!seen.has(candidate) && readText(candidate) !== null) queue.push(candidate);
      }
    }
  }
  return [...seen];
}

const PRECACHE_EXTENSIONS = /\.(js|css|html|wasm|png|webp|svg|woff2|json|glb|mp3|ogg)$/;

/**
 * @param {string} relPath
 * @returns {boolean}
 */
export function isPrecacheCandidate(relPath) {
  if (relPath === 'sw.js' || relPath === 'registerSW.js' || relPath === 'version.json') return false;
  if (/^workbox-[\w-]+\.js$/.test(relPath)) return false;
  return PRECACHE_EXTENSIONS.test(relPath);
}

/**
 * @param {string} swText
 * @param {string[]} relPaths
 * @returns {string[]} nicht vorgecachte Dateien
 */
export function findMissingPrecache(swText, relPaths) {
  return relPaths.filter((rel) => !swText.includes(`"${rel}"`));
}

/** Dateien, die in jedem gültigen Build vorhanden sein müssen – fehlt eine, degradieren andere Prüfungen (Lab-Graph, Precache …) unbemerkt zum Leerlauf statt einen Fehler zu zeigen. */
export const REQUIRED_FILES = ['index.html', 'lab.html', 'sw.js', 'manifest.webmanifest', 'version.json'];

/**
 * @param {string[]} relPaths
 * @returns {string[]} fehlende Pflichtdateien
 */
export function findMissingRequiredFiles(relPaths) {
  const present = new Set(relPaths);
  return REQUIRED_FILES.filter((file) => !present.has(file));
}
