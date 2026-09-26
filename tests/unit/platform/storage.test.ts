import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_DB,
  SETTINGS_DB_VERSION,
  SETTINGS_KEY,
  SETTINGS_STORE,
  applySearchOverrides,
  createMemoryStore,
  normalizeSettings,
  openSettingsStore,
  type Settings,
} from '../../../src/platform/storage';

/**
 * Geprueft werden der REINE Normalisierer, der Speicher-Adapter und die URL-Uebersteuerung. Der
 * `idb`-Mantel selbst bleibt ABSICHTLICH ungetestet (D10): er ist duenn, und ein Nachbau von
 * IndexedDB (`fake-indexeddb`) waere eine neue Abhaengigkeit fuer den Beweis, dass `openDB` tut,
 * was sein Vertrag sagt. Geprueft wird stattdessen der RUECKFALL – die einzige Stelle, an der der
 * Mantel eine eigene Entscheidung trifft.
 */
function setIndexedDb(value: unknown): void {
  (globalThis as unknown as { indexedDB?: unknown }).indexedDB = value;
}
function clearIndexedDb(): void {
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
}

afterEach(clearIndexedDb);

describe('normalizeSettings', () => {
  it('liefert die Vorgaben fuer alles, was kein Objekt ist', () => {
    for (const raw of [undefined, null, 42, 'high', true, Symbol('x')]) {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('nimmt eine vollstaendige, gueltige Einstellung unveraendert an', () => {
    expect(normalizeSettings({ qualityTier: 'low', overlay: true })).toEqual({ qualityTier: 'low', overlay: true });
    expect(normalizeSettings({ qualityTier: 'medium', overlay: false })).toEqual({ qualityTier: 'medium', overlay: false });
  });

  it('verwirft eine unbekannte Stufe und behaelt den Rest', () => {
    expect(normalizeSettings({ qualityTier: 'ultra', overlay: true }))
      .toEqual({ qualityTier: DEFAULT_SETTINGS.qualityTier, overlay: true });
    // Gross-/Kleinschreibung wird NICHT geraten: 'High' ist keine der drei Stufen.
    expect(normalizeSettings({ qualityTier: 'High', overlay: false }).qualityTier).toBe(DEFAULT_SETTINGS.qualityTier);
  });

  it('verlangt fuer `overlay` einen echten Boolean – 1 und "true" sind keiner', () => {
    expect(normalizeSettings({ qualityTier: 'low', overlay: 1 }).overlay).toBe(false);
    expect(normalizeSettings({ qualityTier: 'low', overlay: 'true' }).overlay).toBe(false);
    expect(normalizeSettings({ qualityTier: 'low', overlay: null }).overlay).toBe(false);
  });

  it('fuellt fehlende Felder aus den Vorgaben und verwirft fremde Felder', () => {
    const value = normalizeSettings({ overlay: true, fpsLimit: 30, tier: 'low' });
    expect(value).toEqual({ qualityTier: DEFAULT_SETTINGS.qualityTier, overlay: true });
    // Genau ZWEI Felder: ein fremdes Feld darf nicht in den geschriebenen Datensatz wandern.
    expect(Object.keys(value).sort()).toEqual(['overlay', 'qualityTier']);
  });

  it('nimmt ein Array nicht als Datensatz und liefert die Vorgaben', () => {
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(['low'])).toEqual(DEFAULT_SETTINGS);
  });

  it('gibt immer ein FRISCHES Objekt – niemand bekommt `DEFAULT_SETTINGS` in die Hand', () => {
    const value = normalizeSettings(undefined);
    expect(value).not.toBe(DEFAULT_SETTINGS);
    value.overlay = true;
    expect(DEFAULT_SETTINGS.overlay).toBe(false);
  });

  it('pinnt die Vorgaben und die Kennungen der Datenbank', () => {
    expect(DEFAULT_SETTINGS).toEqual({ qualityTier: 'high', overlay: false });
    expect([SETTINGS_DB, SETTINGS_STORE, SETTINGS_KEY, SETTINGS_DB_VERSION]).toEqual(['maeusebau', 'settings', 'v1', 1]);
  });
});

describe('createMemoryStore', () => {
  it('startet mit den Vorgaben und meldet `memory`', () => {
    const store = createMemoryStore();
    expect(store.backend()).toBe('memory');
    expect(store.get('qualityTier')).toBe('high');
    expect(store.get('overlay')).toBe(false);
  });

  it('nimmt einen Teil-Datensatz an und fuellt den Rest auf', () => {
    const store = createMemoryStore({ qualityTier: 'low' });
    expect(store.get('qualityTier')).toBe('low');
    expect(store.get('overlay')).toBe(false);
  });

  it('normalisiert auch den Startwert – aus der Datenbank kommt Unsinn, nicht ein `Settings`', () => {
    const store = createMemoryStore({ qualityTier: 'ultra' } as unknown as Partial<Settings>);
    expect(store.get('qualityTier')).toBe(DEFAULT_SETTINGS.qualityTier);
  });

  it('liest nach dem Schreiben SOFORT den neuen Wert – `get` ist synchron', async () => {
    const store = createMemoryStore();
    const pending = store.set('qualityTier', 'medium');
    // Kein `await` dazwischen: die Engine braucht die Stufe, bevor das erste Bild faellt.
    expect(store.get('qualityTier')).toBe('medium');
    await expect(pending).resolves.toBeUndefined();
    expect(store.get('qualityTier')).toBe('medium');
  });

  it('haelt zwei Speicher getrennt', async () => {
    const first = createMemoryStore();
    const second = createMemoryStore();
    await first.set('overlay', true);
    expect(first.get('overlay')).toBe(true);
    expect(second.get('overlay')).toBe(false);
  });
});

describe('openSettingsStore: Rueckfall', () => {
  it('faellt auf den Speicher zurueck, wenn es kein IndexedDB gibt (privater Modus, Node)', async () => {
    clearIndexedDb();
    const store = await openSettingsStore();
    expect(store.backend()).toBe('memory');
    expect(store.get('qualityTier')).toBe(DEFAULT_SETTINGS.qualityTier);
    // Auch der Rueckfall nimmt Schreibvorgaenge an – ein gesperrter Speicher haelt das Spiel nicht an.
    await expect(store.set('overlay', true)).resolves.toBeUndefined();
    expect(store.get('overlay')).toBe(true);
  });

  it('faellt auf den Speicher zurueck, wenn `indexedDB.open` wirft', async () => {
    let calls = 0;
    setIndexedDb({
      open: (): never => {
        calls += 1;
        throw new Error('Zugriff verweigert');
      },
    });
    const store = await openSettingsStore();
    expect(calls).toBe(1);
    expect(store.backend()).toBe('memory');
    expect(store.get('overlay')).toBe(false);
  });

  it('faellt auf den Speicher zurueck, wenn `openDB` selbst scheitert – nicht nur `indexedDB.open`', async () => {
    // Die Attrappe liefert eine Anfrage, die keine echte `IDBRequest` ist. `idb` prueft in `wrap`
    // `value instanceof IDBRequest`, und diese Klasse gibt es im Node-Umfeld nicht – GEMESSEN wirft
    // es `ReferenceError: IDBRequest is not defined`. Der Fall pinnt damit genau das, was er pinnen
    // kann: das `try` umspannt `openDB` UND das Lesen, nicht nur den Aufruf `indexedDB.open`.
    setIndexedDb({ open: () => ({ addEventListener: () => {}, removeEventListener: () => {} }) });
    const store = await openSettingsStore();
    expect(store.backend()).toBe('memory');
    await expect(store.set('qualityTier', 'low')).resolves.toBeUndefined();
    expect(store.get('qualityTier')).toBe('low');
  });
});

describe('applySearchOverrides', () => {
  const stored: Settings = { qualityTier: 'low', overlay: false };

  it('laesst ohne Parameter alles stehen und gibt ein frisches Objekt', () => {
    const value = applySearchOverrides(stored, new URLSearchParams(''));
    expect(value).toEqual(stored);
    expect(value).not.toBe(stored);
  });

  it('die URL gewinnt gegen den gespeicherten Wert – sonst waere der Stufen-Sweep hier nicht ausloesbar', () => {
    expect(applySearchOverrides(stored, new URLSearchParams('tier=high')).qualityTier).toBe('high');
    expect(applySearchOverrides(stored, new URLSearchParams('tier=medium')).qualityTier).toBe('medium');
    expect(applySearchOverrides({ qualityTier: 'high', overlay: false }, new URLSearchParams('tier=low')).qualityTier).toBe('low');
  });

  it('verwirft eine unbekannte Stufe und behaelt den gespeicherten Wert', () => {
    expect(applySearchOverrides(stored, new URLSearchParams('tier=ultra')).qualityTier).toBe('low');
    expect(applySearchOverrides(stored, new URLSearchParams('tier=')).qualityTier).toBe('low');
  });

  it('schaltet das Overlay nur bei `overlay=1` ein und bei `overlay=0` aus', () => {
    expect(applySearchOverrides(stored, new URLSearchParams('overlay=1')).overlay).toBe(true);
    expect(applySearchOverrides({ qualityTier: 'low', overlay: true }, new URLSearchParams('overlay=0')).overlay).toBe(false);
    // Unsinn uebersteuert nicht: der gespeicherte Wert bleibt.
    expect(applySearchOverrides({ qualityTier: 'low', overlay: true }, new URLSearchParams('overlay=ja')).overlay).toBe(true);
    expect(applySearchOverrides(stored, new URLSearchParams('overlay=ja')).overlay).toBe(false);
  });

  it('nimmt beide Parameter zusammen', () => {
    const value = applySearchOverrides(stored, new URLSearchParams('tier=medium&overlay=1&autostart=1'));
    expect(value).toEqual({ qualityTier: 'medium', overlay: true });
  });
});
