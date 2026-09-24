// Prüft dist/ nach dem Build: Offline-Fallen, Schichtgrenzen im Bundle, Precache-Vollständigkeit, Größen.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { collectJsGraph, findForbiddenSignatures, findLabSignatures, findMissingPrecache, findMissingRequiredFiles, findScannerWorker, isPrecacheCandidate } from './lib/distChecks.mjs';

const DIST = 'dist';
const BUDGET = { gameJsGzip: 900 * 1024, labJsGzip: 150 * 1024, precacheTotal: 80 * 1024 * 1024 };

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ fehlt – zuerst `npm run build:pages` ausführen.');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(DIST).map((full) => relative(DIST, full).replaceAll('\\', '/'));
const read = (rel) => (existsSync(join(DIST, rel)) ? readFileSync(join(DIST, rel), 'utf8') : null);
const gzipSize = (rels) => rels.reduce((sum, rel) => sum + gzipSync(readFileSync(join(DIST, rel))).length, 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

const errors = [];
const { base, buildId } = JSON.parse(read('version.json') ?? '{"base":"/","buildId":"?"}');

// sw.js bekommt weiter unten eine eigene, aussagekräftigere Meldung – hier nicht doppelt melden.
for (const missing of findMissingRequiredFiles(files).filter((file) => file !== 'sw.js')) {
  errors.push(`${missing}: fehlt im Build`);
}

for (const rel of files.filter((f) => /\.(js|css|html)$/.test(f))) {
  errors.push(...findForbiddenSignatures(rel, read(rel) ?? ''));
}

/**
 * JS-Graph einer Seite, um nicht auflösbare Referenzen bereinigt: Ein im HTML genanntes, aber im
 * Build fehlendes Skript wäre sonst ein ENOENT-Absturz mitten in der Größenmessung – also noch
 * bevor die gesammelte Fehlerliste überhaupt ausgegeben wird.
 */
function pageGraph(page) {
  const graph = collectJsGraph(read(page) ?? '', base, read);
  const present = graph.filter((rel) => existsSync(join(DIST, rel)));
  for (const rel of graph.filter((rel) => !existsSync(join(DIST, rel)))) {
    errors.push(`${page}: referenziertes Skript ${rel} fehlt im Build`);
  }
  // Leerer Graph = kein Einstiegsskript erkannt. Ohne diese Prüfung liefe alles Folgende
  // (Babylon-Suche im Lab-Bundle, Gzip-Budget) still ins Leere und meldete „alles in Ordnung".
  if (present.length === 0) errors.push(`JS-Graph von ${page} ist leer – Einstiegsskript nicht erkannt`);
  return present;
}

const gameGraph = pageGraph('index.html');
const labGraph = pageGraph('lab.html');
for (const rel of labGraph) {
  if (/babylon/i.test(read(rel) ?? '')) errors.push(`${rel}: Testlabor-Bundle enthält Babylon (Lab muss schlank bleiben)`);
}
// Die Gegenrichtung: das Spiel kennt weder das Labor noch die Netz-Schicht.
for (const rel of gameGraph) {
  errors.push(...findLabSignatures(rel, read(rel) ?? ''));
}
const gameGzip = gzipSize(gameGraph);
const labGzip = gzipSize(labGraph);
if (gameGzip > BUDGET.gameJsGzip) errors.push(`Spiel-JS ${kb(gameGzip)} gzip > Budget ${kb(BUDGET.gameJsGzip)}`);
if (labGzip > BUDGET.labJsGzip) errors.push(`Lab-JS ${kb(labGzip)} gzip > Budget ${kb(BUDGET.labJsGzip)}`);

const swText = read('sw.js');
if (swText === null) {
  errors.push('sw.js fehlt – PWA-Plugin nicht aktiv?');
} else {
  const candidates = files.filter(isPrecacheCandidate);
  for (const missing of findMissingPrecache(swText, candidates)) {
    errors.push(`${missing}: fehlt im Precache – Dateityp fehlt in globPatterns (vite.config.ts)? Datei > 30 MiB?`);
  }
  const total = candidates.reduce((sum, rel) => sum + statSync(join(DIST, rel)).size, 0);
  console.log(`Precache: ${candidates.length} Dateien, ${kb(total)}`);
  if (total > BUDGET.precacheTotal) errors.push(`Precache ${kb(total)} > Budget ${kb(BUDGET.precacheTotal)}`);
}

// Der QR-Scanner-Worker: im Build, im Lab-Graphen (er zählt zum Lab-Budget), NICHT im Spiel-Graphen
// und im Precache – sonst fehlt er offline genau dann, wenn das Labor ohne Netz arbeiten soll.
const scannerWorker = findScannerWorker(files);
if (scannerWorker === null) {
  errors.push('Scanner-Worker fehlt im Build – importiert das Labor `qr-scanner` nicht mehr, oder hat Vite den Chunk anders benannt?');
} else {
  if (!labGraph.includes(scannerWorker)) {
    errors.push(`${scannerWorker}: nicht im JS-Graph von lab.html – der Scanner-Worker muss zum Lab-Bundle zählen (Budget!)`);
  }
  if (gameGraph.includes(scannerWorker)) {
    errors.push(`${scannerWorker}: im JS-Graph von index.html – der Scanner gehört ins Labor, nicht ins Spiel-Bundle`);
  }
  if (swText !== null && findMissingPrecache(swText, [scannerWorker]).length > 0) {
    errors.push(`${scannerWorker}: fehlt im Precache – ohne den Chunk scannt das Labor offline nicht`);
  }
}

console.log(`Build ${buildId} (base ${base}) – Spiel-JS ${kb(gameGzip)} gzip, Lab-JS ${kb(labGzip)} gzip`);
if (errors.length > 0) {
  console.error(`\n✗ check-dist: ${errors.length} Problem(e)`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log('✓ check-dist: alles in Ordnung');
