// Einstellungen des Spiels: das getypte Schema, der reine Normalisierer, die URL-Übersteuerung und
// der Speicher über `idb` mit Arbeitsspeicher-Rückfall.
//
// Das SCHEMA steht hier und nicht in `src/render/quality.ts`, weil `src/platform` die unterste
// Browser-Schicht ist: sie darf `src/render` nicht kennen (ESLint erzwingt es), umgekehrt schon.
// `quality.ts` leitet `QualityTier` deshalb aus `Settings['qualityTier']` ab – eine zweite Liste
// liefe beim ersten neuen Namen auseinander.
import { openDB } from 'idb';

/** Das getypte Schema des EINEN Datensatzes, den der Speicher hält. */
export interface Settings {
  qualityTier: 'low' | 'medium' | 'high';
  overlay: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { qualityTier: 'high', overlay: false };
export const SETTINGS_DB = 'maeusebau';
export const SETTINGS_STORE = 'settings';
export const SETTINGS_DB_VERSION = 1;
/** EIN Datensatz hält alle Einstellungen: ein Schema-Wechsel bekommt einen neuen Schlüssel. */
export const SETTINGS_KEY = 'v1';
/** URL-Parameter, die den gespeicherten Wert übersteuern (nur Entwicklung und Tests). */
export const SEARCH_TIER = 'tier';
export const SEARCH_OVERLAY = 'overlay';

export type SettingsBackend = 'idb' | 'memory';

export interface SettingsStore {
  /**
   * SYNCHRON: der Speicher liest den einen Datensatz beim Öffnen, normalisiert ihn und hält ihn im
   * Arbeitsspeicher. Die Engine braucht eine Stufe, BEVOR das erste Bild fällt, und ein `await` je
   * Lesevorgang verteilte `void …then()` durch die Renderschleife.
   */
  get<K extends keyof Settings>(key: K): Settings[K];
  /**
   * Das Schreiben ist wirklich asynchron. Es scheitert LEISE (das Versprechen wird auch dann
   * erfüllt): ein gesperrter Speicher darf das Spiel nicht anhalten. Der Wert im Arbeitsspeicher
   * steht sofort, also liest `get` ihn ohne `await`.
   */
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  backend(): SettingsBackend;
}

/**
 * Die drei Stufen stehen hier als Literale und nicht als Liste aus `src/render/quality.ts`: diese
 * Schicht darf `src/render` nicht importieren (siehe Kopfkommentar).
 */
function isQualityTier(value: unknown): value is Settings['qualityTier'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

/** `!Array.isArray`: ein Array MIT den Feldern käme sonst als Datensatz durch (Task-5-Review, Minor 4). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * REIN und wirft NIE: aus dem Datensatz der Datenbank – der alles sein kann, auch der einer älteren
 * Fassung – wird ein gültiges `Settings`. Jedes Feld wird einzeln geprüft, Fehlendes und
 * Unpassendes kommt aus `DEFAULT_SETTINGS`, fremde Felder fallen weg (das Ergebnis wird frisch
 * gebaut). Das Ergebnis ist immer ein NEUES Objekt – niemand bekommt `DEFAULT_SETTINGS` in die Hand.
 */
export function normalizeSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return { qualityTier: DEFAULT_SETTINGS.qualityTier, overlay: DEFAULT_SETTINGS.overlay };
  const tier = raw['qualityTier'];
  const overlay = raw['overlay'];
  return {
    qualityTier: isQualityTier(tier) ? tier : DEFAULT_SETTINGS.qualityTier,
    overlay: typeof overlay === 'boolean' ? overlay : DEFAULT_SETTINGS.overlay,
  };
}

/**
 * REIN: `?tier=low|medium|high` und `?overlay=1|0` übersteuern den gespeicherten Wert. Ein Wert,
 * der keiner der erlaubten ist, wird VERWORFEN (der gespeicherte gewinnt) – geraten wird nichts.
 * Ohne diesen Weg wäre der Stufen-Sweep am Entwicklungsrechner gar nicht auslösbar (DPR 1,0).
 */
export function applySearchOverrides(settings: Settings, search: URLSearchParams): Settings {
  const out: Settings = { qualityTier: settings.qualityTier, overlay: settings.overlay };
  const tier = search.get(SEARCH_TIER);
  if (isQualityTier(tier)) out.qualityTier = tier;
  const overlay = search.get(SEARCH_OVERLAY);
  if (overlay === '1') out.overlay = true;
  if (overlay === '0') out.overlay = false;
  return out;
}

/**
 * Erfüllt dieselbe Schnittstelle wie der `idb`-Speicher und ist zugleich der Rückfall für den
 * privaten Modus, für Node (Vitest) und für jeden Fehler beim Öffnen. `initial` wird
 * normalisiert: was aus der Datenbank kommt, ist kein `Settings`, bis es geprüft ist.
 */
export function createMemoryStore(initial?: Partial<Settings>): SettingsStore {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...initial });
  return {
    get: <K extends keyof Settings>(key: K): Settings[K] => settings[key],
    set: <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> => {
      settings[key] = value;
      return Promise.resolve();
    },
    backend: (): SettingsBackend => 'memory',
  };
}

