/**
 * Zeichenweg der Entwickler-Ansicht `?view=2d` – EIN Bild, ohne zu rechnen: keine Simulation,
 * kein Zustandsschreiben, KEIN TEXT (Schriftrasterung ist der einzige echte Plattformunterschied,
 * ein Buchstabe auf der Leinwand machte jeden Farbvergleich im Tor unzuverlaessig).
 *
 * Dieses Modul steht im Haken-Waechter (`tests/node/labHook-graph.test.ts`), weil der Tor-Spec
 * `Colors` daraus importiert statt Hexwerte zu verdoppeln: es darf weder `src/platform/buildInfo.ts`
 * noch ein Stylesheet erreichen, sonst bricht `tsc -p tsconfig.node.json`.
 */
import { CAT, MOUSE } from '../../core/world/colliderTypes';
import type { Collider } from '../../core/world/colliderTypes';
import type { LevelRuntime } from '../../core/world/levelRuntime';
import type { WorldState } from '../../core/sim/state';
import { crisp, worldToScreen } from './camera2d';
import type { ScreenPoint, View2d } from './camera2d';

/**
 * Die Reihenfolge von LAYERS IST die Zeichenreihenfolge: Raumflaechen -> Kollider nach Maske ->
 * Nav-Kanten und -Punkte -> Marken -> Unter-Regal-Zonen -> Figuren.
 *
 * GEMESSENER Grund fuer `undershelf` so weit hinten: zuerst gefuellt ist die Zone nutzlos – der
 * Baldachin deckt dieselbe Grundflaeche ab und malt sie vollstaendig zu. Im ersten Prototyp-Bild
 * war damit die wichtigste Aussage der Ansicht unsichtbar. Die Figuren bleiben trotzdem darueber.
 */
export const LAYERS = ['rooms', 'colliders', 'nav', 'marks', 'undershelf', 'actors'] as const;
export type Layer = (typeof LAYERS)[number];
export type LayerMask = Readonly<Record<Layer, boolean>>;

/** Deckkraft der Unter-Regal-Zone. Danach wird `globalAlpha` IMMER wieder auf 1 gesetzt. */
export const UNDER_SHELF_ALPHA = 0.55;

export const Colors: {
  background: string; room: string; roomDiorama: string;
  wall: string; leg: string; canopy: string; plant: string; window: string; unknownMask: string;
  underShelf: string; navEdge: string; navPoint: string; loot: string; hole: string; spawn: string;
  mouse: string; mouseWeak: string; cat: string; facing: string;
} = {
  background: '#10131c',
  room: '#1e2536',
  roomDiorama: '#2b3350',
  wall: '#3c4360',
  leg: '#7a4a2e',
  canopy: '#a8642e',
  plant: '#2f6b3a',
  window: '#2a4a63',
  // Grell und in keiner anderen Zeile: eine neue Kollider-Art soll in der Ansicht AUFFALLEN.
  unknownMask: '#ff00ff',
  underShelf: '#6fd3ff',
  navEdge: '#465a80',
  navPoint: '#8fb8e8',
  loot: '#f2c14e',
  hole: '#c88a3c',
  spawn: '#8fd18a',
  mouse: '#f6ecd9',
  mouseWeak: '#c69ba0',
  cat: '#ff8f6b',
  facing: '#10131c',
};

/**
 * Feste Tafel NACH `blocks`, nicht nach Quelle: die Ansicht soll zeigen, was ein Koerper TUT.
 * Zwei Quellen mit derselben Maske sind fuer Maus und Katze dasselbe Hindernis.
 */
export const MASK_COLORS: readonly { blocks: number; color: string }[] = [
  { blocks: 15, color: Colors.wall },     // MOUSE|CAT|SIGHT|CAMERA – Wand, Theke, Vitrine
  { blocks: 5, color: Colors.leg },       // MOUSE|SIGHT             – Regalbein
  { blocks: 14, color: Colors.canopy },   // CAT|SIGHT|CAMERA        – Regal-Baldachin
  { blocks: 6, color: Colors.plant },     // CAT|SIGHT               – Topfpflanze
  { blocks: 11, color: Colors.window },   // MOUSE|CAT|CAMERA        – Schaufenster (Sicht frei)
  { blocks: 10, color: Colors.hole },     // CAT|CAMERA              – Mauseloch-Stopfen
];

