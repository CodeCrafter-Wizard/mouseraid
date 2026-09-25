import { describe, expect, it } from 'vitest';

import { NO_ROOM } from '../../../../src/core/sim/state';
import type { Player } from '../../../../src/core/sim/state';
import { noise } from '../../../../src/core/systems/noise';
import { playerMove, stepPlayerMovement } from '../../../../src/core/systems/playerMove';
import { CAT, MOUSE } from '../../../../src/core/world/colliderTypes';
import type { TestWorld } from '../testWorld';
import { activate, box, makeStage, makeWorld, player, room, setIntent, speedOf } from '../testWorld';

/**
 * Gemessene Schranke des eigenen `atan2` (1,36e-8 rad, Faktenblatt §1.3) mal zwei – dieselbe
 * Toleranz, mit der T1 gegen `Math.atan2` prüft.
 */
const ATAN2_TOLERANCE = 2.72e-8;

/** Offenes Feld ohne Kollider – für Beschleunigung, Reibung, Lautstärke. */
function openStage(): TestWorld {
  return makeStage([room('feld', -1000, -1000, 1000, 1000)], []);
}

/** Ticks, bis die beschleunigungsbegrenzte Annaeherung ihr Ziel EXAKT erreicht hat (+1 Puffer). */
function ticksToReach(target: number, accel: number): number { return Math.ceil(target / accel) + 1; }

/** Ticks, bis die exponentielle REIBUNG unter 1e-12 des Starttempos gefallen ist. */
function ticksToStop(friction: number): number { return Math.ceil(Math.log(1e-12) / Math.log(friction)) + 10; }

/** Bewegungsnaht n-mal aufrufen. */
function drive(w: TestWorld, p: Player, ticks: number, speedMul = 1): void {
  for (let i = 0; i < ticks; i += 1) stepPlayerMovement(p, p.intent, w.ctx, { speedMul });
}

