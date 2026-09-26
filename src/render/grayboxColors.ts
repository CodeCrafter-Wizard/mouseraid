// Farbtafel der Graybox – ein Babylon-FREIES Leaf-Modul.
//
// WARUM ein eigenes Modul und nicht `materials.ts`: Playwrights ESM-Lader löst Babylons
// ERWEITERUNGSLOSE Deep-Importe nicht auf (gemessen in T6: „Cannot find module
// …/@babylonjs/core/Materials/standardMaterial … Did you mean … .js?" und danach „No tests found").
// Der Tor-Spec importiert die Farbtafel, braucht sie also aus einem Modul OHNE Babylon – dasselbe
// Muster, mit dem `src/lab/labTypes.ts` den Haken-Wächter zufriedenstellt. `materials.ts`
// re-exportiert alles von hier, damit keine Signatur wandert.
//
// Die Farbe sagt, WAS ein Körper ist – nicht, was er aufhält: die Masken sieht man in `?view=2d`.

export type GrayboxKind =
  | 'wall' | 'shelfLeg' | 'shelfCanopy' | 'crate' | 'counter' | 'vitrine' | 'window'
  | 'plant' | 'holePlug' | 'floor' | 'floorBurrow' | 'mouse' | 'mouseWeak' | 'cat';

/** Reihenfolge = die der Typ-Union oben. Ein Test hält beide Listen aneinander. */
export const GRAYBOX_KINDS: readonly GrayboxKind[] = [
  'wall', 'shelfLeg', 'shelfCanopy', 'crate', 'counter', 'vitrine', 'window',
  'plant', 'holePlug', 'floor', 'floorBurrow', 'mouse', 'mouseWeak', 'cat',
];

/**
 * Grundfarben als RGB in [0, 1]. Vierzehn Einträge, jeder mit einem Grund – die TAFEL ist Vertrag,
 * die Zahl ist ein erster Entwurf und wird in T7 am Bild beurteilt.
 */
export const GRAYBOX_COLORS: Readonly<Record<GrayboxKind, readonly [number, number, number]>> = {
  // Wände kühl und neutral: sie sind die Bühne, nichts darauf soll mit ihnen verwechselt werden.
  wall: [0.38, 0.41, 0.45],
  // Regal: zwei Bernsteintöne. Das Bein ist dunkler als der Baldachin, damit der Spalt darunter
  // (durch den nur die Maus passt) auch im Standbild als Spalt zu erkennen ist.
  shelfLeg: [0.55, 0.38, 0.16],
  shelfCanopy: [0.72, 0.52, 0.24],
  // Die vier Kistenarten liegen absichtlich weit auseinander – `kind` ist die einzige Angabe, die
  // sie unterscheidet, und in der Graybox soll man sie ohne Overlay auseinanderhalten.
  crate: [0.62, 0.45, 0.28],
  counter: [0.45, 0.33, 0.26],
  vitrine: [0.30, 0.55, 0.60],
  window: [0.72, 0.80, 0.86],
  plant: [0.24, 0.50, 0.26],
  // Der Stopfen im Mauseloch ist dunkler als jede Wand: er ist kein Bauteil, sondern eine Sperre.
  holePlug: [0.22, 0.24, 0.28],
  // Böden warm und deutlich heller als die Wände, sonst versinkt die Szene.
  floor: [0.66, 0.56, 0.46],
  // Der Bau ist HELLER als der Laden – im Bild der Beweis, dass er den Diorama-Modus trägt.
  floorBurrow: [0.80, 0.70, 0.58],
  // Die Figuren sind die hellsten Körper der Szene, die Katze der einzige satte Farbfleck.
  mouse: [0.85, 0.80, 0.78],
  mouseWeak: [0.62, 0.55, 0.54],
  cat: [0.55, 0.30, 0.14],
};

/** Anteil der Grundfarbe, der als Eigenleuchten dazukommt – hebt die Schattenseite aus dem Schwarz. */
export const EMISSIVE_SHARE = 0.12;

/**
 * Hintergrundfarbe der Szene (`scene.clearColor`). Sie wohnt HIER und nicht in `engine.ts`, damit
 * der Tor-Spec seine Farben aus EINEM Modul zieht und `engine.ts` – das `S` aus `strings.ts`
 * importiert – nicht in den Node-Typgraphen der Playwright-Specs gerät.
 * GEMESSEN als rgb(28, 33, 64) im Screenshot: der Hintergrund ist exakt diese Farbe.
 */
export const CLEAR_COLOR: readonly [number, number, number] = [0.11, 0.13, 0.25];
