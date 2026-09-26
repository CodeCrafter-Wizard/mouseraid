import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GPU_PROBE_FRAMES,
  OVERLAY_TOGGLE_CODE,
  P95_WINDOW,
  createDebugOverlay,
  createPercentiles,
  formatOverlay,
  percentile95,
} from '../../../src/render/debugOverlay';
import type { MbStats } from '../../../src/modes/hook';
import { S } from '../../../src/ui/strings';

/**
 * `createInstrumentation` ist hier ABSICHTLICH nicht geprueft (D9/Q2): es haengt an einer echten
 * Engine, und `scene.getActiveIndices()` bleibt unter `NullEngine` 0, weil dort nichts rastert – ein
 * Test darueber waere gruen, ohne etwas zu beweisen. Geprueft wird, was rein ist: der Rang des p95,
 * der Ringpuffer und der Text. Die Verdrahtung beweist der Tor-Spec (T6) mit den echten Zaehlern.
 *
 * DOM-Attrappe statt jsdom: `createDebugOverlay` braucht aus dem Browser genau
 * `document.createElement('pre')`, `className`, `dataset`, `hidden`, `textContent`, `remove()` und
 * `host.append()`. Die Umgebung bleibt `node` (vitest.config.ts), wie im ganzen Projekt.
 */
interface FakeElement {
  tag: string;
  className: string;
  dataset: Record<string, string>;
  hidden: boolean;
  textContent: string;
  removed: boolean;
  remove(): void;
}

const created: FakeElement[] = [];

function installFakeDom(): void {
  created.length = 0;
  const fakeDocument = {
    createElement: (tag: string): FakeElement => {
      const element: FakeElement = {
        tag,
        className: '',
        dataset: {},
        hidden: false,
        textContent: '',
        removed: false,
        remove: () => { element.removed = true; },
      };
      created.push(element);
      return element;
    },
  };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;
}

function removeFakeDom(): void {
  delete (globalThis as unknown as { document?: unknown }).document;
}

function fakeHost(): { host: HTMLElement; children: FakeElement[] } {
  const children: FakeElement[] = [];
  const host = { append: (...nodes: FakeElement[]): void => { children.push(...nodes); } };
  return { host: host as unknown as HTMLElement, children };
}

beforeEach(installFakeDom);
afterEach(removeFakeDom);

/** Gemessene Werte des Prototyps als Grundlage; jeder Fall dreht nur, was er prueft. */
function stats(overrides: Partial<MbStats> = {}): MbStats {
  return {
    tick: 90,
    fps: 60,
    panelHz: 137,
    frameMs: 0.5,
    cpuMsP95: 0.1,
    gpuMs: 0,
    drawCalls: 19,
    triangles: 1056,
    tickRate: 30,
    steps: 1,
    tier: 'high',
    storage: 'idb',
    buildId: '3c6ddcac',
    ...overrides,
  };
}

/**
 * Zerlegt den Overlay-Text in Bezeichner und Wert. Getrennt wird an ZWEI oder mehr Leerzeichen –
 * die Bezeichner selbst duerfen einzelne Leerzeichen enthalten ('CPU p95 ms'), die Fuellung zwischen
 * Bezeichner und Wert ist immer breiter. So bleibt der Test lesbar, ohne eine Spaltenbreite zu pinnen.
 */
function rows(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n').slice(1)) {
    const match = /^(.+?)\s{2,}(.*)$/.exec(line);
    if (match === null) throw new Error(`Zeile nicht lesbar: ${line}`);
    map.set(match[1] ?? '', match[2] ?? '');
  }
  return map;
}

