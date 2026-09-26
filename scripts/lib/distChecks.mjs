// Reine Prüf-Funktionen für das Build-Ergebnis (von check-dist.mjs und Tests benutzt).

/**
 * Babylon trägt diese URLs als Zeichenketten fest im Code – harmlos, solange keine davon geladen
 * wird. Die ersten drei sind die CDN-Vorgaben in `Tools`; die vierte (M5/D1) steht in
 * `Misc/devTools.js` wörtlich in einem `console.warn` – dem Gerüst hinter JEDEM
 * Nebenwirkungs-Stub. GEMESSEN: sie kommt 1x im Spiel-Chunk vor, auch ohne
 * `CheckMissingImports`, und wird nie geholt; OHNE diese Zeile meldet `check-dist` genau 1 Problem.
 * Alle Decoder-, Legacy- und sonstigen CDN-Signaturen bleiben scharf.
 */
const ALLOWED_BABYLON_URLS = new Set([
  'https://cdn.babylonjs.com',
  'https://assets.babylonjs.com',
  'https://assets.babylonjs.com/core',
  'https://doc.babylonjs.com/setup/treeshaking',
]);

const SIGNATURES = [
  { pattern: /draco_(decoder|wasm_wrapper)/i, reason: 'Draco-Decoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /ktx2Decoder/i, reason: 'KTX2-Decoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /meshopt_decoder/i, reason: 'Meshopt-Decoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /basis_transcoder/i, reason: 'Basis-Transcoder (käme vom CDN → Offline-Bruch)' },
  { pattern: /@babylonjs\/core\/Legacy|\/Legacy\/legacy/, reason: 'Babylon-Legacy-Barrel im Bundle' },
  { pattern: /["'`](?:stuns?|turns?):/i, reason: 'STUN/TURN-Server (Offline-Modus verlangt iceServers: [])' },
  // Node-Reste einer Bibliothek, die ihren Server-Build mitliefert: im Browser ein ReferenceError –
  // also ein Startfehler genau auf dem Gerät des Nutzers. Die Wortgrenze hält `audioBuffer.from`
  // und `this.processEnv` heraus.
  { pattern: /\bprocess\.(env|version|platform)\b/, reason: 'Node-Polyfill (process)' },
  { pattern: /\bBuffer\.(from|alloc)\b/, reason: 'Node-Polyfill (Buffer)' },
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

/**
 * Zeichenketten, die es nur in der Labor- und Netz-Schicht gibt. Im JS-Graphen der SPIELSEITE wäre
 * jede davon ein Schichtbruch (und toter Ballast im Spiel-Bundle). Bewusst nur diese drei: sie
 * können im Spiel-Code nicht zufällig entstehen – `MB1.` dagegen schon (ein minifizierter Name).
 */
const LAB_ONLY_SIGNATURES = [
  { pattern: /maeusebau-lab-/, reason: 'BroadcastChannel-Name des Testlabors (src/net/broadcastTransport.ts)' },
  { pattern: /RTCPeerConnection/, reason: 'WebRTC-Schicht (src/net)' },
  { pattern: /CompressionStream/, reason: 'SDP-Codec (src/net/compress.ts)' },
];

/**
 * @param {string} fileName
 * @param {string} text
 * @returns {string[]} Fehlertexte
 */
export function findLabSignatures(fileName, text) {
  return LAB_ONLY_SIGNATURES.filter(({ pattern }) => pattern.test(text)).map(
    ({ reason }) => `${fileName}: Spiel-Graph enthält ${reason} – Labor-/Netz-Code gehört nicht ins Spiel-Bundle`,
  );
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

// Dateien, die NICHT vorgecacht gehören: der Service Worker selbst, sein Registrierungs-Schnipsel,
// die bewusst netzfrische version.json, der Workbox-Runtime-Chunk und Sourcemaps.
const PRECACHE_EXCLUDED = [/^sw\.js$/, /^registerSW\.js$/, /^version\.json$/, /^workbox-[\w-]+\.js$/, /\.map$/];

/**
 * Bewusst umgekehrt gedacht: JEDE dist-Datei muss vorgecacht sein, außer den Ausnahmen oben.
 * Diese Liste ist absichtlich KEINE Kopie von `globPatterns` (vite.config.ts) – taucht ein neuer
 * Dateityp im Build auf (.jpg, .gltf, .bin …), den `globPatterns` nicht kennt, fällt das hier laut
 * auf, statt still offline zu fehlen. Der Fix ist dann eine bewusste Änderung an `globPatterns`
 * (oder, falls die Datei wirklich nicht in den Cache gehört, an dieser Liste).
 * @param {string} relPath
 * @returns {boolean}
 */
export function isPrecacheCandidate(relPath) {
  return !PRECACHE_EXCLUDED.some((pattern) => pattern.test(relPath));
}

/** @param {string} text */
function escapeForRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sucht den Eintrag in MANIFEST-Form (`url:"…"` bzw. `"url":"…"`), nicht irgendeine gequotete
 * Zeichenkette: das echte sw.js nennt "index.html" ein zweites Mal in
 * `createHandlerBoundToURL("index.html")` – ein fehlender Manifest-Eintrag für index.html wäre
 * mit einer reinen Teilstring-Suche unsichtbar.
 * @param {string} swText
 * @param {string[]} relPaths
 * @returns {string[]} nicht vorgecachte Dateien
 */
export function findMissingPrecache(swText, relPaths) {
  return relPaths.filter((rel) => !new RegExp(`(?:"url"|url)\\s*:\\s*"${escapeForRegExp(rel)}"`).test(swText));
}

/**
 * `qr-scanner` lädt seinen Worker über einen dynamischen ES-Import (`import('./qr-scanner-worker.min.js')`),
 * den Vite als eigenen Chunk emittiert. Erkannt wird er am Namen, nicht am Inhalt: der Hash ändert
 * sich mit jedem Build, der Name nicht.
 */
const SCANNER_WORKER_PATTERN = /(?:^|\/)qr-scanner-worker[.\w-]*\.js$/;

/**
 * @param {string[]} relPaths
 * @returns {string | null} der Worker-Chunk oder null, wenn er nicht im Build liegt
 */
export function findScannerWorker(relPaths) {
  return relPaths.find((rel) => SCANNER_WORKER_PATTERN.test(rel)) ?? null;
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
