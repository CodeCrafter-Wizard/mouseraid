import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GRID_STEP, effectiveOverlay } from '../../../src/render/gameMain';
import { createDebugOverlay } from '../../../src/render/debugOverlay';
import { DEFAULT_SEED } from '../../../src/modes/soloSession';

/**
 * `mountGame` selbst ist hier NICHT geprueft: es baut eine echte Babylon-`Engine` und braucht dafuer
 * einen WebGL2-Kontext, den keine Attrappe liefert – die Verdrahtung beweist das E2E-Tor
 * (`tests/e2e/graybox.spec.ts`). Geprueft wird die eine REINE Entscheidung, die aus einem
 * Review-Befund entstanden ist: welcher Overlay-Zustand gilt, wenn der asynchrone Speicher
 * nachtraeglich antwortet (Task-6-Review, Minor 4).
 *
 * WAS DIE ATTRAPPE NICHT KANN – damit niemand hier einen Beweis sucht, den sie nicht traegt: sie hat
 * kein Layout, `hidden` verbirgt nichts, `textContent` loest keinen Layout-Lauf aus, und es gibt
 * keinen Tastaturweg (`keydown` verdrahtet `mountGame`, nicht das Overlay). Sie liefert genau
 * `createElement('pre')` mit `className`, `dataset`, `hidden`, `textContent` und `remove()`.
 */
interface FakeElement {
  tag: string;
  className: string;
  dataset: Record<string, string>;
  hidden: boolean;
  textContent: string;
  remove(): void;
}

function installFakeDom(): void {
  const fakeDocument = {
    createElement: (tag: string): FakeElement => {
      const element: FakeElement = {
        tag, className: '', dataset: {}, hidden: false, textContent: '',
        remove: () => undefined,
      };
      return element;
    },
  };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;
}

function fakeHost(): HTMLElement {
  return { append: (): void => undefined } as unknown as HTMLElement;
}

beforeEach(installFakeDom);
afterEach(() => { delete (globalThis as unknown as { document?: unknown }).document; });

describe('gameMain: effectiveOverlay', () => {
  it('nimmt den GESPEICHERTEN Wert, solange der Nutzer F3 nicht getippt hat', () => {
    expect(effectiveOverlay(true, false, false)).toBe(true);
    expect(effectiveOverlay(false, false, true)).toBe(false);
  });

  it('nimmt den AKTUELLEN Wert, sobald F3 getippt wurde – der Speicher dreht nichts zurueck', () => {
    expect(effectiveOverlay(false, true, true)).toBe(true);
    expect(effectiveOverlay(true, true, false)).toBe(false);
  });

  // Der Ablauf am echten Overlay: F3 VOR dem Oeffnen des Speichers. Ohne die Merkzelle setzte der
  // Erfuellungszweig `overlay.setVisible(effective.overlay)` und nahm die Umschaltung zurueck.
  it('haelt die F3-Umschaltung, wenn der Speicher DANACH den alten Wert liefert', () => {
    const overlay = createDebugOverlay(fakeHost());
    overlay.setVisible(false);
    // Der Nutzer tippt F3, bevor `openSettingsStore()` erfuellt ist.
    expect(overlay.toggle()).toBe(true);
    const touched = true;
    // Jetzt antwortet der Speicher mit dem alten `overlay: false`.
    overlay.setVisible(effectiveOverlay(false, touched, overlay.visible()));
    expect(overlay.visible(), 'die Entscheidung des Nutzers gewinnt').toBe(true);
  });

  it('laesst den gespeicherten Wert gewinnen, wenn niemand getippt hat', () => {
    const overlay = createDebugOverlay(fakeHost());
    overlay.setVisible(false);
    overlay.setVisible(effectiveOverlay(true, false, overlay.visible()));
    expect(overlay.visible(), 'ohne F3 gilt der Speicher').toBe(true);
  });
});

describe('gameMain: Konstanten', () => {
  it('teilt DEFAULT_SEED mit der Sitzung – es gibt nur EINE', () => {
    // Abschlussreview (contract Minor 2 / quality MIN-12): `gameMain` hatte eine eigene
    // `DEFAULT_SEED = '1'` (Zeichenkette) neben der Zahl in `soloSession`; zwei Konstanten gleichen
    // Namens mit verschiedenen Typen und kein Test, der sie aneinanderhaelt. Jetzt importiert
    // `gameMain` sie – dass hier noch etwas zu pinnen bleibt, ist der Typ.
    expect(DEFAULT_SEED).toBe(1);
    expect(typeof DEFAULT_SEED).toBe('number');
  });

  it('pinnt die Rasterweite von `cmd.grid` – 16 x 16 = 256 Proben, wie im Tor', () => {
    expect(GRID_STEP).toBe(16);
    expect(GRID_STEP * GRID_STEP).toBe(256);
  });
});