describe('percentile95', () => {
  it('liefert 0 fuer eine leere Liste', () => {
    expect(percentile95([])).toBe(0);
  });

  it('liefert bei EINEM Wert genau diesen', () => {
    expect(percentile95([7.5])).toBe(7.5);
    expect(percentile95([-3])).toBe(-3);
  });

  it('liefert bei ZWEI Werten den groesseren – Rang ceil(0.95*2)-1 = 1', () => {
    expect(percentile95([1, 9])).toBe(9);
    expect(percentile95([9, 1])).toBe(9);
  });

  it('liefert bei 120 Werten den 114. – kein Interpolieren, naechstgroesserer Rang', () => {
    const ascending = Array.from({ length: 120 }, (_, index) => index + 1);
    expect(percentile95(ascending)).toBe(114);
    // Dieselbe Menge in umgekehrter Reihenfolge ergibt denselben Wert: es wird sortiert.
    expect(percentile95([...ascending].reverse())).toBe(114);
  });

  it('liefert bei 20 Werten den 19. – die Tabelle haengt an ceil, nicht an round', () => {
    expect(percentile95(Array.from({ length: 20 }, (_, index) => index + 1))).toBe(19);
  });

  it('sortiert NUR eine Kopie – die Liste des Aufrufers bleibt, wie sie war', () => {
    const samples = [5, 1, 4];
    expect(percentile95(samples)).toBe(5);
    expect(samples).toEqual([5, 1, 4]);
  });
});

describe('createPercentiles', () => {
  it('meldet ohne Werte 0 und benutzt als Vorgabe P95_WINDOW', () => {
    expect(P95_WINDOW).toBe(120);
    const ring = createPercentiles();
    expect(ring.p95()).toBe(0);
  });

  it('rechnet ueber die gesammelten Werte, auch wenn das Fenster noch nicht voll ist', () => {
    const ring = createPercentiles();
    for (let value = 1; value <= 20; value += 1) ring.push(value);
    expect(ring.p95()).toBe(19);
  });

  it('verwirft die AELTESTEN Werte, sobald das Fenster voll ist', () => {
    const ring = createPercentiles();
    // 240 Werte in ein Fenster von 120: uebrig bleiben 121 … 240, ihr p95 ist der 114. davon.
    for (let value = 1; value <= 240; value += 1) ring.push(value);
    expect(ring.p95()).toBe(234);
    // Gegenprobe: waeren die alten Werte noch da, stuende hier 228 (der 114. von 1 … 240 ist 228).
    expect(ring.p95()).not.toBe(228);
  });

  it('nimmt ein eigenes Fenster an und klemmt es auf mindestens 1', () => {
    const four = createPercentiles(4);
    for (const value of [1, 2, 3, 4, 5]) four.push(value);
    // Fenster 4: uebrig 2 … 5, Rang ceil(0.95*4)-1 = 3 -> der groesste.
    expect(four.p95()).toBe(5);
    const zero = createPercentiles(0);
    zero.push(11);
    zero.push(12);
    expect(zero.p95()).toBe(12);
  });

  it('`reset` leert das Fenster', () => {
    const ring = createPercentiles();
    for (let value = 1; value <= 120; value += 1) ring.push(value);
    expect(ring.p95()).toBe(114);
    ring.reset();
    expect(ring.p95()).toBe(0);
    ring.push(3);
    expect(ring.p95()).toBe(3);
  });
});

