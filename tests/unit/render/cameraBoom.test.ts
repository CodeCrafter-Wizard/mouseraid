import { describe, expect, it } from 'vitest';
import {
  BOOM_DISTANCE, BOOM_HEIGHT, BOOM_MARGIN, BOOM_MIN_DISTANCE, BOOM_POS_PER_S, BOOM_TARGET_HEIGHT,
  BOOM_YAW_PER_S, DIORAMA_HEIGHT_BASE, DIORAMA_HEIGHT_FACTOR, DIORAMA_PITCH_TAN,
  OCCLUDER_MASK_LOW_Y1, OCCLUDER_YRANGE,
  angleDelta, createBoomPose, dioramaPose, occluderGroups, smoothFactor, stepBoom,
} from '../../../src/render/cameraBoom';
import type { BoomPose } from '../../../src/render/cameraBoom';
import { ALL_MASKS, CAMERA, CAT, MOUSE, SIGHT } from '../../../src/core/world/colliderTypes';
import type { Collider } from '../../../src/core/world/colliderTypes';
import { generateColliders } from '../../../src/core/world/generateColliders';
import { CM_PER_UNIT } from '../../../src/core/world/levelTypes';
import { at, miniLevel } from '../core/testWorld';

/**
 * Der Arm des Booms, aus den EXPORTIERTEN Konstanten nachgerechnet: die Neigung steckt im Verhältnis
 * BOOM_HEIGHT : BOOM_DISTANCE, und `distance` läuft LÄNGS dieses Arms. Damit stehen in diesem Test
 * keine abgeschriebenen Zahlen – wer eine Konstante dreht, dreht die Erwartung mit.
 */
const ARM_LENGTH = Math.sqrt(BOOM_DISTANCE * BOOM_DISTANCE + BOOM_HEIGHT * BOOM_HEIGHT);
const ARM_RUN = BOOM_DISTANCE / ARM_LENGTH;
const ARM_RISE = BOOM_HEIGHT / ARM_LENGTH;

interface PropOpts { hx?: number; hz?: number; y0?: number; y1?: number; blocks?: number }

/**
 * Ein Kollider von Hand. BEWUSST lokal und nicht `collider()` aus `testWorld.ts`: dort ist
 * `occluderGroup = id + 1` fest verdrahtet, und genau diese Zuordnung ist hier der Prüfgegenstand.
 * Ungedreht (`rc = 1`, `rs = 0`), damit die Flächen EXAKT dort liegen, wo sie hingeschrieben sind.
 */
function prop(id: number, group: number, cx: number, cz: number, opts: PropOpts = {}): Collider {
  return {
    id, cx, cz,
    hx: opts.hx ?? 1, hz: opts.hz ?? 1,
    y0: opts.y0 ?? 0, y1: opts.y1 ?? 12,
    rot: 0, rc: 1, rs: 0,
    blocks: opts.blocks ?? ALL_MASKS,
    occluderGroup: group,
  };
}

/**
 * Eine Wand, deren dem Blickpunkt zugewandte Fläche GENAU `distance` Armlängen vom Ursprung entfernt
 * liegt: bei `facing = 0` schaut die Kamera nach +x, der Arm zeigt also nach -x. `cx = -2*half` und
 * `hx = half` machen `cx + hx = -half` bitgenau (`-2a + a` ist in IEEE exakt `-a`), und weil
 * `distance` hier eine Zweierpotenz ist, ist `t` im Strahl genau `distance`.
 */
function wallAhead(distance: number, blocks: number = ALL_MASKS): Collider {
  const half = distance * ARM_RUN;
  return prop(0, 1, -2 * half, 0, { hx: half, hz: 20, blocks });
}

