import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, mountView2d } from '../../../../src/render/view2d/main';
import type { MbHook } from '../../../../src/render/view2d/hook';
import { Colors } from '../../../../src/render/view2d/draw';
import { VIEW_MARGIN_PX, fitLevel, fitRoom, levelBounds } from '../../../../src/render/view2d/camera2d';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { hashState } from '../../../../src/core/sim/hash';
import { createInitialState } from '../../../../src/core/sim/state';
import { step } from '../../../../src/core/sim/step';
import { buildLevelRuntime } from '../../../../src/core/world/levelRuntime';
import { generateColliders } from '../../../../src/core/world/generateColliders';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import balanceJson from '../../../../src/data/balance.json';
import feinkostJson from '../../../../src/data/levels/feinkost.json';
import balanceFixture from '../../../fixtures/core/test-balance.json';
import levelFixture from '../../../fixtures/core/mini-level.json';

/**
 * DOM-Attrappe statt jsdom: `mountView2d` braucht aus dem Browser genau
 * `document.createElement('canvas')`, `canvas.getContext`, `document.visibilityState`,
 * `stage.append`, `window.addEventListener` und die beiden rAF-Funktionen. Die Umgebung bleibt
 * `node` (vitest.config.ts), wie im ganzen Projekt.
 *
 * WAS DIE ATTRAPPE NICHT KANN – damit niemand hier einen Beweis sucht, den sie nicht trägt:
 * sie ZEICHNET nichts, sie protokolliert nur `fillRect` mit dem zum Aufrufzeitpunkt gesetzten
 * `fillStyle`. `arc`, `fill`, `stroke`, `moveTo`, `lineTo`, `save`, `restore`, `translate`,
 * `rotate` sind No-ops: in `fake.rects` steht deshalb kein Kreis, keine Linie, keine Deckkraft –
 * und für einen GEDREHTEN Kollider ein Rechteck in LOKALEN Koordinaten (`fillCollider` malt nach
 * `translate`/`rotate` bei `(-hx, -hz)`). Kreise, Linien, Deckkraft und Drehung prüft
 * `draw.test.ts` mit dem aufzeichnenden Kontext, die echten Farben der Tor-Spec im Browser.
 */
interface Rect { x: number; y: number; w: number; h: number; fill: string }

interface Fake {
  rects: Rect[];
  canvasWidth: number;
  canvasHeight: number;
  events: string[];
  frames: number;
  /** Die Argumente des EINEN `getContext`-Aufrufs – die Flags sind eine Global Constraint. */
  ctxArgs: unknown[];
  /** Antwort der Attrappe auf `document.visibilityState`. */
  visibility: string;
  /** Rückrufe je Ereignisart, damit ein Test `blur` und `visibilitychange` auslösen kann. */
  listeners: { type: string; run: (event: unknown) => void }[];
  /** Läuft vor jedem `fillRect` – der Haken für die gestellte, langsame Zeichnung. */
  beforeFill: (() => void) | undefined;
}

const fake: Fake = {
  rects: [], canvasWidth: 0, canvasHeight: 0, events: [], frames: 0, ctxArgs: [],
  visibility: 'visible', listeners: [], beforeFill: undefined,
};

/** Löst ein Fenster-Ereignis aus; `fire` scheitert hart, wenn niemand darauf hört. */
function fire(type: string): void {
  const hits = fake.listeners.filter((entry) => entry.type === type);
  if (hits.length === 0) throw new Error(`niemand hoert auf ${type}`);
  for (const hit of hits) hit.run({ code: '', preventDefault: () => {} });
}

/**
 * Führt `run` mit einer GESTELLTEN Uhr aus: `performance.now` liefert die Werte der Reihe nach.
 * Nur so sind `meanMs`/`minMs`/`maxMs` und „`drawMs` ist das letzte Bild" überhaupt prüfbar – mit
 * der echten Uhr stünde in jedem Lauf eine andere Zahl. Nach dem Aufruf steht die echte Uhr wieder.
 */
function withClock<T>(times: readonly number[], run: () => T): T {
  const clock = performance as unknown as { now: () => number };
  const real = clock.now;
  let index = 0;
  clock.now = (): number => times[index++] ?? 0;
  try {
    return run();
  } finally {
    clock.now = real;
  }
}

