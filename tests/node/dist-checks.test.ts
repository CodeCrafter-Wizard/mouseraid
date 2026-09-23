import { describe, expect, it } from 'vitest';
import {
  collectJsGraph,
  findForbiddenSignatures,
  findLabSignatures,
  findMissingPrecache,
  findMissingRequiredFiles,
  isPrecacheCandidate,
  REQUIRED_FILES,
} from '../../scripts/lib/distChecks.mjs';

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

  it('erkennt auch die TLS-Varianten stuns: und turns:', () => {
    expect(findForbiddenSignatures('a.js', 'urls:"stuns:beispiel.invalid:5349"')).toHaveLength(1);
    expect(findForbiddenSignatures('a.js', 'urls:"turns:beispiel.invalid:5349"')).toHaveLength(1);
    expect(findForbiddenSignatures('a.js', 'urls:"turn:beispiel.invalid:3478"')).toHaveLength(1);
  });

  it('löst bei harmlosem Code keinen Fehlalarm aus', () => {
    expect(findForbiddenSignatures('a.js', 'const it={next:f,return:g};function turn(){return 1}')).toEqual([]);
  });
});

describe('findLabSignatures', () => {
  it('meldet Labor- und Netz-Signaturen im Spiel-Graphen', () => {
    expect(findLabSignatures('assets/main-1.js', 'new BroadcastChannel(`maeusebau-lab-${room}`)')).toHaveLength(1);
    expect(findLabSignatures('assets/main-1.js', 'new RTCPeerConnection({iceServers:[]})')).toHaveLength(1);
    expect(findLabSignatures('assets/main-1.js', 'new CompressionStream("deflate-raw")')).toHaveLength(1);
    // Mehrere Treffer in derselben Datei werden einzeln gemeldet.
    expect(findLabSignatures('assets/main-1.js', '"RTCPeerConnection" in window?new CompressionStream("deflate-raw"):null')).toHaveLength(2);
  });

  it('löst bei gewöhnlichem Spiel-Code keinen Fehlalarm aus', () => {
    expect(findLabSignatures('assets/main-1.js', 'class Lab{}const net={};new Engine(canvas,true)')).toEqual([]);
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

  it('folgt new URL(...), __vite__mapDeps-Listen und absoluten Importen; ignoriert externe und nicht existierende Pfade', () => {
    const files: Record<string, string> = {
      'assets/lab-1.js': [
        'new URL("./worker-4.js",import.meta.url);',
        'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/lazy-5.js","assets/lazy-5.css"])))=>i.map(i=>d[i]);',
        '__vite__mapDeps([0,1]);',
        'import("/mouseraid/assets/abs-6.js");',
        '"assets/does-not-exist-7.js";',
        '"https://example.com/x.js";',
      ].join('\n'),
      'assets/worker-4.js': 'export const w=1;',
      'assets/lazy-5.js': 'export const z=2;',
      'assets/abs-6.js': 'export const a=3;',
    };
    const html = '<script type="module" src="/mouseraid/assets/lab-1.js"></script>';
    const graph = collectJsGraph(html, '/mouseraid/', (rel) => files[rel] ?? null);
    expect(graph.sort()).toEqual(['assets/abs-6.js', 'assets/lab-1.js', 'assets/lazy-5.js', 'assets/worker-4.js']);
  });

  it('akzeptiert auch einfach gequotete HTML-Attribute', () => {
    const files: Record<string, string> = { 'assets/only.js': 'export const a=1;' };
    const html = "<script type='module' src='/mouseraid/assets/only.js'></script>";
    const graph = collectJsGraph(html, '/mouseraid/', (rel) => files[rel] ?? null);
    expect(graph).toEqual(['assets/only.js']);
  });

  it('behandelt sw.js nicht als Graph-Knoten (sonst "importieren" beide Seiten transitiv den ganzen Build über dessen Precache-Manifest)', () => {
    const files: Record<string, string> = {
      'assets/entry-8.js': 'const w=new Worker(`/mouseraid/sw.js`);',
      'sw.js': 'precacheAndRoute([{url:"assets/entry-8.js"},{url:"assets/other-page-9.js"}])',
      'assets/other-page-9.js': 'export const o=1;',
    };
    const html = '<script type="module" src="/mouseraid/assets/entry-8.js"></script>';
    const graph = collectJsGraph(html, '/mouseraid/', (rel) => files[rel] ?? null);
    expect(graph).toEqual(['assets/entry-8.js']);
  });

  it('behandelt den Workbox-Runtime-Chunk (workbox-<hash>.js) ebenfalls nicht als Graph-Knoten', () => {
    const files: Record<string, string> = {
      'assets/entry-10.js': 'const w=new Worker(`workbox-deadbeef123.js`);',
      'workbox-deadbeef123.js': 'export const wb=1;',
    };
    const html = '<script type="module" src="/mouseraid/assets/entry-10.js"></script>';
    const graph = collectJsGraph(html, '/mouseraid/', (rel) => files[rel] ?? null);
    expect(graph).toEqual(['assets/entry-10.js']);
  });
});

describe('Precache', () => {
  it('haelt jede dist-Datei fuer vorzucachen – auch unbekannte Dateitypen', () => {
    expect(isPrecacheCandidate('assets/main-1.js')).toBe(true);
    expect(isPrecacheCandidate('icons/icon-192.png')).toBe(true);
    expect(isPrecacheCandidate('manifest.webmanifest')).toBe(true);
    expect(isPrecacheCandidate('assets/tex.jpg')).toBe(true);
    expect(isPrecacheCandidate('assets/prop.gltf')).toBe(true);
    expect(isPrecacheCandidate('assets/prop.bin')).toBe(true);
    expect(isPrecacheCandidate('icons/x.PNG')).toBe(true);
  });

  it('nimmt nur die bewussten Ausnahmen aus', () => {
    expect(isPrecacheCandidate('sw.js')).toBe(false);
    expect(isPrecacheCandidate('registerSW.js')).toBe(false);
    expect(isPrecacheCandidate('workbox-abc123.js')).toBe(false);
    expect(isPrecacheCandidate('version.json')).toBe(false);
    expect(isPrecacheCandidate('assets/main-1.js.map')).toBe(false);
  });

  it('meldet Dateien, die im Service Worker fehlen', () => {
    const sw = 'precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/main-1.js",revision:null}])';
    expect(findMissingPrecache(sw, ['index.html', 'assets/main-1.js', 'lab.html'])).toEqual(['lab.html']);
    expect(findMissingPrecache(sw, ['index.html', 'assets/main-1.js', 'assets/tex.jpg'])).toEqual(['assets/tex.jpg']);
  });

  it('zaehlt nur Manifest-Eintraege – createHandlerBoundToURL("index.html") ist keiner', () => {
    const sw =
      'precacheAndRoute([{url:"assets/main-1.js",revision:null}],{ignoreURLParametersMatching:[/.*/]}),' +
      'e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html"),{denylist:[/\\/lab\\.html/]}))';
    expect(findMissingPrecache(sw, ['index.html', 'assets/main-1.js'])).toEqual(['index.html']);
  });

  it('akzeptiert die Manifest-Form auch mit gequotetem Schluessel', () => {
    expect(findMissingPrecache('[{"url":"index.html","revision":null}]', ['index.html'])).toEqual([]);
  });
});

describe('findMissingRequiredFiles', () => {
  it('meldet nichts, wenn alle Pflichtdateien vorhanden sind', () => {
    expect(findMissingRequiredFiles(REQUIRED_FILES)).toEqual([]);
    expect(findMissingRequiredFiles([...REQUIRED_FILES, 'assets/main-1.js'])).toEqual([]);
  });

  it('meldet fehlende Pflichtdateien', () => {
    const present = REQUIRED_FILES.filter((file) => file !== 'lab.html' && file !== 'version.json');
    expect(findMissingRequiredFiles(present)).toEqual(['lab.html', 'version.json']);
  });
});
