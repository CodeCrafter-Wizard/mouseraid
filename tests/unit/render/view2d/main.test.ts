import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, mountView2d } from '../../../../src/render/view2d/main';
import type { MbHook } from '../../../../src/render/view2d/hook';
import { Colors } from '../../../../src/render/view2d/draw';
import { VIEW_MARGIN_PX, fitLevel, fitRoom, levelBounds } from '../../../../src/render/view2d/camera2d';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { hashState } from '../../../../src/core/sim/hash';
import { createInitialState } from '../../../../src/core/sim/state';
import { step } from '../../../../src/core/sim/step';
import { generateColliders } from '../../../../src/core/world/generateColliders';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import feinkostJson from '../../../../src/data/levels/feinkost.json';
import balanceFixture from '../../../fixtures/core/test-balance.json';
import levelFixture from '../../../fixtures/core/mini-level.json';

/**
 * DOM-Attrappe statt jsdom: `mountView2d` braucht genau `document.createElement('canvas')`,
 * `canvas.getContext`, `stage.append` und `window.addEventListener` – dreizehn Zeilen gegen eine
 * ganze Browser-Nachbildung. Die Umgebung bleibt `node` (vitest.config.ts), wie im ganzen Projekt.
 */
interface Rect { x: number; y: number; w: number; h: number; fill: string }

interface Fake {
  rects: Rect[];
  canvasWidth: number;
  canvasHeight: number;
  events: string[];
  frames: number;
}

const fake: Fake = { rects: [], canvasWidth: 0, canvasHeight: 0, events: [], frames: 0 };

function fakeContext(): unknown {
  const state = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1 };
  return {
    get fillStyle(): string { return state.fillStyle; },
    set fillStyle(value: string) { state.fillStyle = value; },
    get strokeStyle(): string { return state.strokeStyle; },
    set strokeStyle(value: string) { state.strokeStyle = value; },
    get globalAlpha(): number { return state.globalAlpha; },
    set globalAlpha(value: number) { state.globalAlpha = value; },
    get lineWidth(): number { return state.lineWidth; },
    set lineWidth(value: number) { state.lineWidth = value; },
    fillRect: (x: number, y: number, w: number, h: number) => { fake.rects.push({ x, y, w, h, fill: state.fillStyle }); },
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    arc: () => {}, fill: () => {}, save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
    // Feste Antwort: die Attrappe kann keine Pixel malen. Geprueft wird hier nur, dass `pixelAt`
    // eine Farbe im Format '#rrggbb' liefert – die ECHTEN Farben prueft der Tor-Spec im Browser.
    getImageData: () => ({ data: [18, 19, 28, 255] }),
  };
}

