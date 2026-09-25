import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId);
}

describe('ESLint-Leitplanken', () => {
  it('core darf kein Babylon importieren', async () => {
    const ids = await ruleIds(`import { Vector3 } from '@babylonjs/core/Maths/math.vector';\nexport const v = Vector3;\n`, 'src/core/world/x.ts');
    expect(ids).toContain('no-restricted-imports');
  });

  it('core darf keine anderen Schichten importieren', async () => {
    const ids = await ruleIds(`import { a } from '../../render/engine';\nexport const b = a;\n`, 'src/core/sim/x.ts');
    expect(ids).toContain('no-restricted-imports');
  });

  it('core darf core-interne Module importieren, die wie eine andere Schicht heissen', async () => {
    const own = await ruleIds(`import { a } from './input';\nexport const b = a;\n`, 'src/core/sim/step.ts');
    const sibling = await ruleIds(`import { a } from '../sim/input';\nexport const b = a;\n`, 'src/core/sim/step.ts');
    expect(own).not.toContain('no-restricted-imports');
    expect(sibling).not.toContain('no-restricted-imports');
  });

  it('core darf die echten Schichten input/ und render/ nicht importieren', async () => {
    const input = await ruleIds(`import { a } from '../../input/touch';\nexport const b = a;\n`, 'src/core/sim/step.ts');
    const render = await ruleIds(`import { a } from '../../render/engine';\nexport const b = a;\n`, 'src/core/sim/step.ts');
    expect(input).toContain('no-restricted-imports');
    expect(render).toContain('no-restricted-imports');
  });

  it('net darf ein eigenes ./render-Modul haben, aber nicht die render-Schicht', async () => {
    const own = await ruleIds(`import { a } from './render';\nexport const b = a;\n`, 'src/net/x.ts');
    const layer = await ruleIds(`import { a } from '../render/engine';\nexport const b = a;\n`, 'src/net/x.ts');
    expect(own).not.toContain('no-restricted-imports');
    expect(layer).toContain('no-restricted-imports');
  });

  it('core darf den Potenz-Operator nicht benutzen (wie Math.pow nur angenaehert)', async () => {
    const ids = await ruleIds(`export let a = 2 ** 8;\na **= 2;\n`, 'src/core/math/p.ts');
    expect(ids.filter((id) => id === 'no-restricted-syntax')).toHaveLength(2);
  });

  it('core darf Math.sin, Math.random, Math.hypot und Date.now nicht benutzen', async () => {
    const ids = await ruleIds(
      `export const a = Math.sin(1);\nexport const b = Math.random();\nexport const c = Math.hypot(1, 2);\nexport const d = Date.now();\n`,
      'src/core/math/x.ts',
    );
    expect(ids.filter((id) => id === 'no-restricted-properties')).toHaveLength(4);
  });

  it('core darf Math.sqrt, Math.abs und Math.floor benutzen', async () => {
    const ids = await ruleIds(`export const a = Math.sqrt(2) + Math.abs(-1) + Math.floor(1.5);\n`, 'src/core/math/y.ts');
    expect(ids).not.toContain('no-restricted-properties');
  });

  // M3: Hash und Klon laufen über eine handgeschriebene Feldfolge. Object.keys/entries/… würde die
  // Laufordnung an die Feldnamen binden – eine Umbenennung änderte still den Golden-Hash.
  it('core darf Object.keys/values/entries/assign/fromEntries nicht benutzen', async () => {
    const ids = await ruleIds(
      `const o = { a: 1 };\nexport const a = Object.keys(o);\nexport const b = Object.values(o);\n` +
        `export const c = Object.entries(o);\nexport const d = Object.assign({}, o);\nexport const e = Object.fromEntries(c);\n`,
      'src/core/sim/hash.ts',
    );
    expect(ids.filter((id) => id === 'no-restricted-properties')).toHaveLength(5);
  });

  // M3/MAJ-1 (Abschlussreview): for-in ist der Umweg um das Object.keys-Verbot – dieselbe
  // namensabhaengige Laufordnung, nur ohne Aufruf. CLAUDE.md sagt „erzwungen", also muss es das sein.
  // Grenzfall: for-of ist die vorgeschriebene Iterationsform im Kern und muss durchkommen.
  it('core darf for-in nicht benutzen, for-of dagegen schon', async () => {
    const forIn = await ruleIds(
      `const o: Record<string, number> = { a: 1 };\nexport const out: string[] = [];\nfor (const k in o) out.push(k);\n`,
      'src/core/sim/hash.ts',
    );
    const forOf = await ruleIds(
      `const list = [1, 2];\nexport const out: number[] = [];\nfor (const n of list) out.push(n);\n`,
      'src/core/sim/hash.ts',
    );
    expect(forIn.filter((id) => id === 'no-restricted-syntax')).toHaveLength(1);
    expect(forOf).not.toContain('no-restricted-syntax');
  });

  it('ausserhalb von src/core bleibt for-in erlaubt', async () => {
    const ids = await ruleIds(
      `const o: Record<string, number> = { a: 1 };\nexport const out: string[] = [];\nfor (const k in o) out.push(k);\n`,
      'src/lab/report.ts',
    );
    expect(ids).not.toContain('no-restricted-syntax');
  });

  // M3/D12: Daten werden injiziert, nicht geparst – die Loader nehmen `unknown`.
  it('core darf JSON.parse und JSON.stringify nicht benutzen', async () => {
    const ids = await ruleIds(
      `export const a = JSON.parse('1');\nexport const b = JSON.stringify(a);\n`,
      'src/core/data/balanceLoad.ts',
    );
    expect(ids.filter((id) => id === 'no-restricted-properties')).toHaveLength(2);
  });

  it('ausserhalb von src/core bleiben Object.keys und JSON.parse erlaubt', async () => {
    const ids = await ruleIds(
      `const o = { a: 1 };\nexport const a = Object.keys(o);\nexport const b = JSON.parse('1');\n`,
      'src/lab/report.ts',
    );
    expect(ids).not.toContain('no-restricted-properties');
  });

  // Die exakt spezifizierten Math-Operationen und die kanonische Byte-Sicht sind der Werkzeugkasten
  // von src/core/math – sie müssen ausdrücklich durchkommen.
  it('core darf Math.imul, Math.fround, Math.clz32 und DataView benutzen', async () => {
    const ids = await ruleIds(
      `const view = new DataView(new ArrayBuffer(8));\nview.setFloat64(0, 1.5, true);\n` +
        `export const a = Math.imul(3, 5) + Math.fround(1.5) + Math.clz32(7) + Math.sqrt(2) + view.getUint8(0);\n` +
        `export const b = new Uint8Array(4);\nexport const c = Number.isFinite(a) && Number.isInteger(a);\n`,
      'src/core/math/hash.ts',
    );
    expect(ids).not.toContain('no-restricted-properties');
    expect(ids).not.toContain('no-restricted-syntax');
    expect(ids).not.toContain('no-restricted-globals');
  });

  it.each(['src/core/math/trig.ts', 'src/core/world/collision.ts', 'src/core/data/balanceLoad.ts', 'src/core/systems/clock.ts'])(
    '%s darf keine fremde Schicht importieren',
    async (filePath) => {
      const render = await ruleIds(`import { a } from '../../render/engine';\nexport const b = a;\n`, filePath);
      const ui = await ruleIds(`import { a } from '../../ui/strings';\nexport const b = a;\n`, filePath);
      expect(render).toContain('no-restricted-imports');
      expect(ui).toContain('no-restricted-imports');
    },
  );

  it.each(['src/core/math/trig.ts', 'src/core/world/collision.ts', 'src/core/data/balanceLoad.ts', 'src/core/systems/clock.ts'])(
    '%s darf Math.sin, den Potenz-Operator und new Date() nicht benutzen',
    async (filePath) => {
      const ids = await ruleIds(`export const a = Math.sin(1) + 2 ** 3;\nexport const b = new Date();\n`, filePath);
      expect(ids).toContain('no-restricted-properties');
      expect(ids.filter((id) => id === 'no-restricted-syntax')).toHaveLength(2);
    },
  );

  it('core darf keine Browser-Globals und kein new Date() benutzen', async () => {
    const ids = await ruleIds(`export const w = window;\nexport const t = new Date();\nexport const p = performance;\n`, 'src/core/sim/y.ts');
    expect(ids).toContain('no-restricted-globals');
    expect(ids).toContain('no-restricted-syntax');
  });

  it('net und lab dürfen weder render noch Babylon importieren', async () => {
    const net = await ruleIds(`import { a } from '../render/engine';\nexport const b = a;\n`, 'src/net/x.ts');
    const lab = await ruleIds(`import { Engine } from '@babylonjs/core/Engines/engine';\nexport const e = Engine;\n`, 'src/lab/x.ts');
    expect(net).toContain('no-restricted-imports');
    expect(lab).toContain('no-restricted-imports');
  });

  it('render darf Babylon importieren, aber nicht Legacy und nicht als Namespace', async () => {
    const ok = await ruleIds(`import { Engine } from '@babylonjs/core/Engines/engine';\nexport const e = Engine;\n`, 'src/render/x.ts');
    const legacy = await ruleIds(`import '@babylonjs/core/Legacy/legacy';\n`, 'src/render/y.ts');
    const ns = await ruleIds(`import * as B from '@babylonjs/core';\nexport const e = B;\n`, 'src/render/z.ts');
    expect(ok).not.toContain('no-restricted-imports');
    expect(legacy).toContain('no-restricted-imports');
    expect(ns).toContain('no-restricted-syntax');
  });

  // M4/D1: zwei neue Schichtgrenzen, beide nur VERSCHAERFUNGEN.
  // `src/render/**` hatte bisher gar keinen eigenen Block – render/ durfte also auch net/ und lab/
  // importieren, und gefangen haette das erst `findLabSignatures` im gebauten Bundle, und auch nur,
  // wenn eine der drei gesuchten Zeichenketten das Tree-Shaking ueberlebt.
  // `src/input/**` ist neu (M4/T4) und darf ausschliesslich src/core sehen.
  it.each([
    '../../net/protocol',
    '../../lab/report',
    './../../net/protocol',
    '..//..//lab/report',
    '../.././net/protocol',
    '../../../src/lab/report',
  ])('render: der Weg %s nach net/ oder lab/ ist verboten', async (source) => {
    const ids = await ruleIds(`import { a } from '${source}';\nexport const b = a;\n`, 'src/render/view2d/x.ts');
    expect(ids).toContain('no-restricted-imports');
  });

  it.each(['../../core/sim/state', '../../ui/strings', '../../platform/buildInfo', './draw', './net', '../view2d/draw'])(
    'render: %s bleibt erlaubt',
    async (source) => {
      const ids = await ruleIds(`import { a } from '${source}';\nexport const b = a;\n`, 'src/render/view2d/x.ts');
      expect(ids).not.toContain('no-restricted-imports');
    },
  );

  it.each([
    '../ui/strings',
    '../render/view2d/draw',
    '../net/protocol',
    '../lab/report',
    '../platform/buildInfo',
    '../audio/audioBus',
    '../modes/fixedLoop',
    './../ui/strings',
    '..//render/view2d/draw',
    '.././net/protocol',
    '../../src/lab/report',
  ])('input: der Weg %s in eine fremde Schicht ist verboten', async (source) => {
    const ids = await ruleIds(`import { a } from '${source}';\nexport const b = a;\n`, 'src/input/keyboard.ts');
    expect(ids).toContain('no-restricted-imports');
  });

  it.each(['../core/sim/input', '../core/math/vec', './gamepad', './render', './net', '../input/touch'])(
    'input: %s bleibt erlaubt',
    async (source) => {
      const ids = await ruleIds(`import { a } from '${source}';\nexport const b = a;\n`, 'src/input/keyboard.ts');
      expect(ids).not.toContain('no-restricted-imports');
    },
  );

  it('input darf Babylon weder direkt noch als Legacy-Barrel importieren', async () => {
    const babylon = await ruleIds(
      `import { Engine } from '@babylonjs/core/Engines/engine';\nexport const e = Engine;\n`,
      'src/input/keyboard.ts',
    );
    const legacy = await ruleIds(`import '@babylonjs/core/Legacy/legacy';\n`, 'src/input/x.ts');
    expect(babylon).toContain('no-restricted-imports');
    expect(legacy).toContain('no-restricted-imports');
  });

  it('new AudioContext ist nur in src/audio/audioBus.ts erlaubt', async () => {
    const bad = await ruleIds(`export const c = new AudioContext();\n`, 'src/audio/sfx.ts');
    const good = await ruleIds(`export const c = new AudioContext();\n`, 'src/audio/audioBus.ts');
    expect(bad).toContain('no-restricted-syntax');
    expect(good).not.toContain('no-restricted-syntax');
  });

  it('core darf self/globalThis/location/history/screen nicht als Umweg fuer verbotene Globals benutzen', async () => {
    const ids = await ruleIds(
      `export const a = self.Math.random();\nexport const b = globalThis.Math.random();\nexport const c = location.href;\n` +
        `export const d = history.length;\nexport const e = screen.width;\n`,
      'src/core/sim/z.ts',
    );
    expect(ids.filter((id) => id === 'no-restricted-globals').length).toBeGreaterThanOrEqual(5);
  });

  it('new self.AudioContext() ist nur in src/audio/audioBus.ts erlaubt', async () => {
    const bad = await ruleIds(`export const c = new self.AudioContext();\n`, 'src/audio/sfx.ts');
    const good = await ruleIds(`export const c = new self.AudioContext();\n`, 'src/audio/audioBus.ts');
    expect(bad).toContain('no-restricted-syntax');
    expect(good).not.toContain('no-restricted-syntax');
  });

  // Andere Schreibweisen desselben Ziels: `.`-Segmente, doppelte Schrägstriche, Umweg über `src/`.
  it.each([
    './../../render/engine',
    '..//..//render/engine',
    '../.././render/engine',
    '../../../src/render/engine',
    '../../../src/input/touch',
    '../../../src/core/../render/engine',
  ])('core: der Umweg %s in eine fremde Schicht ist verboten', async (source) => {
    const ids = await ruleIds(`import { a } from '${source}';\nexport const b = a;\n`, 'src/core/sim/x.ts');
    expect(ids).toContain('no-restricted-imports');
  });

  it.each(['./render', './sim/input', '../world/render', '../systems/audio', '../save/platform/x'])(
    'core: das core-interne Modul %s bleibt erlaubt',
    async (source) => {
      const ids = await ruleIds(`import { a } from '${source}';\nexport const b = a;\n`, 'src/core/sim/x.ts');
      expect(ids).not.toContain('no-restricted-imports');
    },
  );

  it.each(['./../render/engine', '..//render/engine', '.././render/engine', '../../src/render/engine'])(
    'net und lab: der Umweg %s zur render-Schicht ist verboten',
    async (source) => {
      const code = `import { a } from '${source}';\nexport const b = a;\n`;
      expect(await ruleIds(code, 'src/net/x.ts')).toContain('no-restricted-imports');
      expect(await ruleIds(code, 'src/lab/x.ts')).toContain('no-restricted-imports');
    },
  );

  it.each(['./render', './signaling/render', '../ui/strings', '../net/renderQueue'])(
    'net und lab: %s bleibt erlaubt',
    async (source) => {
      const code = `import { a } from '${source}';\nexport const b = a;\n`;
      expect(await ruleIds(code, 'src/net/x.ts')).not.toContain('no-restricted-imports');
      expect(await ruleIds(code, 'src/lab/x.ts')).not.toContain('no-restricted-imports');
    },
  );

  it('lintet den git-ignorierten Arbeitsordner .superpowers nicht mit', async () => {
    expect(await eslint.isPathIgnored('.superpowers/scratch/beispiel/src/x.ts')).toBe(true);
    expect(await eslint.isPathIgnored('src/main.ts')).toBe(false);
  });
});
