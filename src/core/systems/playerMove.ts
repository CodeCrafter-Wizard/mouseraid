import type { MouseBalance } from '../data/balanceTypes';
import { atan2, sqrt } from '../math/trig';
import type { Vec2 } from '../math/vec';
import type { Player, PlayerIntent, StepContext, SystemFn } from '../sim/state';
import { NO_ROOM } from '../sim/state';
import type { MoveResult } from '../world/colliderTypes';
import { MOUSE, createMoveResult } from '../world/colliderTypes';
import { moveCircle } from '../world/collision';
import type { LevelDef } from '../world/levelTypes';

/** Was die Umgebung am Tempo dreht – in M3 nur „geschwächt". */
export interface MoveModifiers { speedMul: number }

/**
 * Unterhalb dieses Tempos gilt die Figur als stehend: `facing` bleibt dann stehen, statt beim
 * Ausrollen um Rundungsreste zu zappeln (Vertrag: drehen nur bei |v| > 1e-9).
 */
const STILL_EPSILON = 1e-9;

/**
 * Kratzflächen des Moduls. `moveCircle` schreibt laut Vertrag in ein übergebenes Ergebnis und
 * bekommt den Weg als Vektor – beides wäre sonst je Spieler und Tick eine frische Allokation.
 * Alle drei werden bei JEDEM Aufruf vollständig überschrieben, bevor sie gelesen werden; der
 * Kern läuft einsträngig, damit bleibt das deterministisch.
 */
const scratchDelta: Vec2 = { x: 0, z: 0 };
const scratchMove: MoveResult = createMoveResult();
const scratchModifiers: MoveModifiers = { speedMul: 1 };

/**
 * Lautstärke als stückweise lineare Kurve über dem TEMPO, mit den drei Stützstellen der Balance
 * (Schleichen, Gehen, Sprint). Im Stand ist es still; oberhalb des Sprinttempos bleibt es beim
 * lautesten Wert, und das Ergebnis ist auf [0,1] geklemmt. Die Divisionen sind gegen Null-Spannen
 * abgesichert, damit eine entartete Balance kein NaN in den Zustand trägt.
 */
function loudnessFor(speed: number, mouse: MouseBalance): number {
  let loud: number;
  if (speed <= mouse.sneakSpeed) {
    loud = mouse.sneakSpeed > 0 ? (speed / mouse.sneakSpeed) * mouse.loudSneak : mouse.loudSneak;
  } else if (speed <= mouse.walkSpeed) {
    const span = mouse.walkSpeed - mouse.sneakSpeed;
    loud = span > 0
      ? mouse.loudSneak + ((speed - mouse.sneakSpeed) / span) * (mouse.loudWalk - mouse.loudSneak)
      : mouse.loudWalk;
  } else if (speed < mouse.sprintSpeed) {
    const span = mouse.sprintSpeed - mouse.walkSpeed;
    loud = span > 0
      ? mouse.loudWalk + ((speed - mouse.walkSpeed) / span) * (mouse.loudSprint - mouse.loudWalk)
      : mouse.loudSprint;
  } else {
    loud = mouse.loudSprint;
  }
  if (loud < 0) return 0;
  if (loud > 1) return 1;
  return loud;
}

/** Index des Raums, in dem der Punkt liegt, sonst NO_ROOM. Grenzen halboffen: [x0,x1) × [z0,z1). */
function roomAt(level: LevelDef, x: number, z: number): number {
  for (let i = 0; i < level.rooms.length; i += 1) {
    const r = level.rooms[i];
    if (r === undefined) continue;
    const b = r.bounds;
    if (x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1) return i;
  }
  return NO_ROOM;
}

/**
 * Ein Bewegungsschritt eines einzelnen Spielers – die Naht, die M9 für die Client-Vorhersage
 * erneut rechnet (Spec Zeile 65). Sie kennt WEDER Slots NOCH Räume; genau deshalb ist sie
 * exportiert und nicht im System versteckt.
 *
 * Zieltempo: die analoge Auslenkung ist das Tempo (Spec-Abweichung 7). Die Annäherung je Tick ist
 * BESCHLEUNIGUNGSBEGRENZT (R11): `dv = vZiel − v`; ist `|dv| ≤ accel`, steht das Ziel sofort, sonst
 * geht es um genau `accel` in Richtung Ziel. `accel` ist u/Tick² – eine Geschwindigkeitsänderung je
 * Tick, KEIN dimensionsloser Mischfaktor. Ohne Eingabe gilt stattdessen `v *= friction` (Faktor je
 * Tick). Danach durchgehende Bewegung über `moveCircle` (TOI + Gleiten) mit der MOUSE-Maske und dem
 * Höhenband der Maus.
 *
 * NICHT WIEDEREINTRITTSFÄHIG: die drei Kratzflächen liegen auf Modulebene, und der Kern läuft
 * einsträngig. M9 darf `stepPlayerMovement` also für die Client-Vorhersage aufrufen, aber nie
 * *innerhalb* eines laufenden `playerMove`-Durchlaufs.
 */
