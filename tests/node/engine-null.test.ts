// Der einzige Test in M5, der die NEBENWIRKUNGEN aus `src/render/babylonRegistry.ts` prüft. Ein
// fehlender Nebenwirkungs-Import ist weder ein Build- noch ein Typfehler, sondern ein Wurf zur
// Laufzeit oder eine schwarze Szene: genau daran starb der erste Prototyp-Lauf
// („captureGPUFrameTime is not a function"). Der Test liegt in `tests/node`, weil er eine Quelldatei
// LIEST und echtes Babylon gegen die `NullEngine` fährt – dieselbe Ablage wie der Bounds-Test in T3.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene.pure';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BABYLON_SIDE_EFFECT_IMPORTS } from '../../src/render/babylonRegistry';

const REGISTRY = 'src/render/babylonRegistry.ts';

/** Die Sammel-Einstiege, die das Bundle sprengen würden – keiner darf in der Registry stehen. */
const FORBIDDEN_SPECIFIERS = [
  "'@babylonjs/core'",
  "'@babylonjs/core/pure'",
  "'@babylonjs/core/Engines/engine'",
  "'@babylonjs/core/Legacy",
  'engineFactory',
  'webgpuEngine',
  'textureLoaders',
  '@babylonjs/materials',
];

/** Alle `.ts` unter einem Ordner, rekursiv, mit `/`-Trennern. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name).split('\\').join('/');
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

describe('babylonRegistry', () => {
  it('hält genau so viele Nebenwirkungs-Importe, wie die Konstante behauptet', () => {
    const lines = readFileSync(REGISTRY, 'utf8')
      .split('\n')
      .filter((line) => /^import '@babylonjs\/core\/[^']+';$/.test(line));
    expect(lines).toHaveLength(BABYLON_SIDE_EFFECT_IMPORTS);
    expect(BABYLON_SIDE_EFFECT_IMPORTS).toBe(17);
  });

  it('nennt keinen Sammel-Einstieg – nur tiefe Pfade', () => {
    const code = readFileSync(REGISTRY, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n');
    expect(FORBIDDEN_SPECIFIERS.filter((bad) => code.includes(bad))).toEqual([]);
  });

  it('ist die einzige Datei unter src/ mit einem Babylon-Nebenwirkungs-Import', () => {
    // Gegenprobe zur ESLint-Schranke: ESLint verbietet die Barrel-Pfade, aber NICHT einen zweiten
    // nackten `import '@babylonjs/core/Meshes/Builders/boxBuilder';` in einem anderen Modul. Geprüft
    // wird der GANZE Quellbaum, nicht nur `engine.ts` – der Fallname behauptet eine Aussage über
    // `src/**`, also muss sie über `src/**` geprüft sein (R20). Gezählt werden nur NACKTE Importe;
    // die Bindungs-Importe von T3–T5 (`import { CreateBox } from …`) sind davon nicht betroffen.
    const withBare = sourceFiles('src').filter((file) =>
      /^import '@babylonjs\//m.test(readFileSync(file, 'utf8')));
    expect(withBare).toEqual([REGISTRY]);
    // Und die Registry wird wirklich gezogen: `engine.ts` importiert sie als erste Zeile.
    expect(readFileSync('src/render/engine.ts', 'utf8')).toContain("import './babylonRegistry';");
  });
});

describe('Nebenwirkungen gegen Babylons NullEngine', () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it('Materials/standardMaterial registriert Scene.DefaultMaterialFactory', () => {
    // Ohne diesen Import wirft `scene.defaultMaterial` – und zwar erst, wenn das erste Mesh
    // gezeichnet werden soll.
    expect(scene.defaultMaterial).toBeTruthy();
  });

  it('die beiden Licht-Importe hängen sich am Szenen-Komponentensystem ein', () => {
    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    new DirectionalLight('dir', new Vector3(-0.4, -1, 0.25), scene);
    expect(scene.lights).toHaveLength(2);
  });

  // DER Grund für `engine.query` + `abstractEngine.timeQuery` in der Registry: ohne die zwei wirft
  // diese Zuweisung „this.engine.captureGPUFrameTime is not a function" – zur LAUFZEIT.
  it('EngineInstrumentation.captureGPUFrameTime lässt sich setzen, ohne zu werfen', () => {
    const instrumentation = new EngineInstrumentation(engine);
    expect(() => {
      instrumentation.captureGPUFrameTime = true;
    }).not.toThrow();
    expect(instrumentation.captureGPUFrameTime).toBe(true);
    // GEMESSEN: der Zähler bleibt 0 – unter SwiftShader fehlt EXT_disjoint_timer_query_webgl2, und
    // die NullEngine rastert gar nicht. Deshalb zeigt das Overlay „–", und KEIN Test verlangt mehr.
    // `>= 0` statt `=== 0`: Q2 verbietet nur, `> 0` zu VERLANGEN, und eine künftige Babylon-Version
    // darf hier eine Zahl liefern, ohne diesen Fall rot zu machen.
    expect(instrumentation.gpuFrameTimeCounter.current).toBeGreaterThanOrEqual(0);
    instrumentation.dispose();
  });
});
