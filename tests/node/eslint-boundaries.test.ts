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
});
