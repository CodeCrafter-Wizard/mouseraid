import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/render/engine';
import { S } from '../../../src/ui/strings';

// T1-Review, Minor 4: liefert der Browser WEDER `webgl2` NOCH `webgl`, wirft das ECHTE Babylon
// `Engine` (`Engines/thinEngine.pure.js:236`) schon im Konstruktor seinen eigenen englischen Text
// „WebGL not supported" – VOR unserer eigenen `webGLVersion`-Prüfung. Ohne die `NullEngine` (die
// hat immer eine Version) genügt eine Attrappe wie in `tests/unit/lab/qrRender.test.ts`: nur
// `addEventListener` für die Kontext-Verlust-Zuhörer aus `thinEngine.pure.js` und ein `getContext`,
// das immer `null` liefert.
function fakeCanvasWithoutWebGL(): HTMLCanvasElement {
  const canvas = {
    width: 100,
    height: 100,
    clientWidth: 100,
    clientHeight: 100,
    style: {},
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getContext: () => null,
  };
  return canvas as unknown as HTMLCanvasElement;
}

describe('createEngine: kein WebGL überhaupt', () => {
  it('fängt Babylons eigenen "WebGL not supported"-Wurf und zeigt den deutschen Text', () => {
    let caught: unknown = null;
    try {
      createEngine(fakeCanvasWithoutWebGL(), 'medium', 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message).toBe(S.render.webgl2Missing);
    // Die Ursache bleibt für die Diagnose erhalten (`Diagnose kopieren` zeigt Message + Stack).
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe('WebGL not supported');
  });
});
