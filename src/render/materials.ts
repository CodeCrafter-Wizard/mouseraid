/**
 * Materialien der Graybox: ein `StandardMaterial` je Art, angelegt beim ersten Gebrauch.
 *
 * Die Farbtafel selbst steht im Babylon-FREIEN Leaf `./grayboxColors` und wird von hier
 * re-exportiert, damit keine Signatur wandert. `mouseWeak` steht schon in der Tafel, wird aber erst
 * in M7 umgeschaltet und deshalb in M5 nie angelegt.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene.pure';
import { EMISSIVE_SHARE, GRAYBOX_COLORS } from './grayboxColors';
import type { GrayboxKind } from './grayboxColors';

export * from './grayboxColors';

export interface MaterialTable {
  /** Legt beim ersten Aufruf an, danach dasselbe Objekt. */
  get(kind: GrayboxKind): StandardMaterial;
  count(): number;
  dispose(): void;
}

/**
 * „Flach" entsteht über `specularColor = (0, 0, 0)` plus ein leichtes `emissiveColor`.
 * `disableLighting` wird AUSDRÜCKLICH NICHT benutzt: ohne Licht sind alle sechs Kastenseiten gleich
 * hell und die Form ist nicht lesbar – genau das, was die Graybox zeigen soll.
 */
export function createMaterials(scene: Scene): MaterialTable {
  const made = new Map<GrayboxKind, StandardMaterial>();

  return {
    get(kind: GrayboxKind): StandardMaterial {
      const found = made.get(kind);
      if (found !== undefined) return found;
      const rgb = GRAYBOX_COLORS[kind];
      const material = new StandardMaterial(`graybox-${kind}`, scene);
      material.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
      material.specularColor = new Color3(0, 0, 0);
      material.emissiveColor = new Color3(
        rgb[0] * EMISSIVE_SHARE, rgb[1] * EMISSIVE_SHARE, rgb[2] * EMISSIVE_SHARE,
      );
      made.set(kind, material);
      return material;
    },
    count: () => made.size,
    dispose() {
      for (const material of made.values()) material.dispose();
      made.clear();
    },
  };
}