function installFakeDom(): void {
  fake.rects = [];
  fake.events = [];
  fake.frames = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => fakeContext(),
  };
  const document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unerwartetes Element ${tag}`);
      return canvas;
    },
  };
  const win = {
    addEventListener: (type: string) => { fake.events.push(type); },
    requestAnimationFrame: () => { fake.frames += 1; return fake.frames; },
    cancelAnimationFrame: () => {},
  };
  (globalThis as unknown as { document: unknown }).document = document;
  (globalThis as unknown as { window: unknown }).window = win;
  Object.defineProperty(fake, 'canvasWidth', { get: () => canvas.width, configurable: true });
  Object.defineProperty(fake, 'canvasHeight', { get: () => canvas.height, configurable: true });
}

function removeFakeDom(): void {
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { window?: unknown }).window;
}

function mount(search: string): MbHook {
  const stage = { append: () => {} } as unknown as HTMLElement;
  mountView2d(stage, new URLSearchParams(search));
  const hook = (globalThis as unknown as { window: { __mb?: MbHook } }).window.__mb;
  if (hook === undefined) throw new Error('window.__mb fehlt');
  return hook;
}

beforeEach(installFakeDom);
afterEach(removeFakeDom);

describe('view2d/main: Aufbau', () => {
  it('haengt den Haken IMMER ein – ohne `?hook=1`', () => {
    const hook = mount('clock=manual');
    expect(typeof hook.advance).toBe('function');
    expect(hook.tick()).toBe(0);
  });

  it('setzt die Leinwandmasse fest und nimmt `?w=`/`?h=` an', () => {
    mount('clock=manual');
    expect(fake.canvasWidth).toBe(DEFAULT_WIDTH);
    expect(fake.canvasHeight).toBe(DEFAULT_HEIGHT);
    removeFakeDom();
    installFakeDom();
    mount('clock=manual&w=640&h=480');
    expect(fake.canvasWidth).toBe(640);
    expect(fake.canvasHeight).toBe(480);
  });

  it('uebergeht unsinnige Masse und bleibt bei der Vorgabe', () => {
    mount('clock=manual&w=0&h=abc');
    expect(fake.canvasWidth).toBe(DEFAULT_WIDTH);
    expect(fake.canvasHeight).toBe(DEFAULT_HEIGHT);
  });

  it('startet bei `?clock=manual` KEINE Schleife und haengt trotzdem die Tastatur an', () => {
    mount('clock=manual');
    expect(fake.frames).toBe(0);
    expect(fake.events).toEqual(['keydown', 'keyup']);
  });

  it('startet ohne `?clock=manual` genau ein Bild ueber requestAnimationFrame', () => {
    mount('');
    expect(fake.frames).toBe(1);
  });

  it('zeichnet beim Einhaengen schon EIN Bild – der Hintergrund liegt vor allem anderen', () => {
    mount('clock=manual');
    expect(fake.rects.length).toBeGreaterThan(1);
    expect(fake.rects[0]).toEqual({ x: 0, y: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, fill: Colors.background });
  });

  it('`layers()` liest und setzt die Ebenen', () => {
    const hook = mount('clock=manual&layers=rooms,actors');
    expect(hook.layers()).toBe('rooms,actors');
    expect(hook.layers('all')).toBe('rooms,colliders,nav,marks,undershelf,actors');
    expect(hook.layers()).toBe('rooms,colliders,nav,marks,undershelf,actors');
  });

  it('`stats()` liefert nur Zahlen und zaehlt Kollider, Wegpunkte und Kanten der Vorgabe', () => {
    const hook = mount('clock=manual');
    const stats = hook.stats();
    expect(stats.tick).toBe(0);
    expect(stats.players).toBeGreaterThan(0);
    expect(stats.colliders).toBeGreaterThan(0);
    expect(stats.navPoints).toBeGreaterThan(0);
    expect(stats.navEdges).toBeGreaterThan(0);
    expect(Number.isFinite(stats.drawMs)).toBe(true);
  });

  it('`advance` wirft bei nicht ganzzahligen, negativen und absurd grossen Werten', () => {
    const hook = mount('clock=manual');
    expect(() => hook.advance(1.5)).toThrow(RangeError);
    expect(() => hook.advance(-1)).toThrow(RangeError);
    expect(() => hook.advance(100001)).toThrow(RangeError);
    expect(hook.tick()).toBe(0);
  });

  it('`tick()` LIEST nur – zweimal gelesen steht dieselbe Zahl da', () => {
    const hook = mount('clock=manual');
    hook.advance(5);
    expect(hook.tick()).toBe(5);
    expect(hook.tick()).toBe(5);
  });

  it('`pixelAt` liefert eine Farbe im Format #rrggbb', () => {
    const hook = mount('clock=manual');
    expect(hook.cmd['pixelAt']?.(0, 0)).toBe('#12131c');
  });

  it('`benchDraw` liefert Anzahl, Mittel, Minimum und Maximum', () => {
    const hook = mount('clock=manual');
    const result = hook.cmd['benchDraw']?.(3) as { frames: number; meanMs: number; minMs: number; maxMs: number };
    expect(result.frames).toBe(3);
    expect(result.minMs).toBeLessThanOrEqual(result.meanMs);
    expect(result.maxMs).toBeGreaterThanOrEqual(result.meanMs);
  });
});

describe('view2d/main: Raum-Ausschnitt `?room=` (R10)', () => {
  it('passt mit `?room=bau` GENAU die Grenzen dieses Raums ein', () => {
    // Layoutunabhaengig formuliert: das Rechteck wird aus den Grenzen des Raums berechnet, die die
    // Ansicht selbst geladen hat – die Zahlen stehen nicht abgeschrieben im Test.
    mount('clock=manual&room=bau');
    const bau = loadLevel(feinkostJson).rooms.find((room) => room.id === 'bau');
    if (bau === undefined) throw new Error('feinkost.json hat keinen Raum "bau"');
    const view = fitRoom(bau.bounds, DEFAULT_WIDTH, DEFAULT_HEIGHT);
    const rect = fake.rects.find((entry) => entry.fill === Colors.roomDiorama);
    expect(rect).toEqual({
      x: view.offsetX + bau.bounds.x0 * view.scale,
      y: view.offsetY + bau.bounds.z0 * view.scale,
      w: (bau.bounds.x1 - bau.bounds.x0) * view.scale,
      h: (bau.bounds.z1 - bau.bounds.z0) * view.scale,
      fill: Colors.roomDiorama,
    });
  });

  it('faellt bei einem unbekannten Raumnamen STILL auf das ganze Level zurueck', () => {
    // Eine Lesehilfe darf keinen Fehler werfen: ein Tippfehler in der URL zeigt das ganze Level.
    mount('clock=manual&room=gibtsnicht');
    const unknownRects = [...fake.rects];
    removeFakeDom();
    installFakeDom();
    mount('clock=manual');
    expect(unknownRects).toEqual(fake.rects);
  });

  it('`?room=verkaufsraum` gilt auch fuer die injizierte Fixture – derselbe Namensvergleich', () => {
    // Das Mini-Level hat bewusst ebenfalls einen Raum `verkaufsraum`: `loadFixtures` benutzt
    // DIESELBE Einpass-Regel wie die Vorgabe, sonst liefen injizierte Fixture und Vorgabe
    // auseinander. Das ist kein Zufall und steht deshalb hier.
    const hook = mount('clock=manual&room=verkaufsraum');
    fake.rects = [];
    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);
    const mini = loadLevel(levelFixture);
    const room = mini.rooms[0];
    if (room === undefined) throw new Error('mini-level.json hat keinen Raum');
    expect(room.id).toBe('verkaufsraum');
    const view = fitRoom(room.bounds, DEFAULT_WIDTH, DEFAULT_HEIGHT);
    expect(fake.rects.find((entry) => entry.fill === Colors.room)).toEqual({
      x: view.offsetX + room.bounds.x0 * view.scale,
      y: view.offsetY + room.bounds.z0 * view.scale,
      w: (room.bounds.x1 - room.bounds.x0) * view.scale,
      h: (room.bounds.z1 - room.bounds.z0) * view.scale,
      fill: Colors.room,
    });
  });
});

describe('view2d/main: cmd.loadFixtures baut alles neu', () => {
  it('setzt den Tick zurueck auf 0 und tauscht Runtime und Zustand aus', () => {
    const hook = mount('clock=manual');
    hook.advance(42);
    expect(hook.tick()).toBe(42);
    const before = hook.stats();

    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);

    const after = hook.stats();
    expect(after.tick).toBe(0);
    expect(hook.tick()).toBe(0);
    // Das Mini-Level hat 16 Kollider (15 aus M3 + Mauseloch-Stopfen), 3 Wegpunkte und 2 Kanten.
    expect(after.colliders).toBe(16);
    expect(after.navPoints).toBe(3);
    expect(after.navEdges).toBe(2);
    expect(after.colliders).not.toBe(before.colliders);
  });

  it('passt die Kamera neu ein – die Raumflaeche sitzt genau auf dem neu gerechneten Rechteck', () => {
    const hook = mount('clock=manual');
    fake.rects = [];
    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);

    const level = loadLevel(levelFixture);
    const view = fitLevel(levelBounds(level), DEFAULT_WIDTH, DEFAULT_HEIGHT, VIEW_MARGIN_PX);
    const bounds = levelBounds(level);
    const room = fake.rects.find((rect) => rect.fill === Colors.room);
    expect(room).toEqual({
      x: view.offsetX + bounds.x0 * view.scale,
      y: view.offsetY + bounds.z0 * view.scale,
      w: (bounds.x1 - bounds.x0) * view.scale,
      h: (bounds.z1 - bounds.z0) * view.scale,
      fill: Colors.room,
    });
    // Gegenprobe: waere die Kamera NICHT neu eingepasst, stuende hier noch die Skala der
    // 104 x 60 Einheiten grossen Vorgabe.
    expect(view.scale).toBe(23);
  });

  it('setzt klebende Eingaben zurueck und laeuft danach bitgleich zum Golden-Weg in Node', () => {
    const hook = mount('clock=manual');
    hook.setInput(0, 100, 0, 1);              // ein klebender Rahmen, der NICHT ueberleben darf
    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);
    expect(hook.advance(300)).toBe(300);

    // Derselbe Weg in Node, ohne Browser-Attrappe: dieselben eingefrorenen Fixtures, Saat 1,
    // 300 neutrale Ticks. Zwei Wege, eine Zahl.
    const level = loadLevel(levelFixture);
    const balance = loadBalance(balanceFixture);
    const state = createInitialState(level, balance, 1);
    const ctx = { balance, level, colliders: generateColliders(level) };
    for (let i = 0; i < 300; i += 1) step(state, [], ctx, []);
    expect(hook.hash()).toBe(hashState(state));
  });

  it('wirft, wenn die injizierten Daten Unsinn sind – der Fehler kommt im Test an', () => {
    const hook = mount('clock=manual');
    expect(() => hook.cmd['loadFixtures']?.({ id: 'kaputt' }, balanceFixture)).toThrow();
  });
});

describe('view2d/main: setInput', () => {
  it('haelt den Rahmen, bis er neu gesetzt wird – die Maus laeuft ueber mehrere Ticks', () => {
    const hook = mount('clock=manual');
    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);
    const ruhe = hook.hash();
    hook.setInput(0, 127, 0, 0);
    hook.advance(30);
    expect(hook.hash()).not.toBe(ruhe);
  });

  it('weist einen Platz zurueck, den es nicht gibt', () => {
    const hook = mount('clock=manual');
    expect(() => hook.setInput(9, 0, 0, 0)).toThrow(RangeError);
  });
});