describe('cameraBoom: createBoomPose', () => {
  it('liefert eine zu yaw = 0 konsistente Lage – Kamera hinter dem Blickpunkt bei -x', () => {
    // Task-4-Review, Minor 2: die Startpose trug frueher `z = BOOM_DISTANCE * ARM_RUN` (die Lage zu
    // yaw = -PI/2, wie `dioramaPose` sie schreibt) bei `yaw: 0` – ein Widerspruch zwischen den
    // Feldern, bis der erste `stepBoom`/`dioramaPose`-Aufruf sie ueberschreibt. `yaw = 0` liest sich
    // als Blick nach +x (`cos 0 = 1`, `sin 0 = 0`), die Kamera steht also bei -x und `z` bleibt 0.
    const pose = createBoomPose();
    expect(pose.yaw).toBe(0);
    expect(pose.x).toBeCloseTo(-BOOM_DISTANCE * ARM_RUN, 12);
    expect(pose.z).toBeCloseTo(0, 12);
    expect(pose.y).toBeCloseTo(BOOM_TARGET_HEIGHT + ARM_RISE * BOOM_DISTANCE, 12);
  });
});

describe('cameraBoom: angleDelta', () => {
  it('gibt den kurzen Weg mit Vorzeichen', () => {
    expect(angleDelta(0, 1)).toBe(1);
    expect(angleDelta(1, 0)).toBe(-1);
    expect(angleDelta(0.5, 0.5)).toBe(0);
  });

  it('geht ueber die Naht bei +-PI den KURZEN Weg', () => {
    // Von 3,0 nach -3,0 sind es aufwaerts ueber PI nur 0,283 – nicht 6,0 abwaerts.
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI, 12);
  });

  it('liefert das Ergebnis im halboffenen Bereich (-PI, PI]', () => {
    expect(angleDelta(0, Math.PI)).toBe(Math.PI);
    // -PI und +PI sind derselbe Winkel; die Wahl faellt auf +PI, damit der Bereich halboffen bleibt.
    expect(angleDelta(0, -Math.PI)).toBe(Math.PI);
  });

  it('rechnet volle Umdrehungen heraus', () => {
    expect(angleDelta(0, 4 * Math.PI)).toBe(0);
    expect(angleDelta(0, 2 * Math.PI + 0.5)).toBeCloseTo(0.5, 12);
    expect(angleDelta(0, -6 * Math.PI - 0.5)).toBeCloseTo(-0.5, 12);
  });
});

describe('cameraBoom: smoothFactor', () => {
  it('bleibt bei dtMs <= 0 und bei nicht positiver Rate auf 0', () => {
    expect(smoothFactor(BOOM_YAW_PER_S, 0)).toBe(0);
    expect(smoothFactor(BOOM_YAW_PER_S, -16)).toBe(0);
    expect(smoothFactor(BOOM_YAW_PER_S, Number.NaN)).toBe(0);
    expect(smoothFactor(0, 16)).toBe(0);
  });

  it('waechst monoton und bleibt in [0, 1]', () => {
    let last = 0;
    for (const dtMs of [1, 2, 4, 8, 16, 33, 64, 128, 256, 512, 1024]) {
      const factor = smoothFactor(BOOM_YAW_PER_S, dtMs);
      expect(factor).toBeGreaterThan(last);
      expect(factor).toBeLessThanOrEqual(1);
      last = factor;
    }
  });

  it('erreicht bei sehr grossem dtMs genau 1 und nie mehr', () => {
    expect(smoothFactor(BOOM_POS_PER_S, 1e6)).toBe(1);
  });

  it('ist zeitbasiert: zwei halbe Schritte kommen so weit wie ein ganzer', () => {
    const half = smoothFactor(BOOM_YAW_PER_S, 8);
    const full = smoothFactor(BOOM_YAW_PER_S, 16);
    // (1-a)*(1-a) = 1-b  <=>  zwei Nachziehschritte a ergeben genau den Schritt b.
    expect((1 - half) * (1 - half)).toBeCloseTo(1 - full, 12);
  });
});