/** Tastendruck über den echten `keydown`-Rückruf der Ansicht. */
function press(type: 'keydown' | 'keyup', code: string): void {
  const hit = fake.listeners.find((entry) => entry.type === type);
  if (hit === undefined) throw new Error(`niemand hoert auf ${type}`);
  hit.run({ code, preventDefault: () => {} });
}

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
    fillRect: (x: number, y: number, w: number, h: number) => {
      fake.beforeFill?.();
      fake.rects.push({ x, y, w, h, fill: state.fillStyle });
    },
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
  fake.ctxArgs = [];
  fake.visibility = 'visible';
  fake.listeners = [];
  fake.beforeFill = undefined;
  const canvas = {
    width: 0, height: 0,
    getContext: (kind: string, options: unknown) => {
      fake.ctxArgs = [kind, options];
      return fakeContext();
    },
  };
  const document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unerwartetes Element ${tag}`);
      return canvas;
    },
    get visibilityState(): string { return fake.visibility; },
  };
  const win = {
    addEventListener: (type: string, run: (event: unknown) => void) => {
      fake.events.push(type);
      fake.listeners.push({ type, run });
    },
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

/**
 * Frische Attrappe UND frische Ansicht mitten im Test – `beforeEach` gibt nur eine je Fall.
 * Steht hier EINMAL, statt in jedem Fall `removeFakeDom(); installFakeDom();` zu wiederholen.
 */
function remount(search: string): MbHook {
  removeFakeDom();
  installFakeDom();
  return mount(search);
}

beforeEach(installFakeDom);
afterEach(removeFakeDom);

/**
 * Dieselben Daten, die die Ansicht ohne `cmd.loadFixtures` laedt – damit die Erwartungen HERGELEITET
 * werden statt abgeschrieben. `src/data/balance.json` steht hier nur als QUELLE der Zahlen, keine
 * ihrer Werte wird gepinnt: ein Reglerdreh in M6 verschiebt Test und Ansicht gemeinsam.
 */
const defaultRuntime = buildLevelRuntime(loadLevel(feinkostJson), loadBalance(balanceJson));
const defaultEdges = defaultRuntime.nav.adjacency.reduce((sum, list) => sum + list.length, 0) / 2;

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
    remount('clock=manual&w=640&h=480');
    expect(fake.canvasWidth).toBe(640);
    expect(fake.canvasHeight).toBe(480);
  });

  it('holt den Kontext mit `{ alpha: false, willReadFrequently: true }` – eine Global Constraint', () => {
    // `willReadFrequently` haengt an `cmd.pixelAt` (`getImageData` je Probe). Ohne diese Zeile
    // bliebe ein gekuerztes `getContext('2d', { alpha: false })` unbemerkt.
    mount('clock=manual');
    expect(fake.ctxArgs).toEqual(['2d', { alpha: false, willReadFrequently: true }]);
  });

  it('uebergeht unsinnige Masse und bleibt bei der Vorgabe', () => {
    mount('clock=manual&w=0&h=abc');
    expect(fake.canvasWidth).toBe(DEFAULT_WIDTH);
    expect(fake.canvasHeight).toBe(DEFAULT_HEIGHT);
  });

  it('startet bei `?clock=manual` KEINE Schleife und haengt trotzdem die Tastatur an', () => {
    mount('clock=manual');
    expect(fake.frames).toBe(0);
    expect(fake.events).toEqual(['keydown', 'keyup', 'blur', 'visibilitychange']);
  });

  it('startet ohne `?clock=manual` genau ein Bild ueber requestAnimationFrame', () => {
    mount('');
    expect(fake.frames).toBe(1);
  });

  it('zeichnet beim Einhaengen schon EIN Bild – Hintergrund, Raeume und JEDER Kollider', () => {
    mount('clock=manual');
    expect(fake.rects[0]).toEqual({ x: 0, y: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, fill: Colors.background });
    // Die Zahl steht nicht abgeschrieben da, sie kommt aus derselben Vorgabe, die die Ansicht laedt:
    // jeder Kollider ist genau ein `fillRect` in einer Maskenfarbe (39 in feinkost). Ein „> 1" ginge
    // auch durch, wenn die Ansicht nur einen Raum und sonst nichts zeichnet.
    const flaechen = [Colors.background, Colors.room, Colors.roomDiorama, Colors.underShelf];
    const colliderRects = fake.rects.filter((rect) => !flaechen.includes(rect.fill));
    expect(colliderRects).toHaveLength(defaultRuntime.colliders.length);
    expect(fake.rects.filter((rect) => rect.fill === Colors.room || rect.fill === Colors.roomDiorama))
      .toHaveLength(defaultRuntime.level.rooms.length);
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
    // EXAKT gegen dieselben Daten, die die Ansicht laedt (39 / 60 / 91 in feinkost) – hergeleitet,
    // nicht abgeschrieben: ein „> 0" bestaetigte auch eine Ansicht, die fast nichts kennt.
    expect(stats.colliders).toBe(defaultRuntime.colliders.length);
    expect(stats.navPoints).toBe(defaultRuntime.nav.points.length);
    expect(stats.navEdges).toBe(defaultEdges);
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

  it('`benchDraw` liefert Anzahl, Mittel, Minimum und Maximum – gegen eine GESTELLTE Uhr', () => {
    // `performance.now` wird fuer diesen Fall ersetzt: mit der echten Uhr sind die vier Zahlen nicht
    // pruefbar, und „min <= mittel <= max" hielte auch fuer drei gleiche Werte. Drei Bilder mit den
    // Dauern 5 / 1 / 2 ms sind eindeutig – und das LETZTE ist absichtlich nicht das langsamste.
    const hook = mount('clock=manual');
    const result = withClock([0, 5, 5, 6, 6, 8], () => hook.cmd['benchDraw']?.(3)) as
      { frames: number; meanMs: number; minMs: number; maxMs: number };
    expect(result).toEqual({ frames: 3, meanMs: 8 / 3, minMs: 1, maxMs: 5 });
  });

  it('`stats().drawMs` meldet nach benchDraw das LETZTE Bild, nicht das langsamste (hook.ts)', () => {
    // Der Vertrag in `hook.ts` sagt „Dauer des LETZTEN Bildes; Mittel und Streuung liefert
    // `cmd.benchDraw`". Mit `drawMs = max` stuende hier 5 statt 2.
    const hook = mount('clock=manual');
    withClock([0, 5, 5, 6, 6, 8], () => hook.cmd['benchDraw']?.(3));
    expect(hook.stats().drawMs).toBe(2);
  });

  it('`?seed=` saet den Zustand – eine andere Saat ergibt einen anderen Hash', () => {
    const hash1 = mount('clock=manual').hash();
    const hash2 = remount('clock=manual&seed=2').hash();
    const again1 = remount('clock=manual&seed=1').hash();
    expect(hash2).not.toBe(hash1);
    // Und die Vorgabe IST die Saat '1' (DEFAULT_SEED), nicht irgendeine andere.
    expect(again1).toBe(hash1);
  });

  it('`setInput` wirft bei Werten, die das Drahtformat nicht traegt', () => {
    // Wie `advance`: ein vertippter Aufruf soll hier eine Meldung liefern, nicht Ticks spaeter als
    // NaNError aus `hashState` auftauchen.
    const hook = mount('clock=manual');
    for (const bad of [1.5, Number.NaN, 128, -128, Number.POSITIVE_INFINITY]) {
      expect(() => hook.setInput(0, bad, 0, 0), `mx ${bad}`).toThrow(RangeError);
      expect(() => hook.setInput(0, 0, bad, 0), `mz ${bad}`).toThrow(RangeError);
    }
    for (const bad of [1.5, Number.NaN, -1, 256]) {
      expect(() => hook.setInput(0, 0, 0, bad), `buttons ${bad}`).toThrow(RangeError);
    }
    // Die Grenzen selbst gelten: 127 ist die volle Auslenkung der Tastatur, 255 ein voller Knopfsatz.
    expect(() => hook.setInput(0, 127, -127, 255)).not.toThrow();
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
    remount('clock=manual');
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
    // Verglichen wird auf DEMSELBEN Tick: `hashState` hasht `state.tick` mit, ein Vergleich
    // „Tick 0 gegen Tick 30" waere von der Eingabe voellig unabhaengig und koennte nicht
    // fehlschlagen. `loadFixtures` setzt Zustand UND klebende Rahmen zurueck, also ist der zweite
    // Lauf derselbe Anfang – nur mit Eingabe.
    const hook = mount('clock=manual');
    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);
    hook.advance(30);
    const ruhig = hook.hash();

    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);
    hook.setInput(0, 127, 0, 0);
    hook.advance(30);
    expect(hook.tick()).toBe(30);
    expect(hook.hash()).not.toBe(ruhig);
  });

  it('weist einen Platz zurueck, den es nicht gibt', () => {
    const hook = mount('clock=manual');
    expect(() => hook.setInput(9, 0, 0, 0)).toThrow(RangeError);
  });
});

describe('view2d/main: Tastatur an der Huelle', () => {
  /**
   * Haelt `KeyD` gedrueckt, rechnet 5 Ticks, loest dann `event` aus (falls eines genannt ist) und
   * rechnet weitere 25 Ticks. Zurueck kommt der Zustandshash auf Tick 30 – immer derselbe Tick,
   * also unterscheidet nur die Eingabe die Ergebnisse.
   */
  function runHeld(event: 'blur' | 'visibilitychange' | null, visibility = 'hidden'): number {
    const hook = remount('clock=manual');
    hook.cmd['loadFixtures']?.(levelFixture, balanceFixture);
    press('keydown', 'KeyD');
    hook.advance(5);
    if (event !== null) {
      fake.visibility = visibility;
      fire(event);
    }
    hook.advance(25);
    expect(hook.tick()).toBe(30);
    return hook.hash();
  }

  it('leert die Tastatur bei `blur` und bei `visibilitychange` -> hidden', () => {
    // Bei Fokusverlust kommt kein `keyup`: ohne `keyboard.reset()` laeuft die Maus weiter, bis die
    // Taste erneut gedrueckt UND losgelassen wird.
    const weiter = runHeld(null);
    const nachBlur = runHeld('blur');
    const nachVerstecken = runHeld('visibilitychange', 'hidden');
    expect(nachBlur).not.toBe(weiter);
    // Beide Wege muessen DASSELBE tun – ist nur einer verdrahtet, faellt dieser Vergleich.
    expect(nachVerstecken).toBe(nachBlur);
  });

  it('ein `visibilitychange` auf SICHTBAR setzt nichts zurueck', () => {
    // Die Seite kommt zurueck in den Vordergrund: das ist kein Fokusverlust.
    expect(runHeld('visibilitychange', 'visible')).toBe(runHeld(null));
  });
});
