import './babylonRegistry';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Engine } from '@babylonjs/core/Engines/engine.pure';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene.pure';
import { S } from '../ui/strings';
import { CLEAR_COLOR } from './grayboxColors';
import { hardwareScaling, type QualityTier } from './quality';

/** WebGL2 ist Pflicht: WebGL1 liefert weder die Uniform-Buffer noch die Zeitabfragen, die wir nutzen. */
export const WEBGL_VERSION_REQUIRED = 2;

export interface GameEngine {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: TargetCamera;
  readonly canvas: HTMLCanvasElement;
  /** Naht für `cmd.grid` (`readPixels`); `null`, wenn der Kontext nicht herausgegeben wird. */
  readonly gl: WebGL2RenderingContext | null;
  applyTier(tier: QualityTier, dpr: number): void;
  resize(): void;
  hardwareScaling(): number;
  renderSize(): { width: number; height: number };
  dispose(): void;
}

/**
 * Baut Engine, Szene und die von Hand gefahrene Kamera. Wirft mit dem Text aus `strings.ts`, wenn
 * der Browser kein WebGL2 liefert – `src/main.ts` fängt das und gibt es an das Fehler-Panel (am
 * Handy der einzige Rückkanal).
 */
export function createEngine(canvas: HTMLCanvasElement, tier: QualityTier, dpr: number): GameEngine {
  // Kantenglättung AUS (die Graybox braucht sie nicht, M8 entscheidet neu) und
  // `adaptToDeviceRatio = false`: sonst rechnet Babylon eine zweite, eigene DPR-Politik gegen unsere.
  const engine = new Engine(
    canvas,
    false,
    { alpha: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' },
    false,
  );
  if (engine.webGLVersion !== WEBGL_VERSION_REQUIRED) {
    engine.dispose();
    throw new Error(S.render.webgl2Missing);
  }

  const scene = new Scene(engine);
  scene.clearColor = new Color4(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], 1);
  // `TargetCamera`, nicht `UniversalCamera`/`FreeCamera`: die beiden legen einen
  // `FreeCameraInputsManager` an (Tastatur, Maus, Touch) – ohne `attachControl` untätig, aber ein
  // zweiter Eingabeweg neben `src/input/keyboard.ts` im Bundle. Gefahren wird sie vom Kamera-Rig.
  const camera = new TargetCamera('boom', new Vector3(0, 0, 0), scene);
  scene.activeCamera = camera;

  // Derselbe Kontext laut WebGL-Spezifikation: ein zweiter `getContext` mit demselben Typ gibt den
  // vorhandenen zurück. Babylons `_gl` bleibt tabu (Unterstrich-Mitglied).
  const gl = canvas.getContext('webgl2');

  const gameEngine: GameEngine = {
    engine,
    scene,
    camera,
    canvas,
    gl,
    applyTier(nextTier: QualityTier, nextDpr: number): void {
      engine.setHardwareScalingLevel(hardwareScaling(nextTier, nextDpr));
      engine.resize();
    },
    resize(): void {
      engine.resize();
    },
    hardwareScaling(): number {
      return engine.getHardwareScalingLevel();
    },
    renderSize(): { width: number; height: number } {
      return { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    },
    dispose(): void {
      scene.dispose();
      engine.dispose();
    },
  };
  gameEngine.applyTier(tier, dpr);

  // Frühwarner für fehlende Nebenwirkungs-Importe – nur in der Entwicklung und DYNAMISCH: statisch
  // kostet die Funktion gemessen 8,0 kB gzip und 36,4 kB Precache. Sie hat Rauschen (gemessen 30
  // Einträge, darunter `GroundMesh`, obwohl `CreateGround` läuft – der Stub ist nur der Parser),
  // ist also kein Gate: KEIN Test darf eine leere Liste verlangen.
  if (import.meta.env.DEV) {
    void import('@babylonjs/core/Misc/checkMissingImports').then((module) => {
      module.CheckMissingImports();
    });
  }

  return gameEngine;
}
