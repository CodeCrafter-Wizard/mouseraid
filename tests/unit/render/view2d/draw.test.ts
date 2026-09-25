import { describe, expect, it } from 'vitest';
import {
  Colors, LAYERS, MASK_COLORS, UNDER_SHELF_ALPHA, colorForMask, drawFrame, layerText, parseLayers,
} from '../../../../src/render/view2d/draw';
import type { Layer, LayerMask } from '../../../../src/render/view2d/draw';
import { VIEW_MARGIN_PX, fitLevel, levelBounds } from '../../../../src/render/view2d/camera2d';
import type { Collider } from '../../../../src/core/world/colliderTypes';
import type { LevelDef } from '../../../../src/core/world/levelTypes';
import { CM_PER_UNIT } from '../../../../src/core/world/levelTypes';
import type { LevelRuntime, NavGraph } from '../../../../src/core/world/levelRuntime';
import { createInitialState } from '../../../../src/core/sim/state';
import type { WorldState } from '../../../../src/core/sim/state';
import { testBalance } from '../../core/testWorld';

// ───────── aufzeichnender Kontext ─────────
// Kein jsdom: die Umgebung ist `node`, und `drawFrame` braucht vom Kontext nur ein Dutzend
// Methoden. Jeder Aufruf merkt sich die zu DIESEM Zeitpunkt gesetzten Stile – nur so ist
// beweisbar, dass die Unter-Regal-Zone mit gesetzter Deckkraft gemalt wird und danach nicht mehr.
interface Call { op: string; args: number[]; fill: string; stroke: string; alpha: number }

function recorder(): { calls: Call[]; ctx: CanvasRenderingContext2D } {
  const calls: Call[] = [];
  const state = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1 };
  const push = (op: string, ...args: number[]): void => {
    calls.push({ op, args, fill: String(state.fillStyle), stroke: String(state.strokeStyle), alpha: state.globalAlpha });
  };
  const fake = {
    get fillStyle(): string { return state.fillStyle; },
    set fillStyle(value: string) { state.fillStyle = value; },
    get strokeStyle(): string { return state.strokeStyle; },
    set strokeStyle(value: string) { state.strokeStyle = value; },
    get globalAlpha(): number { return state.globalAlpha; },
    set globalAlpha(value: number) { state.globalAlpha = value; },
    get lineWidth(): number { return state.lineWidth; },
    set lineWidth(value: number) { state.lineWidth = value; },
    fillRect: (x: number, y: number, w: number, h: number) => push('fillRect', x, y, w, h),
    beginPath: () => push('beginPath'),
    moveTo: (x: number, y: number) => push('moveTo', x, y),
    lineTo: (x: number, y: number) => push('lineTo', x, y),
    stroke: () => push('stroke'),
    arc: (x: number, y: number, r: number) => push('arc', x, y, r),
    fill: () => push('fill'),
    save: () => push('save'),
    restore: () => push('restore'),
    translate: (x: number, y: number) => push('translate', x, y),
    rotate: (a: number) => push('rotate', a),
  };
  return { calls, ctx: fake as unknown as CanvasRenderingContext2D };
}

// ───────── Buehne ─────────
function collider(id: number, cx: number, cz: number, blocks: number, y0 = 0, rot = 0): Collider {
  return { id, cx, cz, hx: 2, hz: 2, y0, y1: y0 + 5, rot, rc: Math.cos(rot), rs: Math.sin(rot), blocks, occluderGroup: id + 1 };
}

const WALL = 15;
const LEG = 5;
const CANOPY = 14;
const PLANT = 6;
const WINDOW = 11;
const PLUG = 10;
/** Keine Zeile der Tafel – muss in der Ansicht auffallen statt sich zu tarnen. */
const UNKNOWN = 3;

