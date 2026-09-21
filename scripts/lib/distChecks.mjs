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

/**
 * Alle JS-Dateien, die eine HTML-Seite (transitiv) lädt – relativ zu dist/.
 * @param {string} entryHtml
 * @param {string} base
 * @param {(relPath: string) => string | null} readText
 * @returns {string[]}
 */
export function collectJsGraph(entryHtml, base, readText) {
  const queue = [];
  for (const match of entryHtml.matchAll(/(?:src|href)="([^"]+\.js)"/g)) {
    const url = match[1];
    queue.push(normalize(url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, '')));
  }
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const text = readText(current);
    if (text === null) continue;
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      queue.push(normalize(dirOf(current) + match[1]));
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
