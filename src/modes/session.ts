/**
 * Die Naht, an der eine Partie hängt – NUR Typen und eine Konstante.
 *
 * `src/modes` orchestriert Kern und Eingabe, kennt aber weder `src/render` noch Babylon (ESLint
 * erzwingt es): die Grafik kommt als Rückruf `render(alpha)` herein. Genau deshalb ist eine Sitzung
 * in Vitest im Node-Umfeld ohne DOM prüfbar.
 *
 * `host` und `client` kommen mit M9 und sollen DIESELBE Naht bedienen; M5 füllt nur `solo`. Der
 * Haken `window.__mb` gehört bewusst NICHT zum Rückgabewert: `MbStats` trägt Babylon-Zähler, die
 * Panel-Rate, die Qualitätsstufe und die injizierte Build-ID – eine Sitzung, die ihn baut, zöge all
 * das in diese Schicht. Er entsteht in `src/render/gameMain.ts`.
 */
import type { GameEvent } from '../core/sim/events';
import type { WorldState } from '../core/sim/state';
import type { RenderView } from '../core/sim/views';
import type { LevelRuntime } from '../core/world/levelRuntime';
import type { FixedLoop } from './fixedLoop';

export type SessionKind = 'solo' | 'host' | 'client';

/**
 * Deckel des Ereignispuffers. In M5 liest ihn niemand (Audio kommt mit M11, das HUD mit M12) – ohne
 * Deckel legte ein `advance(100000)` im E2E-Tor hunderttausend Objekte an, die keiner abholt.
 */
export const EVENT_BUFFER_MAX = 256;

export interface GameSession {
  readonly kind: SessionKind;
  readonly runtime: LevelRuntime;
  /** DASSELBE Objekt in jedem Bild – `prev`/`curr` werden getauscht, nie neu angelegt. */
  readonly view: RenderView;
  /** Wird bei JEDEM `advance()` zuerst geleert – auch bei `advance(0)`; Überschuss über
   *  EVENT_BUFFER_MAX fällt weg. */
  readonly events: GameEvent[];
  /** Verworfene Ereignisse, LAUFENDE Summe – Diagnose, kein Spielzustand. */
  droppedEvents(): number;
  /** Nur lesen – wer hier schreibt, umgeht den Hash. */
  state(): Readonly<WorldState>;
  /** `ticks` Ticks, danach EIN Bild mit `alpha = 1`; liefert `state.tick`. Wirft bei nicht
   *  ganzzahligen, negativen oder zu grossen Werten. */
  advance(ticks: number): number;
  tick(): number;
  hash(): number;
  setInput(slot: number, mx: number, mz: number, buttons: number): void;
  /** Durchreiche an `Keyboard`; die DOM-Ereignisse verdrahtet `gameMain`. */
  keyDown(code: string): boolean;
  keyUp(code: string): boolean;
  /** `keyboard.reset()` PLUS alle klebenden Rahmen auf neutral. */
  resetInput(): void;
  teleport(slot: number, x: number, z: number): void;
  /** NO_ROOM (−1), solange kein Tick gelaufen ist – `playerMove` löst den Raum je Tick auf. */
  roomOf(slot: number): number;
}

export interface SoloSession extends GameSession { readonly kind: 'solo'; readonly loop: FixedLoop }