function stageLevel(): LevelDef {
  return {
    id: 'zeichen', scale: CM_PER_UNIT,
    rooms: [
      { id: 'laden', name: 'Laden', bounds: { x0: -20, z0: -15, x1: 20, z1: 15 }, cameraMode: 'follow' },
      { id: 'bau', name: 'Bau', bounds: { x0: -32, z0: -4, x1: -20, z1: 4 }, cameraMode: 'diorama' },
    ],
    walls: [], shelves: [], boxes: [],
    plants: [{ id: 'p1', x: 8, z: 8, radiusCm: 25, heightCm: 60 }],
    lootSpawns: [{ id: 'l1', x: -4, z: 2, table: 'kaese' }],
    nav: { points: [{ id: 'a', x: -8, z: -8 }, { id: 'b', x: 0, z: -8 }] },
    spawns: { mice: [{ x: -26, z: 0 }, { x: -24, z: 0 }], cat: { x: 12, z: 12 } },
    mouseHole: { x: -20, z: 0, widthCm: 20, heightCm: 200, thicknessCm: 10, rot: 1.5707963267948966 },
  };
}

function stageRuntime(colliders: readonly Collider[]): LevelRuntime {
  const level = stageLevel();
  const nav: NavGraph = {
    points: [{ id: 'a', x: -8, z: -8, room: 0 }, { id: 'b', x: 0, z: -8, room: 0 }],
    adjacency: [[1], [0]],
    lengths: [[8], [8]],
  };
  return { level, colliders, nav };
}

function stageState(level: LevelDef): WorldState {
  return createInitialState(level, testBalance(), 'zeichen');
}

const ALL = parseLayers(null);

function viewFor(runtime: LevelRuntime): ReturnType<typeof fitLevel> {
  return fitLevel(levelBounds(runtime.level), 400, 300, VIEW_MARGIN_PX);
}

const firstWith = (calls: readonly Call[], op: string, fill: string): number =>
  calls.findIndex((call) => call.op === op && call.fill === fill);

