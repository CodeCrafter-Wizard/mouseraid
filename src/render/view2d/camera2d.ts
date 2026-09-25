/**
 * Welt -> Bildschirm fuer die Entwickler-Ansicht `?view=2d`.
 *
 * Die Ansicht ist ein GRUNDRISS: +X nach rechts, +Z nach UNTEN. Kein Vorzeichenwechsel, eine
 * Fehlerquelle weniger (Plan-Kopf, Entscheidung 16). M5 macht die Eingabe kamerarelativ; diese
 * Abbildung bleibt davon unberuehrt, weil sie nichts ueber Blickrichtungen weiss.
 *
 * Kein `devicePixelRatio`: `canvas.width/height` werden fest gesetzt, die CSS-Breite skaliert.
 * Sonst haenge das Bild am Anzeigegeraet und ein Screenshot waere von Rechner zu Rechner anders.
 */
import type { LevelBounds, LevelDef } from '../../core/world/levelTypes';

export interface View2d { scale: number; offsetX: number; offsetY: number; width: number; height: number }
export interface ScreenPoint { sx: number; sy: number }

/** Randabstand in Pixeln, links/rechts und oben/unten gleich. */
export const VIEW_MARGIN_PX = 8;

/**
 * Huelle ueber ALLE Raumgrenzen – ausdruecklich nicht ueber die Kollider: eine Wand ragt um ihre
 * Halbdicke ueber den Raum hinaus und wuerde die Skala bei jedem Level anders verziehen.
 */
export function levelBounds(level: LevelDef): LevelBounds {
  let x0 = 0;
  let z0 = 0;
  let x1 = 1;
  let z1 = 1;
  let seen = false;
  for (const room of level.rooms) {
    const bounds = room.bounds;
    if (!seen) {
      x0 = bounds.x0;
      z0 = bounds.z0;
      x1 = bounds.x1;
      z1 = bounds.z1;
      seen = true;
      continue;
    }
    if (bounds.x0 < x0) x0 = bounds.x0;
    if (bounds.z0 < z0) z0 = bounds.z0;
    if (bounds.x1 > x1) x1 = bounds.x1;
    if (bounds.z1 > z1) z1 = bounds.z1;
  }
  return { x0, z0, x1, z1 };
}

/**
 * Passt das ganze Level in `width` x `height` ein.
 *
 * `scale` ist GANZZAHLIG (`Math.max(1, Math.floor(rohskala))`): eine Einheit ist damit immer
 * dieselbe Pixelzahl, und ein Screenshot zittert nicht von Rundung zu Rundung. Der Versatz
 * zentriert den Rest ueber `Math.round` und traegt `bounds.x0`/`bounds.z0` gleich mit – deshalb
 * braucht `worldToScreen` die Grenzen nicht noch einmal.
 */
export function fitLevel(bounds: LevelBounds, width: number, height: number, marginPx: number): View2d {
  const spanX = bounds.x1 - bounds.x0;
  const spanZ = bounds.z1 - bounds.z0;
  const usableX = width - 2 * marginPx;
  const usableY = height - 2 * marginPx;
  let scale = 1;
  if (spanX > 0 && spanZ > 0 && usableX > 0 && usableY > 0) {
    const raw = Math.min(usableX / spanX, usableY / spanZ);
    if (Number.isFinite(raw)) scale = Math.max(1, Math.floor(raw));
  }
  // Der Rand ist der uebrige Platz zur Haelfte – ganzzahlig, damit die Rasterlinien nicht wandern.
  const padX = Math.round((width - spanX * scale) / 2);
  const padY = Math.round((height - spanZ * scale) / 2);
  return { scale, offsetX: padX - bounds.x0 * scale, offsetY: padY - bounds.z0 * scale, width, height };
}

/**
 * Passt EINEN Raum ein – dieselbe ganzzahlige Skala wie `fitLevel`, nur mit den Grenzen eines Raums
 * statt der Huelle (R10, `?room=<id>`). Der Randabstand ist hier nicht Parameter, sondern
 * `VIEW_MARGIN_PX`: ein Raum-Ausschnitt ist eine Lesehilfe fuer die Layoutpruefung (T7), keine
 * zweite Einpass-Regel.
 */
export function fitRoom(bounds: LevelBounds, canvasW: number, canvasH: number): View2d {
  return fitLevel(bounds, canvasW, canvasH, VIEW_MARGIN_PX);
}

/**
 * Schreibt in `out` UND gibt es zurueck (wie `moveCircle` im Kern): der Aufrufer legt EINEN Punkt
 * an und reicht ihn durch, statt je Kollider ein Objekt zu erzeugen.
 */
export function worldToScreen(view: View2d, x: number, z: number, out: ScreenPoint): ScreenPoint {
  out.sx = view.offsetX + x * view.scale;
  out.sy = view.offsetY + z * view.scale;
  return out;
}

/** Jede 1-px-Linie auf halbe Pixel legen – sonst malt Canvas sie ueber zwei Pixel grau. */
export function crisp(value: number): number {
  return Math.round(value) + 0.5;
}