describe('stepPlayerMovement – Beschleunigung und Reibung', () => {
  it('erreicht das Gehtempo nach genau ceil(walkSpeed/accel) Ticks und schiesst nicht darueber', () => {
    const w = openStage();
    const mouse = w.ctx.balance.mouse;
    const p = player(w.state, 0);
    setIntent(p, 1, 0, 1);
    const needed = Math.ceil(mouse.walkSpeed / mouse.accel); // Fixture: 0.2 / 0.1 = 2 Ticks

    stepPlayerMovement(p, p.intent, w.ctx, { speedMul: 1 });
    expect(p.vel.x).toBeCloseTo(Math.min(mouse.accel, mouse.walkSpeed), 15);

    let prev = speedOf(p);
    for (let i = 1; i < needed; i += 1) {
      stepPlayerMovement(p, p.intent, w.ctx, { speedMul: 1 });
      const s = speedOf(p);
      expect(s).toBeGreaterThan(prev);
      expect(s).toBeLessThanOrEqual(mouse.walkSpeed + 1e-12);
      prev = s;
    }
    expect(prev).toBeCloseTo(mouse.walkSpeed, 12);
    // Danach steht es EXAKT – genau das ist der Unterschied zur exponentiellen Annaeherung.
    stepPlayerMovement(p, p.intent, w.ctx, { speedMul: 1 });
    expect(speedOf(p)).toBeCloseTo(mouse.walkSpeed, 12);
  });

  it('erreicht das Sprinttempo nach genau ceil(sprintSpeed/accel) Ticks', () => {
    // R11 verlangt ausdruecklich, die exakte Tickzahl zu pinnen – Fixture: 0.4 / 0.1 = 4 Ticks.
    const w = openStage();
    const mouse = w.ctx.balance.mouse;
    const p = player(w.state, 0);
    setIntent(p, 1, 0, 1, true);
    const needed = Math.ceil(mouse.sprintSpeed / mouse.accel);

    for (let i = 0; i < needed - 1; i += 1) stepPlayerMovement(p, p.intent, w.ctx, { speedMul: 1 });
    expect(speedOf(p)).toBeLessThan(mouse.sprintSpeed);

    stepPlayerMovement(p, p.intent, w.ctx, { speedMul: 1 });
    expect(speedOf(p)).toBeCloseTo(mouse.sprintSpeed, 12);
    stepPlayerMovement(p, p.intent, w.ctx, { speedMul: 1 });
    expect(speedOf(p)).toBeCloseTo(mouse.sprintSpeed, 12);
  });

  it('mischt zwischen Schleich- und Gehtempo linear über den Betrag', () => {
    const w = openStage();
    const mouse = w.ctx.balance.mouse;
    const p = player(w.state, 0);
    setIntent(p, 1, 0, 0.5);
    drive(w, p, ticksToReach(mouse.walkSpeed, mouse.accel));
    expect(speedOf(p)).toBeCloseTo(mouse.sneakSpeed + (mouse.walkSpeed - mouse.sneakSpeed) * 0.5, 10);
  });

  it('bremst ohne Eingabe je Tick genau mit frictionPerTick und kommt zum Stehen', () => {
    const w = openStage();
    const mouse = w.ctx.balance.mouse;
    const p = player(w.state, 0);
    setIntent(p, 1, 0, 1);
    drive(w, p, ticksToReach(mouse.walkSpeed, mouse.accel));

    setIntent(p, 0, 0, 0);
    const before = speedOf(p);
    stepPlayerMovement(p, p.intent, w.ctx, { speedMul: 1 });
    expect(speedOf(p)).toBeCloseTo(before * mouse.friction, 12);

    drive(w, p, ticksToStop(mouse.friction));
    expect(speedOf(p)).toBeLessThan(1e-9);
    const rest = { x: p.pos.x, z: p.pos.z };
    drive(w, p, 30);
    expect(p.pos.x - rest.x).toBeLessThan(1e-7);
  });

  it('ist im Sprint schneller als beim Gehen', () => {
    const w = openStage();
    const mouse = w.ctx.balance.mouse;
    const walker = player(w.state, 0);
    setIntent(walker, 1, 0, 1);
    drive(w, walker, 60);

    const s = openStage();
    const sprinter = player(s.state, 0);
    setIntent(sprinter, 1, 0, 1, true);
    drive(s, sprinter, 60);

    expect(sprinter.pos.x).toBeGreaterThan(walker.pos.x);
    drive(s, sprinter, ticksToReach(mouse.sprintSpeed, mouse.accel));
    expect(speedOf(sprinter)).toBeCloseTo(mouse.sprintSpeed, 10);
    expect(mouse.sprintSpeed).toBeGreaterThan(mouse.walkSpeed);
  });

  it('bremst einen geschwächten Spieler mit weakenedMul', () => {
    const w = openStage();
    const mouse = w.ctx.balance.mouse;
    const p = player(w.state, 0);
    setIntent(p, 1, 0, 1);
    drive(w, p, ticksToReach(mouse.walkSpeed * mouse.weakenedMul, mouse.accel), mouse.weakenedMul);
    expect(speedOf(p)).toBeCloseTo(mouse.walkSpeed * mouse.weakenedMul, 10);
    expect(mouse.weakenedMul).toBeLessThan(1);
  });

  it('holt speedMul im SYSTEM aus dem weakened-Flag', () => {
    const w = openStage();
    const mouse = w.ctx.balance.mouse;
    const p = player(w.state, 0);
    p.weakened = true;
    setIntent(p, 1, 0, 1);
    const n = ticksToReach(mouse.walkSpeed * mouse.weakenedMul, mouse.accel);
    for (let i = 0; i < n; i += 1) playerMove(w.state, w.ctx, [], w.events);
    expect(speedOf(p)).toBeCloseTo(mouse.walkSpeed * mouse.weakenedMul, 10);
  });
});