describe('cameraBoom: stepBoom', () => {
  it('nimmt bei freier Sicht den vollen Abstand und setzt den Blickpunkt ueber die Maus', () => {
    const pose = stepBoom(createBoomPose(), 5, -3, 0, 16, [], true);
    expect(pose.mode).toBe('follow');
    expect(pose.distance).toBe(BOOM_DISTANCE);
    expect(pose.targetX).toBe(5);
    expect(pose.targetY).toBe(BOOM_TARGET_HEIGHT);
    expect(pose.targetZ).toBe(-3);
    expect(pose.yaw).toBe(0);
    // facing 0 = Blick nach +x, die Kamera steht also bei -x und z bleibt stehen.
    expect(pose.x).toBeCloseTo(5 - BOOM_DISTANCE * ARM_RUN, 12);
    expect(pose.y).toBeCloseTo(BOOM_TARGET_HEIGHT + BOOM_DISTANCE * ARM_RISE, 12);
    expect(pose.z).toBeCloseTo(-3, 12);
  });

  it('stellt die Kamera HINTER die Blickrichtung, gelesen als (cos, sin)', () => {
    // facing = PI/2 -> Blick nach +z (Sueden), Kamera also bei -z.
    const pose = stepBoom(createBoomPose(), 0, 0, Math.PI / 2, 16, [], true);
    expect(pose.x).toBeCloseTo(0, 12);
    expect(pose.z).toBeCloseTo(-BOOM_DISTANCE * ARM_RUN, 12);
  });

  it('klemmt an einer Wand in 4 Armlaengen auf 4 - BOOM_MARGIN', () => {
    const pose = stepBoom(createBoomPose(), 0, 0, 0, 16, [wallAhead(4)], true);
    expect(pose.distance).toBeCloseTo(4 - BOOM_MARGIN, 10);
    expect(pose.distance).toBeLessThan(BOOM_DISTANCE);
  });

  it('klemmt an einer Wand in 1 Armlaenge auf BOOM_MIN_DISTANCE, nie darunter', () => {
    const pose = stepBoom(createBoomPose(), 0, 0, 0, 16, [wallAhead(1)], true);
    expect(pose.distance).toBe(BOOM_MIN_DISTANCE);
    expect(1 - BOOM_MARGIN).toBeLessThan(BOOM_MIN_DISTANCE);
  });

  it('haelt die feste Neigung auch geklemmt: die Hoehe waechst mit dem Abstand', () => {
    const free = stepBoom(createBoomPose(), 0, 0, 0, 16, [], true);
    const freeRise = (free.y - free.targetY) / free.distance;
    const clamped = stepBoom(createBoomPose(), 0, 0, 0, 16, [wallAhead(4)], true);
    const clampedRise = (clamped.y - clamped.targetY) / clamped.distance;
    expect(clampedRise).toBeCloseTo(freeRise, 12);
    expect(freeRise).toBeCloseTo(ARM_RISE, 12);
  });

  it('ignoriert einen Kollider ohne CAMERA-Bit', () => {
    const pose = stepBoom(createBoomPose(), 0, 0, 0, 16, [wallAhead(4, CAT | SIGHT)], true);
    expect(pose.distance).toBe(BOOM_DISTANCE);
  });

  it('laesst die Pose bei dtMs = 0 unveraendert – auch bei neuem facing', () => {
    const colliders = [wallAhead(4)];
    const pose = stepBoom(createBoomPose(), 2, 2, 1, 16, colliders, true);
    const before: BoomPose = { ...pose };
    stepBoom(pose, 2, 2, -1, 0, colliders, false);
    expect(pose).toEqual(before);
  });

  it('setzt bei initial = true ohne Glaettung – auch bei dtMs = 0', () => {
    // Die Gier springt sofort auf facing …
    expect(stepBoom(createBoomPose(), 0, 0, 2, 0, [], true).yaw).toBe(2);
    // … und die Klemmung sitzt im ersten Bild, ohne einen einzigen Nachziehschritt.
    const geklemmt = stepBoom(createBoomPose(), 0, 0, 0, 0, [wallAhead(4)], true);
    expect(geklemmt.distance).toBeCloseTo(4 - BOOM_MARGIN, 10);
  });

  it('zieht ohne initial nur um smoothFactor nach', () => {
    const pose = stepBoom(createBoomPose(), 0, 0, 0, 16, [], true);
    stepBoom(pose, 0, 0, 1, 16, [], false);
    const factor = smoothFactor(BOOM_YAW_PER_S, 16);
    expect(pose.yaw).toBeCloseTo(factor, 12);
    expect(factor).toBeLessThan(0.15);
  });

  it('konvergiert monoton gegen facing und schiesst nie darueber hinaus', () => {
    const pose = stepBoom(createBoomPose(), 0, 0, 0, 16, [], true);
    let last = pose.yaw;
    for (let frame = 0; frame < 200; frame += 1) {
      stepBoom(pose, 0, 0, 1, 16, [], false);
      expect(pose.yaw).toBeGreaterThanOrEqual(last);
      expect(pose.yaw).toBeLessThanOrEqual(1);
      last = pose.yaw;
    }
    // Nach 200 Bildern von 16 ms mit Rate 6 bleibt exp(-6*3,2) = 4,6e-9 Restweg – exponentielles
    // Nachziehen kommt nie ganz an, und genau deshalb steht hier keine Gleichheit.
    expect(pose.yaw).toBeCloseTo(1, 7);
    expect(1 - pose.yaw).toBeLessThan(1e-8);
  });

  it('zieht auch die Gier ueber die Naht den kurzen Weg nach', () => {
    const pose = stepBoom(createBoomPose(), 0, 0, 3, 16, [], true);
    stepBoom(pose, 0, 0, -3, 16, [], false);
    // Der kurze Weg geht AUFWAERTS ueber PI; nach unten waere es der lange.
    expect(pose.yaw).toBeGreaterThan(3);
  });

  it('zieht den Abstand nach, wenn eine Wand in den Weg kommt', () => {
    const pose = stepBoom(createBoomPose(), 0, 0, 0, 16, [], true);
    expect(pose.distance).toBe(BOOM_DISTANCE);
    stepBoom(pose, 0, 0, 0, 16, [wallAhead(4)], false);
    const factor = smoothFactor(BOOM_POS_PER_S, 16);
    expect(pose.distance).toBeCloseTo(BOOM_DISTANCE + (4 - BOOM_MARGIN - BOOM_DISTANCE) * factor, 9);
    expect(pose.distance).toBeLessThan(BOOM_DISTANCE);
    expect(pose.distance).toBeGreaterThan(4 - BOOM_MARGIN);
  });
});

