import { describe, expect, it } from 'vitest';
import { redactText } from '../../src/lab/report';
import { createErrorLog, describeError, formatDiagnosis, type ErrorEntry } from '../../src/platform/errorLog';

const entry = (n: number): ErrorEntry => ({ at: `2026-09-21T10:00:0${n}Z`, kind: 'error', message: `Fehler ${n}` });

// Nur Dokumentationsadressen (RFC 5737); der mDNS-Name entsteht zur Laufzeit (Datenschutz-Wächter).
const DOC_IPV4 = '192.0.2.10';
const MDNS_NAME = `${['22222222', '2222', '2222', '2222', '222222222222'].join('-')}.local`;

const INFO = { buildId: 'abc12345', url: 'https://x/mouseraid/lab.html', userAgent: 'UA', displayMode: 'browser', online: true, swState: 'aktiv' };

describe('errorLog', () => {
  it('behält nur die neuesten max Einträge (Ringpuffer)', () => {
    const log = createErrorLog(3);
    [1, 2, 3, 4, 5].forEach((n) => log.push(entry(n)));
    expect(log.entries().map((e) => e.message)).toEqual(['Fehler 3', 'Fehler 4', 'Fehler 5']);
  });

  it('clear leert den Puffer', () => {
    const log = createErrorLog();
    log.push(entry(1));
    log.clear();
    expect(log.entries()).toHaveLength(0);
  });

  it('describeError kommt mit Error, String und beliebigen Werten zurecht', () => {
    const err = new Error('kaputt');
    expect(describeError(err).message).toBe('kaputt');
    expect(describeError(err).stack).toContain('kaputt');
    expect(describeError('nur Text')).toEqual({ message: 'nur Text' });
    expect(describeError({ a: 1 }).message).toBe('{"a":1}');
    expect(describeError(undefined).message).toBe('undefined');
  });

  it('formatDiagnosis erzeugt einen kopierbaren Text mit Kopf und Einträgen', () => {
    const text = formatDiagnosis(
      { buildId: 'abc12345', url: 'https://x/mouseraid/', userAgent: 'UA', displayMode: 'standalone', online: false, swState: 'aktiv' },
      [{ at: '2026-09-21T10:00:00Z', kind: 'unhandledrejection', message: 'oops', stack: 'Zeile1\nZeile2' }],
    );
    expect(text).toContain('Build: abc12345');
    expect(text).toContain('Anzeige: standalone');
    expect(text).toContain('Online: nein');
    expect(text).toContain('[unhandledrejection] oops');
    expect(text).toContain('Zeile2');
  });

  it('formatDiagnosis schwärzt Nachricht und Stack, wenn ein Schwärzer übergeben wird (lab.html)', () => {
    // Auf lab.html kann ein Laufzeitfehler eine echte Adresse tragen (ein SDP-Parserfehler zitiert die
    // fehlerhafte Zeile). „Diagnose kopieren" ist ein Kopierweg wie jeder andere – hier hängt der
    // Schwärzer aus src/lab/report.ts davor.
    const entries: ErrorEntry[] = [
      { at: '2026-09-21T10:00:00Z', kind: 'error', message: `setRemoteDescription: ${DOC_IPV4} unerreichbar`, stack: `at f (${MDNS_NAME}:1)` },
    ];
    const text = formatDiagnosis(INFO, entries, redactText);
    expect(text).not.toContain(DOC_IPV4);
    expect(text).not.toContain(MDNS_NAME);
    expect(text).toContain('ipv4/other#');
    expect(text).toContain('mdns/mdns#');
    // Kopf und Gerüst bleiben unangetastet – sonst fehlt dem Entwickler die halbe Diagnose.
    expect(text).toContain('Build: abc12345');
    expect(text).toContain('[error] setRemoteDescription:');
  });

  it('formatDiagnosis ohne Schwärzer lässt den Text wörtlich stehen (Spielseite)', () => {
    const entries: ErrorEntry[] = [{ at: '2026-09-21T10:00:00Z', kind: 'error', message: `kaputt bei ${DOC_IPV4}` }];
    expect(formatDiagnosis(INFO, entries)).toContain(DOC_IPV4);
  });
});
