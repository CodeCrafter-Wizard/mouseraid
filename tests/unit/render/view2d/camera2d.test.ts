import { describe, expect, it } from 'vitest';
import {
  VIEW_MARGIN_PX, crisp, fitLevel, fitRoom, levelBounds, worldToScreen,
} from '../../../../src/render/view2d/camera2d';
import type { ScreenPoint } from '../../../../src/render/view2d/camera2d';
import type { LevelBounds, LevelDef, LevelRoom } from '../../../../src/core/world/levelTypes';
import { emptyLevel } from '../../core/testWorld';

function room(id: string, bounds: LevelBounds): LevelRoom {
  return { id, name: id, bounds, cameraMode: 'follow' };
}

function level(rooms: readonly LevelRoom[]): LevelDef {
  return emptyLevel({ id: 'kamera', rooms });
}

const out: ScreenPoint = { sx: 0, sy: 0 };

describe('camera2d: levelBounds', () => {
  it('umschliesst ALLE Raeume, auch den weiter aussen liegenden', () => {
    const bounds = levelBounds(level([
      room('laden', { x0: -40, z0: -30, x1: 40, z1: 30 }),
      room('bau', { x0: -64, z0: -8, x1: -40, z1: 8 }),
    ]));
    expect(bounds).toEqual({ x0: -64, z0: -30, x1: 40, z1: 30 });
  });

  it('nimmt bei einem einzigen Raum genau dessen Grenzen', () => {
    expect(levelBounds(level([room('nur', { x0: -20, z0: -15, x1: 20, z1: 15 })]))).toEqual(
      { x0: -20, z0: -15, x1: 20, z1: 15 },
    );
  });

  it('nimmt NICHT die Kollider: eine Wand ragt um ihre Halbdicke hinaus', () => {
    // Waende stehen im LevelDef, spielen fuer die Huelle aber keine Rolle – sonst verzoege jede
    // Wanddicke die Skala.
    const def = level([room('laden', { x0: 0, z0: 0, x1: 10, z1: 10 })]);
    const withWall: LevelDef = { ...def, walls: [{ x0: 0, z0: 0, x1: 10, z1: 0, heightCm: 200, thicknessCm: 10 }] };
    expect(levelBounds(withWall)).toEqual({ x0: 0, z0: 0, x1: 10, z1: 10 });
  });
});

describe('camera2d: fitLevel', () => {
  it('liefert eine GANZZAHLIGE Skala', () => {
    const view = fitLevel({ x0: -64, z0: -30, x1: 40, z1: 30 }, 960, 720, VIEW_MARGIN_PX);
    expect(Number.isInteger(view.scale)).toBe(true);
    // 104 x 60 Einheiten, nutzbar 944 x 704 px: min(944/104, 704/60) = 9.0769… -> 9.
    expect(view.scale).toBe(9);
    expect(view.width).toBe(960);
    expect(view.height).toBe(720);
  });

  it('haelt den Randabstand ein – das Level passt mit Rand in die Leinwand', () => {
    for (const [w, h] of [[960, 720], [640, 480], [1280, 800], [200, 150]] as const) {
      const bounds = { x0: -64, z0: -30, x1: 40, z1: 30 };
      const view = fitLevel(bounds, w, h, VIEW_MARGIN_PX);
      const spanX = (bounds.x1 - bounds.x0) * view.scale;
      const spanZ = (bounds.z1 - bounds.z0) * view.scale;
      expect(spanX).toBeLessThanOrEqual(w - 2 * VIEW_MARGIN_PX);
      expect(spanZ).toBeLessThanOrEqual(h - 2 * VIEW_MARGIN_PX);
    }
  });

  it('zentriert: der Rand links ist so gross wie der Rand rechts (bis auf ein Pixel)', () => {
    const bounds = { x0: -64, z0: -30, x1: 40, z1: 30 };
    const view = fitLevel(bounds, 960, 720, VIEW_MARGIN_PX);
    worldToScreen(view, bounds.x0, bounds.z0, out);
    const left = out.sx;
    const top = out.sy;
    worldToScreen(view, bounds.x1, bounds.z1, out);
    expect(Math.abs((960 - out.sx) - left)).toBeLessThanOrEqual(1);
    expect(Math.abs((720 - out.sy) - top)).toBeLessThanOrEqual(1);
    // Und der Versatz selbst ist ganzzahlig, damit das Raster zwischen zwei Bildern nicht wandert.
    expect(Number.isInteger(left)).toBe(true);
    expect(Number.isInteger(top)).toBe(true);
  });

  it('der Versatz bleibt auch bei UNGERADEM Restplatz ganzzahlig (961 x 721)', () => {
    // 960 x 720 laesst fuer 104 x 60 Einheiten bei Skala 9 genau 24 bzw. 180 px Rest – beide gerade,
    // also schon ohne `Math.round` ganzzahlig. Mit 961 x 721 bleiben 25 bzw. 181 px: ohne das
    // `Math.round` in `fitLevel` endete der Versatz hier auf ,5 und das Raster wanderte um einen
    // halben Pixel.
    const bounds = { x0: -64, z0: -30, x1: 40, z1: 30 };
    const view = fitLevel(bounds, 961, 721, VIEW_MARGIN_PX);
    expect(view.scale).toBe(9);
    expect((961 - (bounds.x1 - bounds.x0) * view.scale) % 2).toBe(1);
    expect(Number.isInteger(view.offsetX)).toBe(true);
    expect(Number.isInteger(view.offsetY)).toBe(true);
  });

  it('faellt nie unter Skala 1, auch wenn die Leinwand winzig ist', () => {
    const view = fitLevel({ x0: 0, z0: 0, x1: 1000, z1: 1000 }, 100, 100, VIEW_MARGIN_PX);
    expect(view.scale).toBe(1);
  });

  it('verkraftet einen Rand, der groesser ist als die Leinwand', () => {
    const view = fitLevel({ x0: 0, z0: 0, x1: 10, z1: 10 }, 20, 20, 50);
    expect(view.scale).toBe(1);
    expect(Number.isFinite(view.offsetX)).toBe(true);
  });
});

