import { describe, expect, it } from 'vitest';
import { collectJsGraph, findForbiddenSignatures, findMissingPrecache, isPrecacheCandidate } from '../../scripts/lib/distChecks.mjs';

describe('findForbiddenSignatures', () => {
  it('erlaubt Babylons eingebaute Tools-CDN-Defaults, verbietet andere babylonjs.com-URLs', () => {
    expect(findForbiddenSignatures('a.js', 'x="https://cdn.babylonjs.com";y="https://assets.babylonjs.com/core"')).toEqual([]);
    expect(findForbiddenSignatures('a.js', 'u="https://cdn.babylonjs.com/babylon.ktx2Decoder.js"')).not.toEqual([]);
  });

  it('meldet Decoder-Signaturen, Legacy-Barrel und STUN/TURN-URLs', () => {
    expect(findForbiddenSignatures('a.js', 'load("draco_decoder_gltf.wasm")')).toHaveLength(1);
    expect(findForbiddenSignatures('a.js', 'meshopt_decoder')).toHaveLength(1);
    expect(findForbiddenSignatures('a.js', 'basis_transcoder')).toHaveLength(1);
    expect(findForbiddenSignatures('a.js', 'from "@babylonjs/core/Legacy/legacy"')).toHaveLength(1);
    expect(findForbiddenSignatures('a.js', 'iceServers:[{urls:"stun:stun.l.google.com:19302"}]')).toHaveLength(1);
  });

  it('löst bei harmlosem Code keinen Fehlalarm aus', () => {
    expect(findForbiddenSignatures('a.js', 'const it={next:f,return:g};function turn(){return 1}')).toEqual([]);
  });
});

describe('collectJsGraph', () => {
  it('folgt statischen und dynamischen Importen ab der HTML-Seite', () => {
    const files: Record<string, string> = {
      'assets/lab-1.js': 'import{a}from"./shared-2.js";import("./lazy-3.js");',
      'assets/shared-2.js': 'export const a=1;',
      'assets/lazy-3.js': 'export const z=1;',
    };
    const html = '<script type="module" crossorigin src="/mouseraid/assets/lab-1.js"></script><link rel="modulepreload" href="/mouseraid/assets/shared-2.js">';
    const graph = collectJsGraph(html, '/mouseraid/', (rel) => files[rel] ?? null);
    expect(graph.sort()).toEqual(['assets/lab-1.js', 'assets/lazy-3.js', 'assets/shared-2.js']);
  });
});

describe('Precache', () => {
  it('kennt die vorzucachenden Dateitypen und Ausnahmen', () => {
    expect(isPrecacheCandidate('assets/main-1.js')).toBe(true);
    expect(isPrecacheCandidate('icons/icon-192.png')).toBe(true);
    expect(isPrecacheCandidate('sw.js')).toBe(false);
    expect(isPrecacheCandidate('workbox-abc123.js')).toBe(false);
    expect(isPrecacheCandidate('version.json')).toBe(false);
    expect(isPrecacheCandidate('manifest.webmanifest')).toBe(false);
  });

  it('meldet Dateien, die im Service Worker fehlen', () => {
    const sw = 'precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/main-1.js",revision:null}])';
    expect(findMissingPrecache(sw, ['index.html', 'assets/main-1.js', 'lab.html'])).toEqual(['lab.html']);
  });
});