export function colorForMask(blocks: number): string {
  for (let i = 0; i < MASK_COLORS.length; i += 1) {
    const entry = MASK_COLORS[i];
    if (entry !== undefined && entry.blocks === blocks) return entry.color;
  }
  return Colors.unknownMask;
}

function maskWith(value: boolean): Record<Layer, boolean> {
  return { rooms: value, colliders: value, nav: value, marks: value, undershelf: value, actors: value };
}

/**
 * `null` (kein `?layers=`) und `'all'` schalten alles an, `''` alles aus, sonst gilt eine
 * Komma-Liste. Unbekannte Namen werden still uebergangen – und weil `layerText` das ERGEBNIS
 * liefert, sieht der Aufrufer seinen Tippfehler an der fehlenden Ebene.
 */
export function parseLayers(spec: string | null): LayerMask {
  if (spec === null || spec === 'all') return maskWith(true);
  const mask = maskWith(false);
  for (const raw of spec.split(',')) {
    const name = raw.trim();
    for (const layer of LAYERS) {
      if (layer === name) mask[layer] = true;
    }
  }
  return mask;
}

/** Aktive Ebenen in LAYERS-Reihenfolge, Komma-getrennt. Leere Auswahl -> leere Zeichenkette. */
export function layerText(mask: LayerMask): string {
  const active: string[] = [];
  for (const layer of LAYERS) {
    if (mask[layer]) active.push(layer);
  }
  return active.join(',');
}

/**
 * Ist dieser Kollider die Decke einer Unter-Regal-Zone? Erkannt ALLEIN an den Masken und dem
 * Hoehenband – haelt `CAT` auf, `MOUSE` nicht, und schwebt (`y0 > 0`). Kein Extrafeld im Level.
 */
function isUnderShelf(c: Collider): boolean {
  return (c.blocks & CAT) !== 0 && (c.blocks & MOUSE) === 0 && c.y0 > 0;
}

/** Pixelmasse der Ansicht – ausdruecklich NICHT aus der Balance: sonst haenge ein Bild an einer
 *  Reglerzahl, und ein Screenshot aenderte sich beim ersten Balance-Dreh in M6. */
const MOUSE_RADIUS_PX = 5;
const CAT_RADIUS_PX = 8;
const FACING_PX = 9;
const NAV_POINT_PX = 2;
const MARK_PX = 3;

const point: ScreenPoint = { sx: 0, sy: 0 };
const point2: ScreenPoint = { sx: 0, sy: 0 };

/** Gedrehtes Rechteck aus Weltmassen. `rot === 0` spart die Drehung – der haeufigste Fall. */
function fillCollider(ctx: CanvasRenderingContext2D, view: View2d, c: Collider, color: string): void {
  worldToScreen(view, c.cx, c.cz, point);
  const hx = c.hx * view.scale;
  const hz = c.hz * view.scale;
  ctx.fillStyle = color;
  if (c.rot === 0) {
    ctx.fillRect(point.sx - hx, point.sy - hz, 2 * hx, 2 * hz);
    return;
  }
  ctx.save();
  ctx.translate(point.sx, point.sy);
  ctx.rotate(c.rot);
  ctx.fillRect(-hx, -hz, 2 * hx, 2 * hz);
  ctx.restore();
}