describe('stepPlayerMovement – Kollision und Blickrichtung', () => {
  /**
   * Mini-Level, ein Spieler in der freien Ecke nahe der Ostwand, danach `ticks` Ticks Druck in
   * die gegebene Richtung. Der Startpunkt kommt aus den RAUMGRENZEN, nicht aus festen Zahlen –
   * liegt dort im Mini-Level einmal ein Regal, wird der Versatz angepasst, nicht der Test.
   */
  function pressInMiniLevel(mx: number, mz: number, ticks: number): { p: Player; x1: number; z0: number } {
    const w = makeWorld();
    activate(w.state, 1);
    const bounds = w.ctx.level.rooms[0]?.bounds;
    if (bounds === undefined) throw new Error('Mini-Level ohne Raum');
    const p = player(w.state, 0);
    p.pos.x = bounds.x1 - 5;
    p.pos.z = bounds.z0 + 5;
    setIntent(p, mx, mz, 1);
    drive(w, p, ticks);
    return { p, x1: bounds.x1, z0: bounds.z0 };
  }

  it('gleitet an der Außenwand entlang, statt an ihr zu kleben oder durch sie zu laufen', () => {
    const straight = pressInMiniLevel(1, 0, 60);
    const diagonal = pressInMiniLevel(Math.SQRT1_2, Math.SQRT1_2, 60);

    // Geradeaus: bis an die Wand und dort stehen bleiben, ohne sie zu durchdringen.
    expect(straight.p.pos.x).toBeGreaterThan(straight.x1 - 5);
    expect(straight.p.pos.x).toBeLessThan(straight.x1);
    expect(straight.p.pos.z).toBeCloseTo(straight.z0 + 5, 12);
    // Schräg: dieselbe Wandgrenze in x, aber weit an ihr entlang in z.
    expect(diagonal.p.pos.x).toBeCloseTo(straight.p.pos.x, 6);
    expect(diagonal.p.pos.z - (diagonal.z0 + 5)).toBeGreaterThan(8);
    // Minor 1 (Task-5-Review): die BLOCKIERTE Komponente (x, gegen die Wand) steht am Ende auf 0 –
    // ein an die Wand gedrückter Spieler hält kein Sprinttempo mehr. Die TANGENTIALE Komponente
    // (z, das Gleiten an der Wand entlang) bleibt dagegen ungebremst erhalten.
    expect(diagonal.p.vel.x).toBe(0);
    expect(diagonal.p.vel.z).toBeGreaterThan(0);
  });

  it('setzt facing aus der Geschwindigkeit – dieselbe Zahl wie Math.atan2', () => {
    const w = openStage();
    const p = player(w.state, 0);
    setIntent(p, 0.6, -0.8, 1);
    drive(w, p, 20);
    expect(Math.abs(p.facing - Math.atan2(p.vel.z, p.vel.x))).toBeLessThan(ATAN2_TOLERANCE);
  });

  it('lässt facing beim Anhalten stehen – die Figur springt nicht nach vorn', () => {
    const w = openStage();
    const p = player(w.state, 0);
    p.facing = 1.25;
    p.vel.x = 0;
    p.vel.z = 0;
    setIntent(p, 0, 0, 0);
    drive(w, p, 5);
    expect(p.facing).toBe(1.25);
  });
});

describe('playerMove – Wandkontakt bremst (Minor 1, Task-5-Review)', () => {
  /**
   * VOR dem Fix blieb `vel` auf Zieltempo stehen, obwohl `moveCircle` die Bewegung an der Wand
   * auf 0 gekürzt hatte (`blockedX`/`blockedZ` wurden nie gelesen) – ein an die Wand gedrückter
   * Sprinter blieb dadurch eine Dauerschallquelle auf Sprintlautstärke (gemessen: 40 Proben /
   * 38 Ereignisse über 40 Ticks, obwohl der Spieler längst stand). Dieser Test treibt
   * `playerMove` UND `noise` denselben Weg wie `step()` (playerMove vor noise, Spec Zeile 109)
   * gegen die Ostwand des Mini-Levels.
   */
  it('zerrt vel und loudness an der Wand auf 0 – danach kein Dauerlärm mehr', () => {
    const w = makeWorld();
    activate(w.state, 1);
    const bounds = w.ctx.level.rooms[0]?.bounds;
    if (bounds === undefined) throw new Error('Mini-Level ohne Raum');
    const p = player(w.state, 0);
    p.pos.x = bounds.x1 - 5;
    p.pos.z = bounds.z0 + 5;
    setIntent(p, 1, 0, 1, true); // Sprint direkt auf die Ostwand zu, geradeaus (kein Gleiten)

    // Erste 35 Ticks: Anlauf + Aufprall. Ein Teil davon bewegt sich wirklich – hier entstehen
    // echte Proben, das ist KEIN Fehlverhalten und wird unten gegengeprüft.
    for (let i = 0; i < 35; i += 1) {
      playerMove(w.state, w.ctx, [], w.events);
      noise(w.state, w.ctx, [], w.events);
      w.state.tick += 1;
    }
    expect(p.vel.x).toBe(0);
    // loudnessFor(0, ...) ist der Wert für |v| = 0 – die Figur steht, also gilt der leiseste Fall.
    expect(p.loudness).toBe(0);

    const samplesAtWall = w.state.noiseCount;
    const eventsAtWall = w.events.length;
    expect(samplesAtWall).toBeGreaterThan(0); // die ersten Ticks WAREN Bewegung – sonst wäre der Test leer

    // Weitere 5 Ticks am Anschlag: sobald die Wand erreicht ist, darf `noise` weder eine neue
    // Probe noch ein Ereignis erzeugen.
    for (let i = 0; i < 5; i += 1) {
      playerMove(w.state, w.ctx, [], w.events);
      noise(w.state, w.ctx, [], w.events);
      w.state.tick += 1;
    }
    expect(w.state.noiseCount).toBe(samplesAtWall);
    expect(w.events.length).toBe(eventsAtWall);
  });
});