describe('draw: Farbtafel', () => {
  it('bildet jede der sechs Masken auf genau die Farbe der Tafel ab (EXAKT, nicht mit Toleranz)', () => {
    expect(colorForMask(15)).toBe(Colors.wall);
    expect(colorForMask(5)).toBe(Colors.leg);
    expect(colorForMask(14)).toBe(Colors.canopy);
    expect(colorForMask(6)).toBe(Colors.plant);
    expect(colorForMask(11)).toBe(Colors.window);
    expect(colorForMask(10)).toBe(Colors.hole);
  });

  it('MASK_COLORS enthaelt genau diese sechs Zeilen, ohne doppelte Maske', () => {
    expect(MASK_COLORS.map((entry) => entry.blocks)).toEqual([15, 5, 14, 6, 11, 10]);
    expect(new Set(MASK_COLORS.map((entry) => entry.blocks)).size).toBe(MASK_COLORS.length);
    for (const entry of MASK_COLORS) expect(entry.color).toBe(colorForMask(entry.blocks));
  });

  it('faellt bei einer unbekannten Maske auf die grelle Warnfarbe zurueck', () => {
    for (const blocks of [0, 1, 2, 3, 4, 7, 8, 9, 12, 13]) {
      expect(colorForMask(blocks)).toBe(Colors.unknownMask);
    }
    // Die Warnfarbe steht in KEINER Zeile der Tafel – sonst waere sie nicht als Warnung erkennbar.
    expect(MASK_COLORS.some((entry) => entry.color === Colors.unknownMask)).toBe(false);
  });

  it('gibt jede Tafelfarbe genau einmal aus – zwei gleiche Farben waeren in der Ansicht blind', () => {
    const colors = MASK_COLORS.map((entry) => entry.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('draw: Ebenen', () => {
  it('LAYERS ist die Zeichenreihenfolge und enthaelt die sechs Ebenen', () => {
    expect(LAYERS).toEqual(['rooms', 'colliders', 'nav', 'marks', 'undershelf', 'actors']);
  });

  it('parseLayers: null und "all" schalten alles an, "" alles aus', () => {
    expect(layerText(parseLayers(null))).toBe('rooms,colliders,nav,marks,undershelf,actors');
    expect(layerText(parseLayers('all'))).toBe('rooms,colliders,nav,marks,undershelf,actors');
    expect(layerText(parseLayers(''))).toBe('');
  });

  it('parseLayers: Komma-Liste, Leerzeichen erlaubt, Reihenfolge immer die von LAYERS', () => {
    expect(layerText(parseLayers('actors,rooms'))).toBe('rooms,actors');
    expect(layerText(parseLayers(' nav , colliders '))).toBe('colliders,nav');
  });

  it('parseLayers: unbekannte Namen werden uebergangen – der Tippfehler zeigt sich an der fehlenden Ebene', () => {
    expect(layerText(parseLayers('rooms,aktoren'))).toBe('rooms');
    expect(layerText(parseLayers('unsinn'))).toBe('');
  });

  it('eine abgeschaltete Ebene zeichnet nichts: ohne "actors" gibt es keinen Kreis', () => {
    const runtime = stageRuntime([collider(0, 0, 0, WALL)]);
    const state = stageState(runtime.level);
    const withActors = recorder();
    drawFrame(withActors.ctx, viewFor(runtime), runtime, state, ALL);
    expect(withActors.calls.some((call) => call.op === 'arc')).toBe(true);

    const without = recorder();
    const mask: LayerMask = parseLayers('rooms,colliders');
    drawFrame(without.ctx, viewFor(runtime), runtime, state, mask);
    expect(without.calls.some((call) => call.op === 'arc')).toBe(false);
  });

  it('bei leerer Ebenenliste bleibt genau der Hintergrund uebrig', () => {
    const runtime = stageRuntime([collider(0, 0, 0, WALL)]);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), parseLayers(''));
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.op).toBe('fillRect');
    expect(rec.calls[0]?.fill).toBe(Colors.background);
  });
});

describe('draw: Zeichenreihenfolge', () => {
  const colliders = [
    collider(0, -10, -10, WALL),
    collider(1, -6, 6, LEG),
    collider(2, 0, 6, CANOPY, 1.2),
    collider(3, 8, 8, PLANT),
    collider(4, 10, -12, WINDOW),
    collider(5, -20, 0, PLUG, 0, 1.5707963267948966),
    collider(6, 14, 0, UNKNOWN),
  ];

  it('faengt mit dem Hintergrund an und legt die Raumflaechen darauf', () => {
    const runtime = stageRuntime(colliders);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL);
    expect(rec.calls[0]?.fill).toBe(Colors.background);
    expect(firstWith(rec.calls, 'fillRect', Colors.room)).toBeGreaterThan(0);
    // Der Diorama-Raum bekommt eine eigene, hellere Flaeche.
    expect(firstWith(rec.calls, 'fillRect', Colors.roomDiorama)).toBeGreaterThan(0);
  });

  it('zeichnet die Unter-Regal-Zone NACH dem Baldachin – sonst deckt der Baldachin sie zu', () => {
    const runtime = stageRuntime(colliders);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL);
    const canopy = firstWith(rec.calls, 'fillRect', Colors.canopy);
    const zone = firstWith(rec.calls, 'fillRect', Colors.underShelf);
    expect(canopy).toBeGreaterThanOrEqual(0);
    expect(zone).toBeGreaterThan(canopy);
  });

  it('haelt die volle Kette: Raum -> Kollider -> Nav -> Marken -> Unter-Regal -> Figuren', () => {
    const runtime = stageRuntime(colliders);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL);
    const room = firstWith(rec.calls, 'fillRect', Colors.room);
    const wall = firstWith(rec.calls, 'fillRect', Colors.wall);
    const navEdge = rec.calls.findIndex((call) => call.op === 'stroke' && call.stroke === Colors.navEdge);
    const navPoint = firstWith(rec.calls, 'arc', Colors.navPoint);
    const loot = firstWith(rec.calls, 'arc', Colors.loot);
    const zone = firstWith(rec.calls, 'fillRect', Colors.underShelf);
    const mouse = firstWith(rec.calls, 'arc', Colors.mouse);
    const cat = firstWith(rec.calls, 'arc', Colors.cat);
    for (const index of [room, wall, navEdge, navPoint, loot, zone, mouse, cat]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(room).toBeLessThan(wall);
    expect(wall).toBeLessThan(navEdge);
    expect(navEdge).toBeLessThan(navPoint);
    expect(navPoint).toBeLessThan(loot);
    expect(loot).toBeLessThan(zone);
    expect(zone).toBeLessThan(mouse);
    expect(mouse).toBeLessThan(cat);
  });

  it('malt die unbekannte Maske in der Warnfarbe', () => {
    const runtime = stageRuntime(colliders);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL);
    expect(firstWith(rec.calls, 'fillRect', Colors.unknownMask)).toBeGreaterThan(0);
  });

  it('dreht nur die gedrehten Kollider und stellt den Kontext danach wieder her', () => {
    const runtime = stageRuntime(colliders);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL);
    const rotations = rec.calls.filter((call) => call.op === 'rotate');
    // GENAU EINER der sieben Kollider ist gedreht (der Mauseloch-Stopfen).
    expect(rotations).toHaveLength(1);
    expect(rotations[0]?.args[0]).toBeCloseTo(1.5707963267948966, 12);
    expect(rec.calls.filter((call) => call.op === 'save')).toHaveLength(1);
    expect(rec.calls.filter((call) => call.op === 'restore')).toHaveLength(1);
  });
});