describe('camera2d: fitRoom (R10 – Raum-Ausschnitt fuer die Layoutpruefung)', () => {
  it('nimmt die Grenzen EINES Raums mit derselben ganzzahligen Skala', () => {
    // Die Grenzen stehen als Literal da, nicht aus feinkost.json: eine Layout-Aenderung darf
    // diesen Fall nicht rot machen. 24 x 16 u, nutzbar 944 x 704 -> min(39.33, 44) = 39.
    const view = fitRoom({ x0: -64, z0: -8, x1: -40, z1: 8 }, 960, 720);
    expect(view.scale).toBe(39);
    expect(Number.isInteger(view.scale)).toBe(true);
    expect(view.width).toBe(960);
    expect(view.height).toBe(720);
  });

  it('stimmt bei identischen Grenzen mit fitLevel + VIEW_MARGIN_PX ueberein', () => {
    // `fitRoom` ist KEIN zweiter Algorithmus – der Randabstand ist nur nicht mehr Parameter.
    const bounds = { x0: -40, z0: -30, x1: 40, z1: 30 };
    expect(fitRoom(bounds, 960, 720)).toEqual(fitLevel(bounds, 960, 720, VIEW_MARGIN_PX));
  });
});

describe('camera2d: worldToScreen', () => {
  it('schreibt in `out` UND gibt genau dieses Objekt zurueck', () => {
    const view = fitLevel({ x0: 0, z0: 0, x1: 10, z1: 10 }, 120, 120, 0);
    const returned = worldToScreen(view, 5, 5, out);
    expect(returned).toBe(out);
    expect(out.sx).toBe(60);
    expect(out.sy).toBe(60);
  });

  it('legt +Z nach UNTEN – kein Vorzeichenwechsel (Grundriss)', () => {
    const view = fitLevel({ x0: -10, z0: -10, x1: 10, z1: 10 }, 220, 220, 0);
    worldToScreen(view, 0, -5, out);
    const above = out.sy;
    worldToScreen(view, 0, 5, out);
    expect(out.sy).toBeGreaterThan(above);
  });

  it('bildet die Ecken der Huelle auf die Ecken des eingepassten Rechtecks ab', () => {
    const bounds = { x0: -20, z0: -15, x1: 20, z1: 15 };
    const view = fitLevel(bounds, 960, 720, VIEW_MARGIN_PX);
    worldToScreen(view, bounds.x0, bounds.z0, out);
    const x0 = out.sx;
    const z0 = out.sy;
    worldToScreen(view, bounds.x1, bounds.z1, out);
    expect(out.sx - x0).toBe((bounds.x1 - bounds.x0) * view.scale);
    expect(out.sy - z0).toBe((bounds.z1 - bounds.z0) * view.scale);
  });
});

describe('camera2d: crisp', () => {
  it('legt jeden Wert auf einen halben Pixel', () => {
    expect(crisp(10)).toBe(10.5);
    expect(crisp(10.4)).toBe(10.5);
    expect(crisp(10.6)).toBe(11.5);
    expect(crisp(-3.2)).toBe(-2.5);
    expect(crisp(0)).toBe(0.5);
  });

  it('ist idempotent bis auf die naechste halbe Stelle – zweimal angewandt springt es nicht', () => {
    // Math.round(10.5) ist 11 (kaufmaennisch aufgerundet), also 11.5: der Wert bleibt auf halben
    // Pixeln. Wichtig ist nur, dass nie ein ganzzahliger Wert herauskommt.
    for (const value of [0, 1, 2.5, -7.5, 133.49]) {
      expect(Number.isInteger(crisp(value))).toBe(false);
      expect(Number.isInteger(crisp(crisp(value)))).toBe(false);
    }
  });
});