function fillDot(ctx: CanvasRenderingContext2D, sx: number, sy: number, radius: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Zeichnet GENAU EIN Bild in der Reihenfolge von LAYERS. Bekommt keine Balance: die Kreisgroessen
 * sind Pixelmasse der Ansicht (siehe oben).
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D, view: View2d, runtime: LevelRuntime, state: WorldState, layers: LayerMask,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = Colors.background;
  ctx.fillRect(0, 0, view.width, view.height);

  const level = runtime.level;

  if (layers.rooms) {
    for (const room of level.rooms) {
      worldToScreen(view, room.bounds.x0, room.bounds.z0, point);
      worldToScreen(view, room.bounds.x1, room.bounds.z1, point2);
      ctx.fillStyle = room.cameraMode === 'diorama' ? Colors.roomDiorama : Colors.room;
      ctx.fillRect(point.sx, point.sy, point2.sx - point.sx, point2.sy - point.sy);
    }
  }

  if (layers.colliders) {
    for (const c of runtime.colliders) fillCollider(ctx, view, c, colorForMask(c.blocks));
  }

  if (layers.nav) {
    const nav = runtime.nav;
    ctx.strokeStyle = Colors.navEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < nav.points.length; i += 1) {
      const a = nav.points[i];
      const neighbours = nav.adjacency[i];
      if (a === undefined || neighbours === undefined) continue;
      for (let k = 0; k < neighbours.length; k += 1) {
        const j = neighbours[k];
        // Jede Kante EINMAL: nur die Richtung mit aufsteigendem Index zeichnen.
        if (j === undefined || j <= i) continue;
        const b = nav.points[j];
        if (b === undefined) continue;
        worldToScreen(view, a.x, a.z, point);
        worldToScreen(view, b.x, b.z, point2);
        ctx.moveTo(crisp(point.sx), crisp(point.sy));
        ctx.lineTo(crisp(point2.sx), crisp(point2.sy));
      }
    }
    ctx.stroke();
    for (const p of nav.points) {
      worldToScreen(view, p.x, p.z, point);
      fillDot(ctx, point.sx, point.sy, NAV_POINT_PX, Colors.navPoint);
    }
  }

  if (layers.marks) {
    for (const loot of level.lootSpawns) {
      worldToScreen(view, loot.x, loot.z, point);
      fillDot(ctx, point.sx, point.sy, MARK_PX, Colors.loot);
    }
    for (const spawn of level.spawns.mice) {
      worldToScreen(view, spawn.x, spawn.z, point);
      fillDot(ctx, point.sx, point.sy, MARK_PX, Colors.spawn);
    }
    worldToScreen(view, level.mouseHole.x, level.mouseHole.z, point);
    fillDot(ctx, point.sx, point.sy, MARK_PX, Colors.hole);
  }

  if (layers.undershelf) {
    // ZULETZT vor den Figuren und mit Deckkraft: der Baldachin liegt schon da, die Zone soll
    // ihn einfaerben, nicht ersetzen.
    ctx.globalAlpha = UNDER_SHELF_ALPHA;
    for (const c of runtime.colliders) {
      if (isUnderShelf(c)) fillCollider(ctx, view, c, Colors.underShelf);
    }
    ctx.globalAlpha = 1;
  }

  if (layers.actors) {
    for (const player of state.players) {
      if (!player.active) continue;
      worldToScreen(view, player.pos.x, player.pos.z, point);
      fillDot(ctx, point.sx, point.sy, MOUSE_RADIUS_PX, player.weakened ? Colors.mouseWeak : Colors.mouse);
      ctx.strokeStyle = Colors.facing;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(point.sx, point.sy);
      ctx.lineTo(point.sx + Math.cos(player.facing) * FACING_PX, point.sy + Math.sin(player.facing) * FACING_PX);
      ctx.stroke();
    }
    worldToScreen(view, state.cat.pos.x, state.cat.pos.z, point);
    fillDot(ctx, point.sx, point.sy, CAT_RADIUS_PX, Colors.cat);
    ctx.strokeStyle = Colors.facing;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(point.sx, point.sy);
    ctx.lineTo(point.sx + Math.cos(state.cat.facing) * FACING_PX, point.sy + Math.sin(state.cat.facing) * FACING_PX);
    ctx.stroke();
  }
}