describe('formatOverlay', () => {
  it('beginnt mit der Ueberschrift und hat je Zaehler genau eine Zeile', () => {
    const text = formatOverlay(stats());
    const lines = text.split('\n');
    expect(lines[0]).toBe(S.debug.title);
    expect(lines).toHaveLength(14);
    expect([...rows(text).keys()]).toEqual([
      S.debug.tick, S.debug.fps, S.debug.panelHz, S.debug.frameMs, S.debug.cpuP95, S.debug.gpuMs,
      S.debug.drawCalls, S.debug.triangles, S.debug.tickRate, S.debug.steps, S.debug.tier,
      S.debug.storage, S.debug.build,
    ]);
  });

  it('zeigt Zaehler als Ganzzahl und Zeiten mit zwei Stellen', () => {
    const table = rows(formatOverlay(stats({ frameMs: 0.5, cpuMsP95: 0.104 })));
    expect(table.get(S.debug.tick)).toBe('90');
    expect(table.get(S.debug.fps)).toBe('60');
    expect(table.get(S.debug.panelHz)).toBe('137');
    expect(table.get(S.debug.frameMs)).toBe('0.50');
    expect(table.get(S.debug.cpuP95)).toBe('0.10');
    expect(table.get(S.debug.drawCalls)).toBe('19');
    expect(table.get(S.debug.triangles)).toBe('1056');
    expect(table.get(S.debug.tickRate)).toBe('30');
    expect(table.get(S.debug.steps)).toBe('1');
    expect(table.get(S.debug.storage)).toBe('idb');
    expect(table.get(S.debug.build)).toBe('3c6ddcac');
  });

  it('zeigt GPU nur, wenn der Zaehler laeuft – sonst den Strich (Q2)', () => {
    expect(rows(formatOverlay(stats({ gpuMs: 0 }))).get(S.debug.gpuMs)).toBe(S.debug.none);
    expect(rows(formatOverlay(stats({ gpuMs: 1.234 }))).get(S.debug.gpuMs)).toBe('1.23');
  });

  it('zeigt die Panel-Rate nur, wenn sie gemessen ist (0 = `?clock=manual` oder noch nicht fertig)', () => {
    expect(rows(formatOverlay(stats({ panelHz: 0 }))).get(S.debug.panelHz)).toBe(S.debug.none);
  });

  it('uebersetzt die Stufe und faellt bei einer unbekannten auf den Strich zurueck', () => {
    expect(rows(formatOverlay(stats({ tier: 'low' }))).get(S.debug.tier)).toBe(S.debug.tierLow);
    expect(rows(formatOverlay(stats({ tier: 'medium' }))).get(S.debug.tier)).toBe(S.debug.tierMedium);
    expect(rows(formatOverlay(stats({ tier: 'high' }))).get(S.debug.tier)).toBe(S.debug.tierHigh);
    // `tier` ist im importfreien Haken ein nackter String – ein Tippfehler darf keine Zahl zeigen.
    expect(rows(formatOverlay(stats({ tier: 'ultra' }))).get(S.debug.tier)).toBe(S.debug.none);
  });

  it('zeigt fuer NaN und Unendlich den Strich statt „NaN“', () => {
    const table = rows(formatOverlay(stats({ frameMs: Number.NaN, fps: Number.POSITIVE_INFINITY, cpuMsP95: Number.NaN })));
    expect(table.get(S.debug.frameMs)).toBe(S.debug.none);
    expect(table.get(S.debug.fps)).toBe(S.debug.none);
    expect(table.get(S.debug.cpuP95)).toBe(S.debug.none);
  });

  it('richtet alle Werte an derselben Spalte aus', () => {
    const lines = formatOverlay(stats()).split('\n').slice(1);
    const columns = lines.map((line) => line.length - line.replace(/^.*\s{2,}/, '').length);
    expect(new Set(columns).size).toBe(1);
  });
});

describe('createDebugOverlay', () => {
  it('haengt ein verborgenes <pre> in den Wirt', () => {
    const { host, children } = fakeHost();
    const overlay = createDebugOverlay(host);
    expect(children).toHaveLength(1);
    expect(children[0]?.tag).toBe('pre');
    expect(children[0]?.className).toBe('debug-overlay');
    expect(children[0]?.dataset['testid']).toBe('debug-overlay');
    expect(children[0]?.hidden).toBe(true);
    expect(overlay.visible()).toBe(false);
  });

  it('schaltet sichtbar und wieder verborgen; `toggle` liefert den NEUEN Zustand', () => {
    const { host, children } = fakeHost();
    const overlay = createDebugOverlay(host);
    expect(overlay.toggle()).toBe(true);
    expect(overlay.visible()).toBe(true);
    expect(children[0]?.hidden).toBe(false);
    expect(overlay.toggle()).toBe(false);
    expect(children[0]?.hidden).toBe(true);
    overlay.setVisible(true);
    expect(overlay.visible()).toBe(true);
    overlay.setVisible(true);
    expect(children[0]?.hidden).toBe(false);
  });

  it('schreibt den Text erst, wenn es sichtbar ist – ein verborgenes Overlay kostet nichts', () => {
    const { host, children } = fakeHost();
    const overlay = createDebugOverlay(host);
    overlay.update(stats());
    expect(children[0]?.textContent).toBe('');
    overlay.setVisible(true);
    overlay.update(stats());
    expect(children[0]?.textContent).toBe(formatOverlay(stats()));
  });

  it('nimmt das <pre> bei `dispose` wieder aus der Seite', () => {
    const { host, children } = fakeHost();
    const overlay = createDebugOverlay(host);
    overlay.dispose();
    expect(children[0]?.removed).toBe(true);
  });

  it('pinnt die Taste und das GPU-Probefenster – `gameMain` verdrahtet beides', () => {
    expect(OVERLAY_TOGGLE_CODE).toBe('F3');
    expect(GPU_PROBE_FRAMES).toBe(60);
  });
});