export function stepPlayerMovement(player: Player, intent: PlayerIntent, ctx: StepContext,
  modifiers: MoveModifiers): void {
  const mouse = ctx.balance.mouse;
  const targetSpeed = (intent.sprint
    ? mouse.sprintSpeed
    : mouse.sneakSpeed + (mouse.walkSpeed - mouse.sneakSpeed) * intent.mag) * modifiers.speedMul;
  if (intent.mag > 0) {
    // Beschleunigungsbegrenzt: `accel` ist u/Tick² – eine Geschwindigkeitsänderung je Tick, kein
    // Mischfaktor. Ist der Rest kleiner als ein Tick-Schritt, wird das Ziel EXAKT getroffen; sonst
    // geht es um genau `accel` in Richtung Ziel. |dv| über das Kern-sqrt (Math.hypot ist verboten).
    const dvx = intent.moveX * targetSpeed - player.vel.x;
    const dvz = intent.moveZ * targetSpeed - player.vel.z;
    const dv = sqrt(dvx * dvx + dvz * dvz);
    if (dv <= mouse.accel) {
      // Ziel EXAKT setzen statt `+= dv` (Minor 2, Task-5-Review): in IEEE-754 ist
      // `v + (vZiel − v)` nicht in jedem Fall bitgleich vZiel – ein möglicher 1-ULP-Grenzzyklus
      // statt eines Fixpunkts. Buchstabengetreu zum Vertrag (Plan Zeile 577: |dv| ≤ accel -> v = vZiel).
      player.vel.x = intent.moveX * targetSpeed;
      player.vel.z = intent.moveZ * targetSpeed;
    } else {
      const share = mouse.accel / dv;
      player.vel.x += dvx * share;
      player.vel.z += dvz * share;
    }
  } else {
    // Ohne Eingabe: Reibung als Faktor je Tick – dimensionsrein. `dv === 0` ist oben durch den
    // `<=`-Zweig abgedeckt, hier wird also nie durch null geteilt.
    player.vel.x *= mouse.friction;
    player.vel.z *= mouse.friction;
  }

  scratchDelta.x = player.vel.x;
  scratchDelta.z = player.vel.z;
  const moved = moveCircle(player.pos, scratchDelta, mouse.radius, mouse.yRange, MOUSE,
    ctx.colliders, scratchMove);
  player.pos.x = moved.x;
  player.pos.z = moved.z;
  // Minor 1 (Task-5-Review, Ruling U6): eine gesperrte Komponente bleibt nicht auf Zieltempo
  // stehen – sonst hält ein an die Wand gedrückter Spieler Sprinttempo UND Sprintlautstärke,
  // obwohl er sich nicht mehr bewegt. Die TANGENTIALE Komponente (Gleiten an der Wand) bleibt
  // erhalten: `moveCircle` kappt nur den Anteil, der IN die Fläche hineinzeigt (`blockedX`/`blockedZ`
  // in collision.ts), nicht die Komponente längs der Wand. Muss VOR `speed`/`facing`/`loudness`
  // stehen, damit beide die verbleibende (genullte) Geschwindigkeit widerspiegeln.
  if (moved.blockedX) player.vel.x = 0;
  if (moved.blockedZ) player.vel.z = 0;

  const speed = sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z);
  // Nur bei echtem Tempo drehen: sonst springt die Figur beim Anhalten in eine Zufallsrichtung.
  if (speed > STILL_EPSILON) player.facing = atan2(player.vel.z, player.vel.x);
  player.sprinting = intent.sprint;
  player.loudness = loudnessFor(speed, mouse);
}

/**
 * Bewegt jeden aktiven Spieler und trägt ihn anschließend in seinen Raum ein.
 *
 * `speedMul` kommt in M3 allein aus `weakened` (Spec Zeile 151: „geschwächt" ist ein
 * Tempo-Multiplikator, kein eigener Modus). Die Raum-Masken werden in JEDEM Tick neu gebaut –
 * sonst bliebe ein Bit stehen, wenn ein Spieler den Raum verlässt oder ausscheidet.
 */
export const playerMove: SystemFn = (state, ctx) => {
  for (let i = 0; i < state.rooms.length; i += 1) {
    const r = state.rooms[i];
    if (r !== undefined) r.playerMask = 0;
  }
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    if (p === undefined || !p.active) continue;
    scratchModifiers.speedMul = p.weakened ? ctx.balance.mouse.weakenedMul : 1;
    stepPlayerMovement(p, p.intent, ctx, scratchModifiers);
    p.room = roomAt(ctx.level, p.pos.x, p.pos.z);
    if (p.room === NO_ROOM) continue;
    const r = state.rooms[p.room];
    if (r !== undefined) r.playerMask |= 1 << p.slot;
  }
};