describe('stepPlayerMovement – Maske und Höhenband (Minor 3, Task-5-Review)', () => {
  /**
   * Der einzige bisherige Kollisionstest drückt gegen die Mini-Level-Außenwand
   * (`blocks = MOUSE|CAT|SIGHT|CAMERA`, 200 cm hoch) – ein vertauschtes Argument
   * (`CAT` statt `MOUSE`, oder `balance.cat.yRange` statt `mouse.yRange`) ließe alle diese
   * Fälle unbemerkt grün. Drei gezielte Fälle statt der Mini-Level-Wand:
   */
  const feld = room('feld', -1000, -1000, 1000, 1000);

  it('läuft durch einen Kollider, der nur CAT blockiert – die MOUSE-Maske greift nicht', () => {
    const catOnly = box(1, 5, 0, 1, 1, CAT);
    const w = makeStage([feld], [catOnly]);
    const p = player(w.state, 0);
    setIntent(p, 1, 0, 1, true);
    drive(w, p, 200);
    expect(p.pos.x).toBeGreaterThan(catOnly.cx + catOnly.hx);
  });

  it('läuft unter einem Kollider durch, dessen Höhenband über mouse.yRange liegt (Baldachin)', () => {
    const canopy = box(2, 5, 0, 1, 1, MOUSE, 2);
    // Baldachin von y=1 bis y=2: liegt vollständig ÜBER dem Maus-Höhenband (0…mouse.height,
    // hier 0.8) – nach `affects()` (collision.ts) überlappen sich die beiden Bänder dann nicht.
    canopy.y0 = 1;
    const w = makeStage([feld], [canopy]);
    const p = player(w.state, 0);
    expect(w.ctx.balance.mouse.yRange.y1).toBeLessThan(canopy.y0);
    setIntent(p, 1, 0, 1, true);
    drive(w, p, 200);
    expect(p.pos.x).toBeGreaterThan(canopy.cx + canopy.hx);
  });

  it('stoppt an einem Kollider, der MOUSE im Höhenband der Maus blockiert', () => {
    const wall = box(3, 5, 0, 1, 1, MOUSE);
    const w = makeStage([feld], [wall]);
    const p = player(w.state, 0);
    setIntent(p, 1, 0, 1, true);
    drive(w, p, 200);
    const mouse = w.ctx.balance.mouse;
    expect(p.pos.x).toBeLessThan(wall.cx - wall.hx);
    expect(p.pos.x).toBeCloseTo(wall.cx - wall.hx - mouse.radius, 2);
  });
});

describe('stepPlayerMovement – Lautstärke', () => {
  const balance = openStage().ctx.balance;

  /** Spieler nach vollständiger Annäherung an sein Endtempo. */
  function settle(mag: number, sprint: boolean, speedMul = 1): Player {
    const w = openStage();
    const p = player(w.state, 0);
    setIntent(p, 1, 0, mag, sprint);
    // Die groesste Schranke deckt jedes kleinere Ziel mit ab: ist das Ziel erreicht, bleibt es stehen.
    drive(w, p, ticksToReach(w.ctx.balance.mouse.sprintSpeed, w.ctx.balance.mouse.accel), speedMul);
    return p;
  }

  it('wächst streng monoton mit dem Tempo und bleibt in [0,1]', () => {
    const louds = [settle(0.2, false), settle(0.5, false), settle(1, false), settle(1, true)]
      .map((p) => p.loudness);
    for (let i = 1; i < louds.length; i += 1) {
      expect(louds[i]).toBeGreaterThan(louds[i - 1] as number);
    }
    for (const l of louds) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
    }
  });

  it('trifft die Stützstellen der Balance bei Geh- und Sprinttempo', () => {
    expect(settle(1, false).loudness).toBeCloseTo(balance.mouse.loudWalk, 9);
    expect(settle(1, true).loudness).toBeCloseTo(balance.mouse.loudSprint, 9);
  });

  it('ist im Stand still', () => {
    const w = openStage();
    const p = player(w.state, 0);
    setIntent(p, 0, 0, 0);
    drive(w, p, 5);
    expect(p.loudness).toBe(0);
  });

  it('macht einen geschwächten Spieler leiser, weil er langsamer ist', () => {
    expect(settle(1, false, balance.mouse.weakenedMul).loudness)
      .toBeLessThan(settle(1, false).loudness);
  });
});