describe('cameraBoom: dioramaPose', () => {
  /** Die Maße des Baus als FESTE Testgrenzen – nicht aus `feinkost` gelesen (das Layout ist vorläufig). */
  const bau = { x0: -64, z0: -8, x1: -40, z1: 8 };
  /**
   * Die Bau-Wände des heutigen Layouts: 120 cm hoch, 10 cm dick, auf der Raumkante. Die Außenfläche
   * der Südwand liegt damit 8,5 Einheiten von der Raummitte. Die Fälle darunter prüfen daran eine
   * Aussage über die KAMERA („schaut über die Wand"), keine Position auf die Ziffer.
   */
  const bauWallTop = 12;
  const bauWallPlane = 8.5;

  it('rechnet Mitte, Diagonale, Abstand, Rueckversatz und Hoehe fuer einen Raum von 24 x 16', () => {
    const pose = dioramaPose(bau, createBoomPose());
    const diag = Math.sqrt(24 * 24 + 16 * 16);
    const distance = DIORAMA_HEIGHT_FACTOR * diag + DIORAMA_HEIGHT_BASE;
    const back = distance / Math.sqrt(1 + DIORAMA_PITCH_TAN * DIORAMA_PITCH_TAN);
    expect(diag).toBeCloseTo(Math.sqrt(832), 12);
    expect(pose.mode).toBe('diorama');
    expect(pose.distance).toBeCloseTo(distance, 12);
    expect(pose.targetX).toBe(-52);
    expect(pose.targetY).toBe(0);
    expect(pose.targetZ).toBe(0);
    expect(pose.x).toBe(-52);
    expect(pose.y).toBeCloseTo(back * DIORAMA_PITCH_TAN, 12);
    expect(pose.z).toBeCloseTo(back, 12);
    // Die Neigung ist genau der Tangens – Hoehe durch Rueckversatz.
    expect((pose.y - pose.targetY) / (pose.z - pose.targetZ)).toBeCloseTo(DIORAMA_PITCH_TAN, 12);
  });

  it('schaut UEBER die nahe Wand – unter 45 Grad waere die Pose blind', () => {
    const pose = dioramaPose(bau, createBoomPose());
    const back = pose.z - pose.targetZ;
    // Die Sichtlinie faellt linear von (back, pose.y) auf (0, 0): an der Wandebene ist sie
    // `pose.y * bauWallPlane / back` hoch, also `DIORAMA_PITCH_TAN * bauWallPlane`.
    const hoeheAnDerWand = pose.y * bauWallPlane / back;
    expect(hoeheAnDerWand).toBeCloseTo(DIORAMA_PITCH_TAN * bauWallPlane, 12);
    expect(hoeheAnDerWand).toBeGreaterThan(bauWallTop + 1);
    // Und das ist die eigentliche Aussage: mit Tangens 1 (45 Grad) laege die Sichtlinie an der
    // Wandebene UNTER der Oberkante – die Kamera saehe nur die Aussenseite der Suedwand.
    expect(1 * bauWallPlane).toBeLessThan(bauWallTop);
    expect(DIORAMA_PITCH_TAN).toBeGreaterThan(bauWallTop / bauWallPlane);
  });

  it('faellt mit Tangens 1 auf die alte 45-Grad-Form zurueck', () => {
    // Belegt die Gleichung im Modulkommentar: back = height = distance / SQRT2 bei t = 1.
    const distance = DIORAMA_HEIGHT_FACTOR * Math.sqrt(832) + DIORAMA_HEIGHT_BASE;
    expect(distance / Math.sqrt(1 + 1 * 1)).toBeCloseTo(distance / Math.SQRT2, 12);
  });

  it('steht im Sueden und schaut nach Norden – yaw = -PI/2', () => {
    const pose = dioramaPose(bau, createBoomPose());
    expect(pose.yaw).toBe(-Math.PI / 2);
    // (cos, sin) der Gier ist die BLICKRICHTUNG: (0, -1), also nach -z.
    expect(Math.cos(pose.yaw)).toBeCloseTo(0, 15);
    expect(Math.sin(pose.yaw)).toBe(-1);
    expect(pose.z).toBeGreaterThan(pose.targetZ);
  });

  it('haelt distance als echten Abstand zum Blickpunkt', () => {
    const pose = dioramaPose(bau, createBoomPose());
    const dx = pose.x - pose.targetX;
    const dy = pose.y - pose.targetY;
    const dz = pose.z - pose.targetZ;
    expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeCloseTo(pose.distance, 12);
  });

  it('haengt nur an der Diagonale, nicht an der Form', () => {
    // Ein 24 x 16 langer Raum und ein Quadrat mit derselben Diagonale (sqrt(416) je Kante)
    // bekommen denselben Abstand – die Form geht NICHT ein.
    const lang = dioramaPose({ x0: 0, z0: 0, x1: Math.sqrt(832), z1: 0 }, createBoomPose());
    const quadrat = dioramaPose({ x0: 0, z0: 0, x1: Math.sqrt(416), z1: Math.sqrt(416) }, createBoomPose());
    expect(quadrat.distance).toBeCloseTo(lang.distance, 9);
  });

  it('schreibt die uebergebene Pose und gibt genau sie zurueck', () => {
    const pose = createBoomPose();
    expect(dioramaPose(bau, pose)).toBe(pose);
  });
});