describe('draw: Deckkraft der Unter-Regal-Zone', () => {
  it('malt die Zone mit UNDER_SHELF_ALPHA und setzt globalAlpha danach auf 1 zurueck', () => {
    const runtime = stageRuntime([collider(0, 0, 6, CANOPY, 1.2), collider(1, -10, -10, WALL)]);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL);
    const zone = rec.calls.find((call) => call.op === 'fillRect' && call.fill === Colors.underShelf);
    expect(zone?.alpha).toBe(UNDER_SHELF_ALPHA);
    // Alles NACH der Zone laeuft wieder mit voller Deckkraft – sonst waeren die Figuren blass.
    const zoneIndex = firstWith(rec.calls, 'fillRect', Colors.underShelf);
    for (const call of rec.calls.slice(zoneIndex + 1)) expect(call.alpha).toBe(1);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  it('erkennt die Zone allein an den Masken: haelt CAT auf, MOUSE nicht, y0 > 0', () => {
    // Pflanze (6) und Stopfen (10) halten die Katze auch auf, stehen aber auf dem Boden (y0 = 0).
    // Das Regalbein (5) schwebt nicht und laesst die Katze durch. Nur der Baldachin ist die Zone.
    const runtime = stageRuntime([
      collider(0, -6, 6, LEG),
      collider(1, 0, 6, CANOPY, 1.2),
      collider(2, 8, 8, PLANT),
      collider(3, -20, 0, PLUG),
    ]);
    const rec = recorder();
    drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL);
    expect(rec.calls.filter((call) => call.op === 'fillRect' && call.fill === Colors.underShelf)).toHaveLength(1);
  });
});

describe('draw: kein Text auf der Leinwand', () => {
  it('ruft weder fillText noch strokeText – der aufzeichnende Kontext kennt sie gar nicht', () => {
    const runtime = stageRuntime([collider(0, 0, 0, WALL)]);
    const rec = recorder();
    // Haette `drawFrame` Text gezeichnet, waere der Aufruf hier eine TypeError-Ausnahme.
    expect(() => drawFrame(rec.ctx, viewFor(runtime), runtime, stageState(runtime.level), ALL)).not.toThrow();
    for (const call of rec.calls) expect(call.op).not.toMatch(/Text$/);
  });
});

describe('draw: Ebenennamen', () => {
  it('jede Ebene laesst sich einzeln setzen und wieder auslesen', () => {
    for (const layer of LAYERS) {
      const mask: LayerMask = parseLayers(layer);
      expect(layerText(mask)).toBe(layer);
      expect(mask[layer as Layer]).toBe(true);
    }
  });
});
