import { describe, expect, it } from 'vitest';
import { createErrorLog, describeError, formatDiagnosis, type ErrorEntry } from '../../src/platform/errorLog';

const entry = (n: number): ErrorEntry => ({ at: `2026-09-21T10:00:0${n}Z`, kind: 'error', message: `Fehler ${n}` });

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
});
