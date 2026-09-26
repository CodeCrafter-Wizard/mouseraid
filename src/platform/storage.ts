// Einstellungen des Spiels. In T1 steht hier NUR das Schema: `src/render/quality.ts` leitet
// `QualityTier` daraus ab, und `src/platform` darf `src/render` nicht kennen – umgekehrt schon.
// Der Speicher selbst (`normalizeSettings`, `createMemoryStore`, `openSettingsStore` über `idb`)
// kommt in T5 in dieselbe Datei.
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
/** EIN Datensatz haelt alle Einstellungen: ein Schema-Wechsel bekommt einen neuen Schluessel. */
export const SETTINGS_KEY = 'v1';
/** URL-Parameter, die den gespeicherten Wert uebersteuern (nur Entwicklung und Tests). */
export const SEARCH_TIER = 'tier';
export const SEARCH_OVERLAY = 'overlay';

export type SettingsBackend = 'idb' | 'memory';

export interface SettingsStore {
  /**
   * SYNCHRON: der Speicher liest den einen Datensatz beim Oeffnen, normalisiert ihn und haelt ihn im
   * Arbeitsspeicher. Die Engine braucht eine Stufe, BEVOR das erste Bild faellt, und ein `await` je
   * Lesevorgang verteilte `void …then()` durch die Renderschleife.
   */
  get<K extends keyof Settings>(key: K): Settings[K];
  /**
   * Das Schreiben ist wirklich asynchron. Es scheitert LEISE (das Versprechen wird auch dann
   * erfuellt): ein gesperrter Speicher darf das Spiel nicht anhalten. Der Wert im Arbeitsspeicher
   * steht sofort, also liest `get` ihn ohne `await`.
   */
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  backend(): SettingsBackend;
}

/**
 * Die drei Stufen stehen hier als Literale und nicht als Liste aus `src/render/quality.ts`: diese
 * Schicht darf `src/render` nicht importieren (siehe Kommentar an `Settings`).
 */
function isQualityTier(value: unknown): value is Settings['qualityTier'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * REIN und wirft NIE: aus dem Datensatz der Datenbank – der alles sein kann, auch der einer aelteren
 * Fassung – wird ein gueltiges `Settings`. Jedes Feld wird einzeln geprueft, Fehlendes und
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
 * REIN: `?tier=low|medium|high` und `?overlay=1|0` uebersteuern den gespeicherten Wert. Ein Wert,
 * der keiner der erlaubten ist, wird VERWORFEN (der gespeicherte gewinnt) – geraten wird nichts.
 * Ohne diesen Weg waere der Stufen-Sweep am Entwicklungsrechner gar nicht ausloesbar (DPR 1,0).
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
 * Erfuellt dieselbe Schnittstelle wie der `idb`-Speicher und ist zugleich der Rueckfall fuer den
 * privaten Modus, fuer Node (Vitest) und fuer jeden Fehler beim Oeffnen. `initial` wird
 * normalisiert: was aus der Datenbank kommt, ist kein `Settings`, bis es geprueft ist.
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
 * Oeffnet die Einstellungen ueber `idb`, liest den EINEN Datensatz, normalisiert ihn und haelt ihn
 * im Arbeitsspeicher. JEDER Fehler (kein `indexedDB`, verweigerter Zugriff, Fehler beim Lesen)
 * endet im `catch` und liefert `createMemoryStore()` – das Spiel laeuft dann mit den Vorgaben
 * weiter, und `backend()` meldet `'memory'`, damit ein stiller Rueckfall im Overlay auffaellt.
 *
 * Der `idb`-Mantel ist ABSICHTLICH ungetestet (D10): er ist duenn, und ein Nachbau von IndexedDB
 * waere eine neue Abhaengigkeit. Geprueft sind `normalizeSettings`, `createMemoryStore` und der
 * Rueckfall – die einzigen Stellen mit einer eigenen Entscheidung.
 */
export async function openSettingsStore(): Promise<SettingsStore> {
  if (typeof indexedDB === 'undefined') return createMemoryStore();
  try {
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
        // Der ganze normalisierte Datensatz geht zurueck – ein Teil-Schreibvorgang liesse eine
        // aeltere Fassung des anderen Feldes stehen. Fehler werden geschluckt (siehe `set` oben).
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