/**
 * Öffnet die Einstellungen über `idb`, liest den EINEN Datensatz, normalisiert ihn und hält ihn
 * im Arbeitsspeicher. JEDER Fehler (kein `indexedDB`, verweigerter Zugriff, Fehler beim Lesen)
 * endet im `catch` und liefert `createMemoryStore()` – das Spiel läuft dann mit den Vorgaben
 * weiter, und `backend()` meldet `'memory'`, damit ein stiller Rückfall im Overlay auffällt.
 *
 * Der `idb`-Mantel ist ABSICHTLICH ungetestet (D10): er ist dünn, und ein Nachbau von IndexedDB
 * wäre eine neue Abhängigkeit. Geprüft sind `normalizeSettings`, `createMemoryStore` und der
 * Rückfall – die einzigen Stellen mit einer eigenen Entscheidung.
 */
export async function openSettingsStore(): Promise<SettingsStore> {
  try {
    // Der `typeof`-Wächter steht IM `try`: `indexedDB` ist ein Accessor auf
    // `WindowOrWorkerGlobalScope`, und in einem `sandbox`-iframe ohne `allow-same-origin` bzw. bei
    // gesperrten Website-Daten kann schon der Getter WERFEN. Vor dem `try` verließ diese Ausnahme
    // die Funktion, und der zugesagte stille Rückfall galt genau dort nicht (Abschlussreview,
    // determinism Minor 2).
    if (typeof indexedDB === 'undefined') return createMemoryStore();
    const db = await openDB(SETTINGS_DB, SETTINGS_DB_VERSION, {
      upgrade(open) {
        if (!open.objectStoreNames.contains(SETTINGS_STORE)) open.createObjectStore(SETTINGS_STORE);
      },
    });
    const settings = normalizeSettings(await db.get(SETTINGS_STORE, SETTINGS_KEY));
    return {
      get: <K extends keyof Settings>(key: K): Settings[K] => settings[key],
      set: <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> => {
        settings[key] = value;
        // Der ganze normalisierte Datensatz geht zurück – ein Teil-Schreibvorgang ließe eine
        // ältere Fassung des anderen Feldes stehen. Fehler werden geschluckt (siehe `set` oben).
        try {
          return db.put(SETTINGS_STORE, { qualityTier: settings.qualityTier, overlay: settings.overlay }, SETTINGS_KEY)
            .then(() => undefined, () => undefined);
        } catch {
          return Promise.resolve();
        }
      },
      backend: (): SettingsBackend => 'idb',
    };
  } catch {
    return createMemoryStore();
  }
}
