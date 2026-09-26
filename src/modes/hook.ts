/**
 * Test-Haken der SPIELSEITE: `window.__mb`.
 *
 * IMPORTFREI – kein einziger Import, auch kein Typ aus dem Kern und keiner aus `src/render`.
 * GEMESSENER Grund (M2, M4 und erneut M5): `tsconfig.node.json` umfasst `tests/e2e`; schreibt ein
 * Spec `import type { MbHook }`, zieht das den ganzen Haken-Graphen in den Node-Typecheck. Erreicht
 * er `src/platform/buildInfo.ts`, fehlt die Vite-Konstante `__BUILD_ID__` und `npm run typecheck`
 * bricht mit TS2552 ab; erreicht er eine `.css`, mit TS2882. Repariert wird das im MODUL, nie in
 * der tsconfig – deshalb bestehen `MbStats` nur aus Zahlen und Zeichenketten und ist `tier` ein
 * NACKTER String statt `QualityTier`. `tests/node/labHook-graph.test.ts` bewacht die Importfreiheit.
 *
 * `?view=2d` behält seinen EIGENEN Haken (`src/render/view2d/hook.ts`) mit einem anderen `MbStats`.
 * Die beiden stehen nie zusammen auf einer Seite – `src/main.ts` entscheidet exklusiv –, und ein
 * gemeinsamer Typ wäre der Anfang eines Sammelmoduls, das der Wächter dann mitbewachen müsste.
 */

export interface MbStats {
  /** `state.tick`. */
  tick: number;
  /** Aus den EIGENEN rAF-Zeitstempeln – `engine.getFps()` meldete gemessen 60, während 132 Bilder je
   *  Sekunde fielen. */
  fps: number;
  /** Median der rAF-Abstände; 0 = nicht gemessen (auch bei `?clock=manual`). */
  panelHz: number;
  /** Letztes Bild EINSCHLIESSLICH `scene.render()`. */
  frameMs: number;
  /** p95 der Zeit VOR `scene.render()` über die letzten 120 Bilder. */
  cpuMsP95: number;
  /** 0 = kein GPU-Timer (SwiftShader hat `EXT_disjoint_timer_query_webgl2` nicht). */
  gpuMs: number;
  drawCalls: number;
  triangles: number;
  /** 30 – die feste Simulationsrate. */
  tickRate: number;
  /** Simulationsschritte im letzten Bild. */
  steps: number;
  /** NACKTER String, nicht `QualityTier` – das wäre ein Import. */
  tier: string;
  /** `'idb'` oder `'memory'` – ein stiller Rückfall soll auffallen. */
  storage: string;
  /** INJIZIERT von `src/main.ts`; dieses Modul erreicht `buildInfo` nie. */
  buildId: string;
}

export type MbCommand = (...args: unknown[]) => unknown;

export interface MbHook {
  /**
   * `ticks` Ticks, danach GENAU EIN Bild mit `alpha = 1`; liefert `state.tick`. Wirft bei nicht
   * ganzzahligen, negativen oder grösseren Werten als MAX_ADVANCE – ein vertippter Aufruf soll eine
   * Meldung liefern, nicht eine Minute rechnen.
   */
  advance(ticks: number): number;
  /** LIEST nur die Ticknummer. Ein Getter, der heimlich rechnet, ist in einem Test eine Falle. */
  tick(): number;
  /** `hashState(state)` – der Vergleichswert des Tor-Specs. */
  hash(): number;
  stats(): MbStats;
  /** Schreibt einen KLEBENDEN Rahmen für einen Platz (gilt, bis er neu gesetzt wird). */
  setInput(slot: number, mx: number, mz: number, buttons: number): void;
  /**
   * Befehlsregister. M5 hat GENAU FÜNF Befehle; der Typ bleibt `Record<string, MbCommand>`, weil
   * das Modul importfrei sein muss. Die Signaturen sind trotzdem Vertrag:
   *   pose(slot: number)   -> { slot, x, z, facing, visible, room }   aus dem ZUSTAND, nicht aus dem Mesh
   *   camera()             -> { mode, x, y, z, targetX, targetY, targetZ, yaw, distance, occluders }
   *   teleport(slot, x, z) -> { slot, x, z, room }   schreibt pos, nullt vel, SCHNAPPT die Kamera
   *   setInput(slot, mx, mz, buttons) -> void   DASSELBE Funktionsobjekt wie `setInput` oben; der
   *                          Tor-Spec darf `mb.cmd.setInput === mb.setInput` prüfen
   *   grid(step: number)   -> { samples, nonBlack, hash, center: [r, g, b] }
   */
  cmd: Record<string, MbCommand>;
}

export const MAX_ADVANCE = 100000;

/**
 * Hängt den Haken als `window.__mb` ein. Gebaut wird das Objekt in `src/render/gameMain.ts` – nur
 * dort sind Sitzung UND Grafik bekannt –, damit dieses Modul importfrei bleibt. Der Haken wird auf
 * der Spielseite IMMER installiert, ohne `?hook=1`: ohne ihn gäbe es keinen tick-getriebenen Pfad
 * für das E2E-Tor, und die Zähler darin sind reine Entwicklersache.
 */
export function installGameHook(hook: MbHook): void {
  (window as unknown as { __mb?: MbHook }).__mb = hook;
}
