// Farben der Graybox – ein Babylon-FREIES Leaf-Modul. In T1 steht hier NUR die Hintergrundfarbe,
// weil `engine.ts` sie braucht; die Farbtafel (`GrayboxKind`, `GRAYBOX_KINDS`, `GRAYBOX_COLORS`,
// `EMISSIVE_SHARE`) kommt in T3 dazu, und `materials.ts` re-exportiert alles.
//
// WARUM ein eigenes Modul und nicht `materials.ts`: Playwrights ESM-Lader löst Babylons
// ERWEITERUNGSLOSE Deep-Importe nicht auf (gemessen in T6: „Cannot find module
// …/@babylonjs/core/Materials/standardMaterial … Did you mean … .js?" und danach „No tests found").
// Ein Tor-Spec, der die Farbtafel importiert, braucht sie deshalb aus einem Modul OHNE Babylon –
// dasselbe Muster, mit dem `src/lab/labTypes.ts` den Haken-Wächter zufriedenstellt.

/**
 * Hintergrundfarbe der Szene (`scene.clearColor`). Sie wohnt HIER und nicht in `engine.ts`, damit
 * der Tor-Spec seine Farben aus EINEM Modul zieht und `engine.ts` – das `S` aus `strings.ts`
 * importiert – nicht in den Node-Typgraphen der Playwright-Specs gerät.
 * GEMESSEN als rgb(28, 33, 64) im Screenshot: der Hintergrund ist exakt diese Farbe.
 */
export const CLEAR_COLOR: readonly [number, number, number] = [0.11, 0.13, 0.25];
