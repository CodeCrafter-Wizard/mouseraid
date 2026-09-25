import type { Collider } from '../../../../src/core/world/colliderTypes';

// Gegenrechnung zum Kern: `collision.test.ts` und `collisionFuzz.test.ts` prüfen mit derselben
// Formel, ob ein Bewegter in einem Kasten steckt. Sie stand byte-gleich in beiden Dateien – genau
// die eine Stelle, an der ein Fehler BEIDE Tests gleichzeitig blind macht. Deshalb wohnt sie hier.
// Diese Datei liegt außerhalb von `src/core` und darf `Math.*` als Referenz benutzen.

/**
 * Vorzeichenbehafteter Abstand des Punktes (x, z) zum RECHTECK des Kolliders – negativ = im Kasten,
 * dann ist der Betrag die Eindringtiefe zur nächsten Fläche. Gerechnet im lokalen System des
 * Kolliders über `rc`/`rs`; das Höhenband bleibt außen vor (die Aufrufer wählen die Kollider vorher).
 */
export function distanceToBox(x: number, z: number, c: Collider): number {
  const ox = x - c.cx;
  const oz = z - c.cz;
  const lx = ox * c.rc + oz * c.rs;
  const lz = -ox * c.rs + oz * c.rc;
  const dx = Math.abs(lx) - c.hx;
  const dz = Math.abs(lz) - c.hz;
  if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
  const ex = dx > 0 ? dx : 0;
  const ez = dz > 0 ? dz : 0;
  return Math.sqrt(ex * ex + ez * ez);
}
