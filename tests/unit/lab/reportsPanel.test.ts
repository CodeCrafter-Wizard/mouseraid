import { describe, expect, it } from 'vitest';
import { failureLine } from '../../../src/lab/reportsPanel';
import { S } from '../../../src/ui/strings';

// `failureLine` beschriftet die Befunde eines GESPEICHERTEN Reports. Gespeicherte Daten können aus
// einem neueren Build stammen (veralteter PWA-Cache) und einen Code tragen, den dieser Build noch
// nicht kennt – dann darf die Zeile nicht werfen, sonst bleibt lab.html leer und unbedienbar.

describe('failureLine', () => {
  it('nennt bekannte Codes mit Titel, eine leere Liste meldet „keine Befunde"', () => {
    expect(failureLine([])).toBe(S.lab.reports.noFailures);
    expect(failureLine(['F3'])).toBe(`F3 · ${S.failures.F3.title}`);
    expect(failureLine(['F3', 'F9'])).toBe(`F3 · ${S.failures.F3.title} / F9 · ${S.failures.F9.title}`);
  });

  it('ein unbekannter Code steht wörtlich da, statt die Seite zu zerlegen', () => {
    expect(() => failureLine(['F10'])).not.toThrow();
    expect(failureLine(['F10'])).toBe('F10');
    expect(failureLine(['F3', 'F10'])).toBe(`F3 · ${S.failures.F3.title} / F10`);
  });
});
