import { afterEach, describe, expect, it } from 'vitest';
import { WEBGL_VERSION_REQUIRED, createEngine } from '../../../src/render/engine';
import { S } from '../../../src/ui/strings';

/**
 * WAS DIE ATTRAPPEN NICHT KOENNEN – damit niemand hier einen Beweis sucht, den sie nicht tragen:
 * sie rastern nichts, sie haben kein Layout, `width`/`height`/`clientWidth`/`clientHeight`/`style`
 * sind feste Zahlen bzw. ein leeres Objekt, und es gibt kein `window`. Deshalb ist
 * `engine.dispose()` im WebGL1-Zweig NICHT nachweisbar: Babylons `dispose()` haengt das
 * `webglcontextlost`-Ereignis nur ab, wenn `IsWindowObjectExist()` gilt, und eine frisch gebaute
 * Engine hat noch nichts zu loeschen (nachgemessen: der WebGL1-Zweig ruft auf dem Kontext genau
 * `pixelStorei`, mit und ohne `dispose()`). Gepinnt ist hier also der WURF samt Unterscheidung der
 * beiden Zweige – nicht das Aufraeumen.
 */

/**
 * T1-Review, Minor 4: liefert der Browser WEDER `webgl2` NOCH `webgl`, wirft das ECHTE Babylon
 * `Engine` (`Engines/thinEngine.pure.js:236`) schon im Konstruktor seinen eigenen englischen Text
 * „WebGL not supported" – VOR unserer eigenen `webGLVersion`-Pruefung. Ohne die `NullEngine` (die
 * hat immer eine Version) genuegt eine Attrappe wie in `tests/unit/lab/qrRender.test.ts`: nur
 * `addEventListener` fuer die Kontext-Verlust-Zuhoerer aus `thinEngine.pure.js` und ein `getContext`,
 * das immer `null` liefert.
 */
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

/**
 * Ein WebGL1-Kontext, vollstaendig genug fuer Babylons Konstruktor: ALL-CAPS-Namen sind Konstanten
 * (eine Zahl genuegt), alles andere ist eine Funktion. Die drei Abfragen, deren Rueckgabewert Babylon
 * wirklich auswertet, antworten ausdruecklich (`getSupportedExtensions`, `getExtension`,
 * `getParameter`, `getShaderPrecisionFormat`).
 */
function fakeWebGL1(): unknown {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'canvas') return target['canvas'];
      if (prop === 'getSupportedExtensions') return () => [];
      if (prop === 'getExtension') return () => null;
      if (prop === 'getParameter') return () => 4096;
      if (prop === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
      if (/^[A-Z0-9_]+$/.test(prop)) return 1;
      return () => ({});
    },
    has: () => true,
  });
}

/**
 * GEMESSEN, warum beides noetig ist:
 * - `getContext('experimental-webgl2')` fragt Babylon UNMITTELBAR nach `webgl2` ab
 *   (`thinEngine.pure.js:209`). Eine Attrappe, die nur auf `'webgl2'` mit `null` antwortet, liefert
 *   dort ihren Kontext – und Babylon setzt `_webGLVersion = 2`. Der WebGL1-Zweig war so nicht
 *   erreichbar.
 * - Babylon prueft `canvasOrContext instanceof WebGL2RenderingContext`; diese Klasse gibt es im
 *   Node-Umfeld nicht, und die Pruefung wirft `ReferenceError: WebGL2RenderingContext is not
 *   defined`. Der Wurf landete in unserem Konstruktor-`catch` und truege eine `cause` – also genau
 *   NICHT der Zweig, der hier geprueft werden soll.
 */
function fakeCanvasWithWebGL1(): HTMLCanvasElement {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['WebGL2RenderingContext'] = class {};
  globals['WebGLRenderingContext'] = class {};
  const gl = fakeWebGL1();
  const canvas = {
    width: 100,
    height: 100,
    clientWidth: 100,
    clientHeight: 100,
    style: {},
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getContext: (kind: string) => (kind === 'webgl' || kind === 'experimental-webgl' ? gl : null),
  };
  (gl as Record<string, unknown>)['canvas'] = canvas;
  return canvas as unknown as HTMLCanvasElement;
}

afterEach(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals['WebGL2RenderingContext'];
  delete globals['WebGLRenderingContext'];
});

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

// Abschlussreview MIN-21: der WebGL1-Zweig (`engine.webGLVersion !== 2` -> `dispose()` + Wurf) war
// von keinem Fall berührt – beide Zweige werfen denselben Text, nur einer hängt eine `cause` an, ein
// `===` statt `!==` wäre also still durchgekommen.
describe('createEngine: WebGL1 statt WebGL2', () => {
  it('wirft denselben deutschen Text, aber OHNE cause – der eigene Zweig, nicht Babylons Wurf', () => {
    let caught: unknown = null;
    try {
      createEngine(fakeCanvasWithWebGL1(), 'medium', 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message).toBe(S.render.webgl2Missing);
    // DAS unterscheidet die beiden Zweige: Babylons Konstruktor ist gar nicht gestolpert, die Engine
    // stand – sie hatte nur die falsche Version. Ohne diese Zeile wäre der Fall auch mit der
    // Attrappe oben grün.
    expect(error.cause, 'der WebGL1-Zweig hängt keine Ursache an').toBeUndefined();
    expect(WEBGL_VERSION_REQUIRED).toBe(2);
  });
});
