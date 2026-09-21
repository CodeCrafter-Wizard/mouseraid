import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Das Repo ist öffentlich: echte Netzwerkadressen (private IPv4, globale/ULA-IPv6, mDNS-Namen)
// dürfen nie aus Tests, Reports oder Logs in einen getrackten Text geraten. Dieser Wächter prüft
// das maschinell – dokumentiert werden nur Art und Anzahl, nie der Wert selbst.

const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|glb|bin|mp3|ogg|wav|mp4|webm|pdf|zip|gz)$/i;
const SKIPPED_FILES = new Set(['package-lock.json']);

/** Schleife, „nicht gesetzt" und Broadcast sind keine Geräteadressen. */
const ALLOWED_IPV4 = new Set(['0.0.0.0', '127.0.0.1', '255.255.255.255']);

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
/** Mindestens drei Hextets – kürzere Treffer wären fast nur Uhrzeiten und Versionsnummern. */
const IPV6 = /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){2,7}\b/gi;
/** Komprimierte Schreibweise mit `::`: eine kurze ULA hat nur zwei Hextets und verfehlt die Regel oben. */
const IPV6_COMPRESSED = /\b[0-9a-f]{1,4}::[0-9a-f:]+\b/gi;
const MDNS = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local\b/gi;

function isPrivateIpv4(value: string): boolean {
  const octets = value.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return first === 192 && second === 168;
}

function classifyIpv6(value: string): string | null {
  // RFC 3849 reserviert 2001:db8::/32 ausdrücklich für Dokumentation – nur dieser Bereich ist frei.
  // Der zweite Dokumentationsbereich (RFC 9637, 3fff::/20) zählt hier bewusst als „global": so hat
  // der Selbsttest unten ein positives Beispiel, das niemandem gehört. Fixtures nehmen 2001:db8::.
  if (/^2001:0*db8\b/i.test(value)) return null;
  const head = value.split(':')[0] ?? '';
  const first = Number.parseInt(head, 16);
  if (Number.isNaN(first)) return null;
  if (first >= 0x2000 && first <= 0x3fff) return 'globale IPv6';
  if (first >= 0xfc00 && first <= 0xfdff) return 'IPv6-ULA';
  return null;
}

/** @returns Befunde als „<datei>: <art>" – bewusst ohne den gefundenen Wert. */
function scan(file: string, text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(IPV4)) {
    if (!ALLOWED_IPV4.has(match[0]) && isPrivateIpv4(match[0])) found.push(`${file}: private IPv4`);
  }
  for (const pattern of [IPV6, IPV6_COMPRESSED]) {
    for (const match of text.matchAll(pattern)) {
      const kind = classifyIpv6(match[0]);
      if (kind !== null) found.push(`${file}: ${kind}`);
    }
  }
  found.push(...[...text.matchAll(MDNS)].map(() => `${file}: mDNS-Name`));
  return found;
}

/** Getrackte Dateien – oder null, wenn `dir` kein Git-Checkout ist (entpacktes Archiv) bzw. git fehlt. */
function trackedFiles(dir: string): string[] | null {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.split('\0').filter((file) => file !== '');
  } catch {
    return null;
  }
}

describe('Datenschutz-Wächter', () => {
  it('erkennt die Muster, gegen die er schützt', () => {
    // Zur Laufzeit zusammengesetzt, damit diese Testdatei nicht über den eigenen Wächter stolpert.
    const privateIpv4 = ['192', '168', '1', '23'].join('.');
    const ula = ['fd12', '3456', '789a', '1'].join(':');
    // Positives Beispiel aus dem Dokumentationsbereich 3fff::/20 (RFC 9637) statt eines real vergebenen Präfixes.
    const globalIpv6 = ['3fff', 'abc', '12', '1'].join(':');
    const compressedUla = `${['fd00', ''].join(':')}:1`;
    const documentationIpv6 = ['2001', 'db8', '85a3', '1'].join(':');
    const mdns = `${['1b9d6bcd', '4b1d', '4b1d', '9b1d', '1b9d6bcd4b1d'].join('-')}.local`;

    expect(scan('x', privateIpv4)).toHaveLength(1);
    expect(scan('x', ula)).toHaveLength(1);
    expect(scan('x', globalIpv6)).toHaveLength(1);
    expect(scan('x', compressedUla)).toHaveLength(1);
    expect(scan('x', mdns)).toHaveLength(1);
    expect(scan('x', documentationIpv6)).toEqual([]);
  });

  it('schlägt bei Versionsnummern, Uhrzeiten und Schleifenadressen keinen Fehlalarm', () => {
    expect(scan('x', 'eslint 10.11.0, vitest 5.0.1, typescript 6.0.3')).toEqual([]);
    expect(scan('x', 'Lauf 2026-09-21 um 16:24:25 beendet')).toEqual([]);
    expect(scan('x', 'http://127.0.0.1:4173/ und 0.0.0.0')).toEqual([]);
  });

  it('stuft den ganzen globalen Bereich 2000::/3 als Befund ein, nicht nur das Dokumentationsbeispiel', () => {
    // Nur der erste Block entscheidet – als Zahl notiert, damit hier keine Adresse im Klartext steht.
    for (const head of [0x2000, 0x2600, 0x2a00, 0x3fff]) {
      expect(scan('x', [head.toString(16), '0', '0', '1'].join(':'))).toEqual(['x: globale IPv6']);
    }
    for (const head of [0x1fff, 0x4000]) {
      expect(scan('x', [head.toString(16), '0', '0', '1'].join(':'))).toEqual([]);
    }
  });

  it('meldet null statt zu werfen, wenn das Verzeichnis kein Git-Checkout ist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maeusebau-kein-git-'));
    try {
      expect(trackedFiles(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('findet in keiner getrackten Textdatei eine echte Netzwerkadresse', (context) => {
    const files = trackedFiles(process.cwd());
    if (files === null) {
      // In der CI gibt es immer einen Checkout – dort wäre ein still übersprungener Wächter ein blindes Tor.
      if (process.env.CI) throw new Error('Datenschutz-Wächter: `git ls-files` schlug in der CI fehl – ohne Checkout prüft er nichts.');
      const reason = 'kein Git-Checkout (`git ls-files` schlug fehl) – der Wächter prüft nur getrackte Dateien';
      // Direkt auf stderr: der Standard-Reporter zeigt weder die Skip-Notiz noch `console.warn` übersprungener Tests.
      process.stderr.write(`\nDatenschutz-Wächter ÜBERSPRUNGEN: ${reason}\n`);
      context.skip(reason);
      return;
    }
    expect(files.length).toBeGreaterThan(10);
    const findings = files
      .filter((file) => !SKIPPED_FILES.has(file) && !BINARY.test(file))
      .flatMap((file) => scan(file, readFileSync(file, 'utf8')));
    expect(findings).toEqual([]);
  });
});