describe('playerMove – Raumzuordnung', () => {
  /** Zwei angrenzende Räume; Grenze bei x = 10. */
  function twoRooms(): TestWorld {
    const w = makeStage([room('links', 0, 0, 10, 10), room('rechts', 10, 0, 20, 10)], []);
    activate(w.state, 2);
    return w;
  }

  it('trägt jeden aktiven Spieler in seinen Raum und in die Raum-Maske ein', () => {
    const w = twoRooms();
    const a = player(w.state, 0);
    const b = player(w.state, 1);
    a.pos.x = 5; a.pos.z = 5;
    b.pos.x = 15; b.pos.z = 5;
    playerMove(w.state, w.ctx, [], w.events);
    expect(a.room).toBe(0);
    expect(b.room).toBe(1);
    expect(w.state.rooms[0]?.playerMask).toBe(1);
    expect(w.state.rooms[1]?.playerMask).toBe(2);
  });

  it('hält die Grenze halboffen – x = x1 gehört schon zum nächsten Raum', () => {
    const w = twoRooms();
    const a = player(w.state, 0);
    a.pos.x = 10; a.pos.z = 5;
    playerMove(w.state, w.ctx, [], w.events);
    expect(a.room).toBe(1);
  });

  it('meldet außerhalb jedes Raums NO_ROOM und räumt die Maske wieder ab', () => {
    const w = twoRooms();
    const a = player(w.state, 0);
    const b = player(w.state, 1);
    a.pos.x = 5; a.pos.z = 5;
    b.pos.x = 15; b.pos.z = 5;
    playerMove(w.state, w.ctx, [], w.events);
    expect(w.state.rooms[0]?.playerMask).toBe(1);

    a.pos.x = 500;
    playerMove(w.state, w.ctx, [], w.events);
    expect(a.room).toBe(NO_ROOM);
    expect(w.state.rooms[0]?.playerMask).toBe(0);
    expect(w.state.rooms[1]?.playerMask).toBe(2);
  });

  it('nimmt inaktive Plätze nicht in die Maske auf', () => {
    const w = twoRooms();
    const a = player(w.state, 0);
    const b = player(w.state, 1);
    a.pos.x = 5; a.pos.z = 5;
    b.pos.x = 6; b.pos.z = 5;
    b.active = false;
    playerMove(w.state, w.ctx, [], w.events);
    expect(w.state.rooms[0]?.playerMask).toBe(1);
  });

  it('erzeugt keine Ereignisse', () => {
    const w = twoRooms();
    playerMove(w.state, w.ctx, [], w.events);
    expect(w.events).toHaveLength(0);
  });
});

describe('stepPlayerMovement – Naht für die Client-Vorhersage (M9)', () => {
  /** Ein festes Skript aus Richtungswechseln, damit zwei Läufe wirklich vergleichbar sind. */
  function scriptedRun(): { x: number; z: number; vx: number; vz: number; facing: number; loudness: number } {
    const w = makeWorld();
    activate(w.state, 1);
    const p = player(w.state, 0);
    for (let t = 0; t < 300; t += 1) {
      const phase = t % 60;
      if (phase < 20) setIntent(p, 1, 0, 1, true);
      else if (phase < 40) setIntent(p, 0, 1, 0.5);
      else setIntent(p, -0.6, 0.8, 0.9);
      stepPlayerMovement(p, p.intent, w.ctx, { speedMul: p.weakened ? 0.5 : 1 });
    }
    return { x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z, facing: p.facing, loudness: p.loudness };
  }

  it('liefert bei zwei gleichen Läufen exakt dieselbe Lage', () => {
    expect(scriptedRun()).toEqual(scriptedRun());
  });

  it('lässt den injizierten Kontext unberührt', () => {
    const w = makeWorld();
    activate(w.state, 1);
    const p = player(w.state, 0);
    const before = JSON.stringify(w.ctx);
    setIntent(p, 0.5, 0.5, 1, true);
    drive(w, p, 300);
    expect(JSON.stringify(w.ctx)).toBe(before);
  });
});
