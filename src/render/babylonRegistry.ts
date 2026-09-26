// DIE EINZIGE Datei des Repos mit Babylon-Nebenwirkungs-Importen. Jede andere Datei importiert nur
// Bindungen aus tiefen Pfaden. Babylon 9.27 trennt jedes Modul in `x.pure.js` (nebenwirkungsfrei)
// und `x.js` (`export * from x.pure` + Registrierung) – nur wer `x.js` importiert, bekommt die
// Registrierung. Ein FEHLENDER Nebenwirkungs-Import ist weder ein Build- noch ein Typfehler,
// sondern ein Wurf zur Laufzeit oder eine schwarze Szene.

// Engine-Erweiterungen EINZELN: eine TEILMENGE der Liste aus `Engines/engine.js` – 9 von deren 20
// Nebenwirkungs-Zeilen (nachgezählt in 9.27.1: die Datei hat genau 20 `import '…';` und sonst keine
// Importe), OHNE Textur-Lader (`abstractEngine.textureLoaders`, zieht KTX2- und Basis-Chunks ins
// Bundle), Render-Targets, Ladeschirm und `loadFile` (11 Zeilen ausgelassen: 9 + 11 = 20) –
// plus die zwei Zeitabfrage-Module unten, die in `engine.js` GAR NICHT stehen.
import '@babylonjs/core/Engines/Extensions/engine.alpha';
import '@babylonjs/core/Engines/Extensions/engine.dynamicBuffer';
import '@babylonjs/core/Engines/Extensions/engine.uniformBuffer';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.dom';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.states';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.stencil';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.renderPass';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.texture';
import '@babylonjs/core/Engines/thinEngine.scissor';
// GEMESSEN: ohne diese zwei wirft `EngineInstrumentation.captureGPUFrameTime = true`
// („captureGPUFrameTime is not a function") – KEIN Build- und KEIN Typfehler.
import '@babylonjs/core/Engines/Extensions/engine.query';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery';
// Registriert MeshBuilder.CreateBox / CreateCapsule / CreateGround.
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import '@babylonjs/core/Meshes/Builders/groundBuilder';
// Registriert Scene.DefaultMaterialFactory (scene.defaultMaterial).
import '@babylonjs/core/Materials/standardMaterial';
// Lichter am Scene-Komponenten-System.
import '@babylonjs/core/Lights/hemisphericLight';
import '@babylonjs/core/Lights/directionalLight';

export const BABYLON_SIDE_EFFECT_IMPORTS = 17;
// GEMESSEN: alle 17 Pfade existieren in 9.27.1 UND stehen in Babylons `sideEffects`-Allowlist –
//   Rolldown darf keinen wegkürzen, obwohl das Modul keine Bindung exportiert. Die Konstante macht
//   einen benannten Import möglich (ein nackter gilt zu leicht als „unbenutzt") und ist pinnbar.
// GEMESSEN, warum nicht `Engines/engine`: der Sammel-Import zieht `abstractEngine.textureLoaders` mit
//   -> `basisTextureLoader-*.js` und `ktxTextureLoader-*.js` -> `check-dist` 5 Probleme, 371,9 kB gzip,
//   50 Precache-Dateien. Mit `engine.pure` + dieser Liste: 1 Problem (Doku-URL), 322,5 kB, 26 Dateien.
// NIE benutzen: `@babylonjs/core`, `…/pure`, `…/Engines/engine`, `…/Legacy/**`, `engineFactory`,
//   `webgpuEngine`, `@babylonjs/materials`, jedes `import * as`.
