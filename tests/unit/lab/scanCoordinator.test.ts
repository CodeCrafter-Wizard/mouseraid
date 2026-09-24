import { describe, expect, it, vi } from 'vitest';

// `qr-scanner` ist eine Browser-Bibliothek (Worker, Canvas) und wird beim Import von `qrPanels`
// mitgezogen – im Node-Umfeld steht sie als Attrappe da (gleiche Naht wie in scannerAdapter.test.ts).
// Geprüft wird hier NUR der reine Koordinator, nicht der DOM-Block.
vi.mock('qr-scanner', () => ({ default: { scanImage: vi.fn(), createQrEngine: vi.fn() } }));

const { createScanCoordinator } = await import('../../../src/lab/qrPanels');

/** Merkt sich, wer abgebrochen wurde – Mitglieder sind hier schlichte Zeichenketten. */
function stopLog(): { stop: (member: string) => void; stopped: string[] } {
  const stopped: string[] = [];
  return { stopped, stop: (member) => { stopped.push(member); } };
}

describe('createScanCoordinator', () => {
  it('activate bricht jedes ANDERE Mitglied ab, nie das aktive selbst', () => {
    const coordinator = createScanCoordinator<string>();
    coordinator.add('platz-1');
    coordinator.add('platz-2');
    coordinator.add('platz-3');
    const log = stopLog();

    coordinator.activate('platz-2', log.stop);

    expect(log.stopped.sort()).toEqual(['platz-1', 'platz-3']);
  });

  it('ohne weitere Mitglieder bricht activate nichts ab', () => {
    const coordinator = createScanCoordinator<string>();
    coordinator.add('allein');
    const log = stopLog();

    coordinator.activate('allein', log.stop);

    expect(log.stopped).toEqual([]);
  });

  it('die Rückgabe von add meldet wieder ab – ein freigegebener Platz wird nicht mehr abgebrochen', () => {
    const coordinator = createScanCoordinator<string>();
    const remove = coordinator.add('platz-1');
    coordinator.add('platz-2');
    remove();
    const log = stopLog();

    coordinator.activate('platz-2', log.stop);

    expect(log.stopped).toEqual([]);
  });

  it('ein nicht angemeldetes Mitglied bricht alle anderen ab', () => {
    const coordinator = createScanCoordinator<string>();
    coordinator.add('platz-1');
    const log = stopLog();

    coordinator.activate('fremd', log.stop);

    expect(log.stopped).toEqual(['platz-1']);
  });

  it('forEach besucht alle Mitglieder in der Reihenfolge der Anmeldung', () => {
    const coordinator = createScanCoordinator<string>();
    for (const member of ['a', 'b', 'c']) coordinator.add(member);
    const seen: string[] = [];

    coordinator.forEach((member) => { seen.push(member); });

    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('forEach verträgt eine Abmeldung MITTEN im Durchlauf (ein Block, der sich dabei verabschiedet)', () => {
    const coordinator = createScanCoordinator<string>();
    const removeA = coordinator.add('a');
    coordinator.add('b');
    const seen: string[] = [];

    expect(() => coordinator.forEach((member) => { seen.push(member); removeA(); })).not.toThrow();

    expect(seen).toEqual(['a', 'b']);
  });

  it('zweimal dasselbe Mitglied anmelden führt es nur einmal', () => {
    const coordinator = createScanCoordinator<string>();
    coordinator.add('a');
    coordinator.add('a');
    const seen: string[] = [];

    coordinator.forEach((member) => { seen.push(member); });

    expect(seen).toEqual(['a']);
  });
});
