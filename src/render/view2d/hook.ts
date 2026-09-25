/**
 * Test-Haken der Entwickler-Ansicht: `window.__mb`.
 *
 * IMPORTFREI – kein einziger Import, auch kein Typ aus dem Kern. GEMESSENER Grund (M2 und erneut
 * M4): `tsconfig.node.json` umfasst `tests/e2e`; schreibt ein Spec `import type { MbHook }`, zieht
 * das den ganzen Haken-Graphen in den Node-Typecheck. Erreicht er `src/platform/buildInfo.ts`,
 * fehlt die Vite-Konstante `__BUILD_ID__` und `npm run typecheck` bricht mit TS2552 ab; erreicht
 * er eine `.css`, mit TS2882. Repariert wird das im MODUL, nie in der tsconfig – deshalb bestehen
 * `MbStats` nur aus Zahlen. `tests/node/labHook-graph.test.ts` bewacht die Importfreiheit.
 */

export interface MbStats {
  /** `state.tick`. */
  tick: number;
  /** AKTIVE Plaetze, nicht MAX_PLAYERS. */
  players: number;
  colliders: number;
  navPoints: number;
  navEdges: number;
  /** Dauer des LETZTEN Bildes in Millisekunden; Mittel und Streuung liefert `cmd.benchDraw`. */
  drawMs: number;
}

export type MbCommand = (...args: unknown[]) => unknown;

export interface MbHook {
  /**
   * n Ticks, danach GENAU EIN Bild; liefert `state.tick`. Wirft bei nicht ganzzahligen, negativen
   * oder groesseren Werten als MAX_ADVANCE – ein vertippter Aufruf soll eine Meldung liefern,
   * nicht eine Minute rechnen.
   */
  advance(ticks: number): number;
  /** LIEST nur die Ticknummer. Ein Getter, der heimlich rechnet, ist in einem Test eine Falle. */
  tick(): number;
  /** `hashState(state)` – der Vergleichswert des Tor-Specs. */
  hash(): number;
  stats(): MbStats;
  /**
   * Befehlsregister. M4 hat GENAU DREI Befehle; der Typ bleibt `Record<string, MbCommand>`, weil
   * das Modul importfrei sein muss. Die Signaturen sind trotzdem Vertrag:
   *   benchDraw(frames: number) -> { frames, meanMs, minMs, maxMs }
   *   pixelAt(x: number, z: number) -> '#rrggbb' an einem WELT-Punkt
   *   loadFixtures(level: unknown, balance: unknown) -> void
   */
  cmd: Record<string, MbCommand>;
  /** Schreibt einen KLEBENDEN Rahmen fuer einen Platz (gilt, bis er neu gesetzt wird). */
  setInput(slot: number, mx: number, mz: number, buttons: number): void;
  /** Ohne Argument: die aktuellen Ebenen. Mit: setzen und die WIRKSAMEN liefern. */
  layers(spec?: string): string;
}

export const MAX_ADVANCE = 100000;

/**
 * Haengt den Haken als `window.__mb` ein. `view2d/main.ts` baut das Objekt (es haelt Zustand,
 * Runtime und Kontext) und ruft das hier – so bleibt dieses Modul importfrei. Der Haken wird bei
 * `?view=2d` IMMER installiert, ohne `?hook=1`: ohne ihn gaebe es keinen tick-getriebenen Pfad,
 * und die Ansicht ist reine Entwicklersache.
 */
export function installHook(hook: MbHook): void {
  (window as unknown as { __mb?: MbHook }).__mb = hook;
}