describe('cameraBoom: occluderGroups', () => {
  /** Eine Pose von Hand: Blickpunkt im Ursprung, Kamera 10 Einheiten weiter im Sueden. */
  function poseAlongZ(from: number, to: number): BoomPose {
    const pose = createBoomPose();
    pose.targetX = 0;
    pose.targetY = BOOM_TARGET_HEIGHT;
    pose.targetZ = from;
    pose.x = 0;
    pose.y = BOOM_TARGET_HEIGHT + 4;
    pose.z = to;
    return pose;
  }

  it('gibt bei leerer Kollider-Liste eine leere Menge und genau das uebergebene Array', () => {
    const out: number[] = [1, 2, 3];
    expect(occluderGroups(poseAlongZ(0, 10), [], out)).toBe(out);
    expect(out).toEqual([]);
  });

  it('nennt eine Gruppe HOECHSTENS EINMAL, auch wenn zwei ihrer Koerper im Weg stehen', () => {
    const colliders = [prop(0, 4, 0, 3), prop(1, 4, 0, 6)];
    expect(occluderGroups(poseAlongZ(0, 10), colliders, [])).toEqual([4]);
  });

  it('gibt die Gruppen AUFSTEIGEND, egal in welcher Reihenfolge sie auftreten', () => {
    const colliders = [prop(0, 7, 0, 2), prop(1, 3, 0, 4), prop(2, 5, 0, 6)];
    expect(occluderGroups(poseAlongZ(0, 10), colliders, [])).toEqual([3, 5, 7]);
  });

  it('laesst niedrige Requisiten NIE durchsichtig werden – die Grenze ist einschliesslich', () => {
    const niedrig = prop(0, 2, 0, 3, { y1: OCCLUDER_MASK_LOW_Y1 });
    const knappDrueber = prop(1, 3, 0, 5, { y1: OCCLUDER_MASK_LOW_Y1 + 0.1 });
    expect(occluderGroups(poseAlongZ(0, 10), [niedrig, knappDrueber], [])).toEqual([3]);
  });

  it('ueberspringt Kollider ohne Quellobjekt (occluderGroup 0)', () => {
    const colliders = [prop(0, 0, 0, 3), prop(1, 6, 0, 5)];
    expect(occluderGroups(poseAlongZ(0, 10), colliders, [])).toEqual([6]);
  });

  it('prueft mit der Maske CAMERA | SIGHT – Maus-Sperren allein zaehlen nicht', () => {
    const nurMaus = prop(0, 2, 0, 2, { blocks: MOUSE });
    const nurSicht = prop(1, 3, 0, 4, { blocks: SIGHT });
    const nurKamera = prop(2, 4, 0, 6, { blocks: CAMERA });
    expect(occluderGroups(poseAlongZ(0, 10), [nurMaus, nurSicht, nurKamera], [])).toEqual([3, 4]);
  });

  it('achtet auf das Hoehenband OCCLUDER_YRANGE', () => {
    const zuHoch = prop(0, 2, 0, 3, { y0: OCCLUDER_YRANGE.y1, y1: OCCLUDER_YRANGE.y1 + 5 });
    const imBand = prop(1, 3, 0, 5, { y0: 0, y1: OCCLUDER_YRANGE.y1 });
    expect(occluderGroups(poseAlongZ(0, 10), [zuHoch, imBand], [])).toEqual([3]);
  });

  it('sammelt nichts, was NEBEN der Strecke liegt', () => {
    const daneben = prop(0, 2, 5, 5);
    expect(occluderGroups(poseAlongZ(0, 10), [daneben], [])).toEqual([]);
  });

  it('beschreibt dasselbe Array bei jedem Aufruf neu', () => {
    const out: number[] = [];
    const colliders = [prop(0, 2, 0, 3)];
    expect(occluderGroups(poseAlongZ(0, 10), colliders, out)).toEqual([2]);
    expect(occluderGroups(poseAlongZ(-20, -10), colliders, out)).toEqual([]);
    expect(out.length).toBe(0);
  });

  it('findet am eingefrorenen Mini-Level die Gruppe des ersten Regals – EINMAL', () => {
    // Alles aus dem Level gerechnet: `occluderGroup` laeuft ab 1 je Quellobjekt in der
    // Vertragsreihenfolge Waende -> Regale -> Kisten -> Pflanzen -> Stopfen.
    const level = miniLevel();
    const colliders = generateColliders(level);
    const shelf = at(level.shelves, 0);
    const shelfGroup = level.walls.length + 1;
    const legHalf = shelf.legHalfCm / CM_PER_UNIT;
    // Eine Strecke laengs der Mitte des Regals: nur der Baldachin liegt darin.
    const mitte = createBoomPose();
    mitte.targetX = shelf.cx;
    mitte.targetZ = shelf.cz - shelf.hz - 3;
    mitte.x = shelf.cx;
    mitte.z = shelf.cz + shelf.hz + 3;
    expect(occluderGroups(mitte, colliders, [])).toEqual([shelfGroup]);

    // Dieselbe Strecke ueber einer Beinreihe: Baldachin UND zwei Beine, also drei Koerper einer
    // Gruppe – das Ergebnis nennt sie trotzdem nur einmal.
    const beine = createBoomPose();
    beine.targetX = shelf.cx + shelf.hx - legHalf;
    beine.targetZ = mitte.targetZ;
    beine.x = beine.targetX;
    beine.z = mitte.z;
    expect(occluderGroups(beine, colliders, [])).toEqual([shelfGroup]);
  });

  it('sieht einen KAMERA-Sperrer nach der Klemmung nicht mehr – davor steht die Kamera', () => {
    // Zusammenspiel der beiden Funktionen: `stepBoom` klemmt BOOM_MARGIN vor der Wand, die Strecke
    // Blickpunkt -> Kamera endet also davor. Ein Kamera-Sperrer wird damit nie durchsichtig – das
    // ist der Grund, warum die Okkluder-Maske SIGHT mitnimmt und nicht nur CAMERA.
    const wand = wallAhead(4);
    const pose = stepBoom(createBoomPose(), 0, 0, 0, 16, [wand], true);
    expect(pose.distance).toBeLessThan(4);
    expect(occluderGroups(pose, [wand], [])).toEqual([]);
    // Wohl aber, WAEHREND der Abstand noch nachzieht: dann steht die Kamera kurz hinter der Flaeche.
    const ziehend = stepBoom(createBoomPose(), 0, 0, 0, 16, [], true);
    stepBoom(ziehend, 0, 0, 0, 16, [wand], false);
    expect(ziehend.distance).toBeGreaterThan(4);
    expect(occluderGroups(ziehend, [wand], [])).toEqual([wand.occluderGroup]);
  });

  it('gibt am eingefrorenen Mini-Level immer eine STRENG aufsteigende Liste', () => {
    const colliders = generateColliders(miniLevel());
    const quer = createBoomPose();
    quer.targetX = -18;
    quer.targetZ = -13;
    quer.x = 18;
    quer.z = 13;
    const groups = occluderGroups(quer, colliders, []);
    expect(groups.length).toBeGreaterThan(0);
    for (let i = 1; i < groups.length; i += 1) {
      expect(at(groups, i)).toBeGreaterThan(at(groups, i - 1));
    }
  });
});
