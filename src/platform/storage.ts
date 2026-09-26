// Einstellungen des Spiels. In T1 steht hier NUR das Schema: `src/render/quality.ts` leitet
// `QualityTier` daraus ab, und `src/platform` darf `src/render` nicht kennen – umgekehrt schon.
// Der Speicher selbst (`normalizeSettings`, `createMemoryStore`, `openSettingsStore` über `idb`)
// kommt in T5 in dieselbe Datei.

/** Das getypte Schema des EINEN Datensatzes, den der Speicher hält. */
export interface Settings {
  qualityTier: 'low' | 'medium' | 'high';
  overlay: boolean;
}
