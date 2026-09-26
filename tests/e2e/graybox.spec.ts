import { expect, test, type Page } from '@playwright/test';
import feinkost from '../../src/data/levels/feinkost.json' with { type: 'json' };
// `NO_ROOM` aus dem Kern statt eines Literals: der Wert steht dort (und in `sim/state.ts`), erreicht
// `buildInfo` nicht, und der Spec traegt damit keine abgeschriebene Zahl.
import { NO_ROOM } from '../../src/core/world/levelTypes';
import type { MbHook } from '../../src/modes/hook';
import { BOOM_DISTANCE, BOOM_MIN_DISTANCE, createBoomPose, dioramaPose } from '../../src/render/cameraBoom';
import { CLEAR_COLOR, GRAYBOX_COLORS } from '../../src/render/grayboxColors';

// Tor-Spec (KEIN @local, Projekt `chromium`): SwiftShader-WebGL2 rendert mit den vorhandenen
// Projekt-Flags nicht-schwarz, und ohne `finishRun` braucht der Spec keine Berechtigung. Gerechnet
// wird über Ticks (`__mb.advance`), nie über Wartezeit. Die feinkost-Vorgabe wird STRUKTURELL
// geprüft (Schwellen, Richtungen, Raumindizes aus dem importierten JSON), die Kamerapose gegen die
// REINE Funktion `dioramaPose`, die Farbe gegen die importierte Tafel – nie gegen ein Literal.
//
// KEIN Import erreicht `src/platform/buildInfo.ts` oder ein Stylesheet: `tsc -p tsconfig.node.json`
// wäre sonst rot (TS2552 bzw. TS2882). KEIN Import erreicht Babylon: Playwrights ESM-Lader löst
// Babylons erweiterungslose Deep-Imports nicht auf – deshalb kommt die Farbtafel aus dem
// Babylon-freien `src/render/grayboxColors.ts` und nicht aus `src/render/materials.ts`.

const URL_GAME = './?clock=manual';
/** Farbtoleranz je Kanal. */
const TOL = 8;
/** Kantenlänge des Rasters: 16 x 16 = 256 Proben. */
const GRID = 16;
/** Budgets aus `docs/decisions.md` (M3): 60 Zeichenaufrufe, 60 000 Dreiecke. */
const MAX_DRAW_CALLS = 60;
const MAX_TRIANGLES = 60_000;
/** Die Leinwand füllt das Fenster – das Fenster setzt also die Bildgröße des Screenshots. */
const VIEWPORT = { width: 844, height: 390 };

test.use({ viewport: VIEWPORT });

interface Pose { slot: number; x: number; z: number; facing: number; visible: boolean; room: number }
interface CameraFacts {
  mode: string; x: number; y: number; z: number;
  targetX: number; targetY: number; targetZ: number;
  yaw: number; distance: number; occluders: number;
}
interface GridFacts { samples: number; nonBlack: number; hash: number; center: [number, number, number] }

/** Eine Farbe der Tafel in Bytes. */
function to255(color: readonly [number, number, number]): [number, number, number] {
  return [Math.round(color[0] * 255), Math.round(color[1] * 255), Math.round(color[2] * 255)];
}

/**
 * Die Farbe auf ihren hellsten Kanal normiert (255 = hellster Kanal).
 *
 * WARUM nicht der absolute Wert: beide Lichter sind weiß und `specularColor` ist schwarz, also
 * skalieren sie alle drei Kanäle mit DEMSELBEN Faktor – der Faktor hängt aber an der Flächennormale
 * und an den Licht-Intensitäten. Das VERHÄLTNIS der Kanäle ist die Signatur des Materials, der
 * absolute Wert wäre bei jedem Lichtdreh eine andere Zahl. GEMESSEN in diesem Repo: die Bildmitte
 * liefert rgb(154, 145, 141), normiert (255; 240,1; 233,5) – die Maus-Tafelfarbe normiert ist
 * (255; 240; 234).
 */
function normalized(color: readonly [number, number, number]): [number, number, number] {
  const peak = Math.max(color[0], color[1], color[2]);
  if (peak <= 0) return [0, 0, 0];
  return [(color[0] * 255) / peak, (color[1] * 255) / peak, (color[2] * 255) / peak];
}

/** Größte Kanalabweichung zweier Farben. */
function channelDelta(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// Die Probenorte kommen aus feinkost.json, nie als abgeschriebene Zahl.
const spawn = feinkost.spawns.mice[0];
const burrow = feinkost.rooms.find((room) => room.cameraMode === 'diorama');
const shop = feinkost.rooms.find((room) => room.cameraMode === 'follow');
if (spawn === undefined || burrow === undefined || shop === undefined) {
  throw new Error('feinkost.json: Maus-Spawn, Diorama-Raum oder Verfolger-Raum fehlt');
}
const burrowIndex = feinkost.rooms.indexOf(burrow);
const shopIndex = feinkost.rooms.indexOf(shop);

/**
 * Wartet auf das erste Bild MIT Geometrie – ohne Wartezeit: jeder Aufruf des Prädikats zeichnet
 * über `advance(0)` genau ein Bild und lässt die Ticknummer dabei stehen.
 *
 * GEMESSEN, warum das nötig ist: Babylon holt die Shader (`default.vertex`/`default.fragment`) per
 * `import()` nach – sieben Chunks. Bis sie da sind, ist kein `StandardMaterial` bereit,
 * `drawCallsCounter.current` bleibt 0 und die Leinwand zeigt nur `CLEAR_COLOR`. Bei laufender
 * Schleife fällt das nicht auf; bei `?clock=manual` treibt der Spec die Bilder selbst.
 */
async function waitForGeometry(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const mb = (window as unknown as { __mb?: MbHook }).__mb;
    if (mb === undefined) return false;
    mb.advance(0);
    return mb.stats().drawCalls > 0;
  }, undefined, { timeout: 20_000 });
}

test('Graybox: Haken, Bewegung, Kameramodi, Pixel, Same-Origin, Offline-Reload', async ({ context, page, baseURL }) => {
  // Am Kontext, nicht an der Seite: so zählen auch die Anfragen mit, die der Service Worker selbst
  // absetzt (Precache). Verglichen wird als PRÄFIX gegen den Origin – `new URL(url).host` liefert
  // den Port mit, dieselbe Form wie in `offline-smoke.spec.ts`.
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  context.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });

  // 1. Seite mit angehaltener Uhr: ohne rAF-Schleife bleibt der Zustand auf Tick 0 stehen.
  await page.goto(URL_GAME);
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => '__mb' in window, undefined, { timeout: 20_000 });
  await waitForGeometry(page);

  const start = await page.evaluate(() => {
    const mb = (window as unknown as { __mb: MbHook }).__mb;
    return {
      stats: mb.stats(),
      pose: mb.cmd['pose']?.(0) as Pose,
      sameSetInput: mb.cmd['setInput'] === mb.setInput,
      renderWidth: document.querySelector('canvas')?.width ?? 0,
      renderHeight: document.querySelector('canvas')?.height ?? 0,
    };
  });
  expect(start.stats.tick, 'die Uhr steht bei ?clock=manual').toBe(0);
  expect(start.stats.tickRate, 'Simulationsrate').toBe(30);
  expect(start.stats.buildId, 'die Build-ID wird von src/main.ts injiziert').not.toBe('');
  // Budgets, keine gemessenen Ziffern: die exakten Zahlen gehören nach `docs/decisions.md`.
  expect(start.stats.drawCalls, 'Zeichenaufrufe').toBeGreaterThan(0);
  expect(start.stats.drawCalls, 'Zeichenaufrufe unter Budget').toBeLessThanOrEqual(MAX_DRAW_CALLS);
  expect(start.stats.triangles, 'aktive Dreiecke').toBeGreaterThan(0);
  expect(start.stats.triangles, 'aktive Dreiecke unter Budget').toBeLessThan(MAX_TRIANGLES);
  // Der Vertrag sagt: EIN Funktionsobjekt für `setInput` und `cmd.setInput`.
  expect(start.sameSetInput, 'cmd.setInput ist dasselbe Funktionsobjekt wie setInput').toBe(true);
  // Die Leinwand füllt das Fenster, und die Stufe `high` rechnet bei DPR 1 ohne Skalierung.
  expect({ w: start.renderWidth, h: start.renderHeight }, 'Puffergröße der Leinwand')
    .toEqual({ w: VIEWPORT.width, h: VIEWPORT.height });

  // 2. Platz 0 steht auf seinem Spawn, und 60 neutrale Ticks bewegen ihn nicht.
  expect({ x: start.pose.x, z: start.pose.z }, 'Platz 0 auf spawns.mice[0]').toEqual({ x: spawn.x, z: spawn.z });
  expect(start.pose.room, 'zu Tick 0 ist der Raum noch nicht aufgelöst').toBe(NO_ROOM);
  expect(start.pose.visible, 'Platz 0 ist aktiv und nicht gefangen').toBe(true);

  const neutral = await page.evaluate(() => {
    const mb = (window as unknown as { __mb: MbHook }).__mb;
    const reached = mb.advance(60);
    return {
      reached,
      read: mb.tick(),
      pose: mb.cmd['pose']?.(0) as Pose,
      camera: mb.cmd['camera']?.() as CameraFacts,
    };
  });
  expect(neutral.reached, 'advance liefert die neue Ticknummer').toBe(60);
  expect(neutral.read, 'tick() liest nur – gerechnet wird mit advance').toBe(60);
  expect({ x: neutral.pose.x, z: neutral.pose.z }, 'neutrale Eingabe bewegt nichts')
    .toEqual({ x: spawn.x, z: spawn.z });

  // 3. Platz 0 startet im BAU, also im DIORAMA – der Verfolger-Modus ist nicht die Vorgabe. Der
  //    Raum ist erst nach dem ersten Tick aufgelöst, deshalb steht diese Probe nach `advance(60)`.
  expect(neutral.pose.room, 'Platz 0 steht im Bau').toBe(burrowIndex);
  expect(neutral.camera.mode, 'der Bau trägt cameraMode diorama').toBe('diorama');
  expect(neutral.camera.occluders, 'im Diorama gibt es keine Okkluder').toBe(0);
  // Gegen die REINE Funktion, nie gegen ein Literal: zieht T7 den Rahmen nachträglich anders, bleibt
  // diese Zusicherung wahr – sie prüft die Verdrahtung, nicht die Komposition.
  // ALLE ACHT Felder der Pose, nicht fünf (Task-6-Review, Minor 2): eine Verdrahtung, die die Lage
  // richtig, den Gierwinkel aber falsch in die Kamera schreibt, blieb sonst grün – die Pixelprobe
  // läuft erst nach dem Teleport im Verfolger-Modus und kann das Diorama nicht mehr retten.
  const expectedDiorama = dioramaPose(burrow.bounds, createBoomPose());
  expect(neutral.camera.x, 'Diorama-Kamera x').toBeCloseTo(expectedDiorama.x, 6);
  expect(neutral.camera.y, 'Diorama-Kamera y').toBeCloseTo(expectedDiorama.y, 6);
  expect(neutral.camera.z, 'Diorama-Kamera z').toBeCloseTo(expectedDiorama.z, 6);
  expect(neutral.camera.targetX, 'Diorama-Blickpunkt x').toBeCloseTo(expectedDiorama.targetX, 6);
  expect(neutral.camera.targetY, 'Diorama-Blickpunkt y').toBeCloseTo(expectedDiorama.targetY, 6);
  expect(neutral.camera.targetZ, 'Diorama-Blickpunkt z').toBeCloseTo(expectedDiorama.targetZ, 6);
  expect(neutral.camera.yaw, 'Diorama-Gier').toBeCloseTo(expectedDiorama.yaw, 6);
  expect(neutral.camera.distance, 'Diorama-Abstand').toBeCloseTo(expectedDiorama.distance, 6);

  // Das Bild, das ein Spieler beim Start sieht – git-ignoriert, KEIN Golden-PNG. Es ist der einzige
  // Weg, den Diorama-Rahmen zu beurteilen; kein `expect` kann das.
  await page.locator('#game-canvas').screenshot({ path: 'test-results/graybox-diorama.png' });

  // 4. Bewegung nach Norden (−z): Platz 0 bewegt sich UND kommt nicht durch die Bau-Nordwand.
  //    Schwellen, keine Ziffern – die gemessene Ziffer gehört nach `docs/decisions.md`.
  const moved = await page.evaluate(() => {
    const mb = (window as unknown as { __mb: MbHook }).__mb;
    mb.setInput(0, 0, -112, 0);
    mb.advance(30);
    return mb.cmd['pose']?.(0) as Pose;
  });
  expect(moved.z, 'Platz 0 läuft nach Norden').toBeLessThan(spawn.z - 1);
  expect(moved.z, 'die Bau-Nordwand hält').toBeGreaterThan(burrow.bounds.z0);
  expect(moved.x, 'ohne x-Eingabe bleibt x stehen').toBeCloseTo(spawn.x, 6);

  // 5. `cmd.teleport` in den Verkaufsraum: der Verfolger-Boom übernimmt.
  const shopFacts = await page.evaluate(() => {
    const mb = (window as unknown as { __mb: MbHook }).__mb;
    mb.setInput(0, 0, 0, 0);
    const teleported = mb.cmd['teleport']?.(0, 0, 0) as { slot: number; x: number; z: number; room: number };
    mb.advance(1);
    return { teleported, pose: mb.cmd['pose']?.(0) as Pose, camera: mb.cmd['camera']?.() as CameraFacts };
  });
  expect({ x: shopFacts.teleported.x, z: shopFacts.teleported.z }, 'teleport meldet den Zielpunkt')
    .toEqual({ x: 0, z: 0 });
  expect({ x: shopFacts.pose.x, z: shopFacts.pose.z }, 'teleport schreibt pos').toEqual({ x: 0, z: 0 });
  expect(shopFacts.pose.room, 'Platz 0 steht im Verkaufsraum').toBe(shopIndex);
  expect(shopFacts.camera.mode, 'der Verkaufsraum trägt cameraMode follow').toBe('follow');
  expect(shopFacts.camera.distance, 'Boom-Abstand nicht unter der Untergrenze')
    .toBeGreaterThanOrEqual(BOOM_MIN_DISTANCE);
  expect(shopFacts.camera.distance, 'Boom-Abstand nicht über dem Sollabstand')
    .toBeLessThanOrEqual(BOOM_DISTANCE);

  // 6. Die Pixelprobe. `cmd.grid` bündelt `scene.render()` und `readPixels` in EINEM Aufruf –
  //    gemessen liefert `readPixels` aus einem eigenen `page.evaluate` rgb(0,0,0), weil ohne
  //    `preserveDrawingBuffer` der Puffer danach weg ist.
  const probe = await page.evaluate((step) =>
    (window as unknown as { __mb: MbHook }).__mb.cmd['grid']?.(step) as GridFacts, GRID);
  expect(probe.samples, 'Rasterproben').toBe(GRID * GRID);
  expect(probe.nonBlack / probe.samples, 'Anteil nicht-schwarzer Proben').toBeGreaterThan(0.9);
  // Die Bildmitte zeigt GEOMETRIE, nicht den Hintergrund …
  expect(channelDelta(probe.center, to255(CLEAR_COLOR)), `Bildmitte ${String(probe.center)} gegen den Hintergrund`)
    .toBeGreaterThan(TOL);
  // … und zwar die MAUS: der Verfolger-Boom blickt per Konstruktion auf sie (Blickpunkt =
  // Mausposition + BOOM_TARGET_HEIGHT, und das liegt INNERHALB der Kapsel). Verglichen werden die
  // auf den hellsten Kanal normierten Kanäle, nicht die absoluten Werte – siehe `normalized`.
  // Gegengeprüft gegen die Bodenfarbe: ohne die zweite Zeile wäre die Zusicherung auch mit einer
  // Toleranz grün, die jede warme Farbe annimmt (GEMESSEN: Abstand 0,53 zur Maus, 55,75 zum Boden –
  // die Toleranz 8 liegt um Faktor 15 über dem Treffer und um Faktor 7 unter dem Nachbarn).
  expect(channelDelta(normalized(probe.center), normalized(GRAYBOX_COLORS.mouse)),
    `Bildmitte ${String(probe.center)} gegen die Maus-Tafelfarbe`).toBeLessThanOrEqual(TOL);
  expect(channelDelta(normalized(probe.center), normalized(GRAYBOX_COLORS.floor)),
    `Bildmitte ${String(probe.center)} gegen die Boden-Tafelfarbe`).toBeGreaterThan(TOL);

  // 7. Screenshot des Verfolger-Bildes – ebenfalls nur für die Augen.
  await page.locator('#game-canvas').screenshot({ path: 'test-results/graybox-follow.png' });

  // 8. Alle Anfragen kamen vom eigenen Origin – online geprüft, bevor das Netz abgeschaltet wird.
  expect(foreign, 'die Spielseite darf online keine Fremd-Hosts ansprechen').toEqual([]);

  // 9. Offline: einmal geladen, danach ohne Netz startbar – und die Szene rendert wieder. Das ist das
  //    Gegenmittel gegen einen vergessenen Nebenwirkungs-Import: der wäre weder Build- noch Typfehler.
  await expect(page.getByTestId('offline-badge')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('shell-title')).toBeVisible();
  await page.waitForFunction(() => '__mb' in window, undefined, { timeout: 20_000 });
  await waitForGeometry(page);
  const offlineProbe = await page.evaluate((step) =>
    (window as unknown as { __mb: MbHook }).__mb.cmd['grid']?.(step) as GridFacts, GRID);
  expect(offlineProbe.nonBlack / offlineProbe.samples, 'Anteil nicht-schwarzer Proben ohne Netz')
    .toBeGreaterThan(0.9);
  await page.locator('#game-canvas').screenshot({ path: 'test-results/graybox-offline.png' });

  // 10. Der eingeklappte Streifen liegt ÜBER der Leinwand und bleibt bedienbar.
  await expect(page.locator('#app')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.getByTestId('shell-toggle')).toBeVisible();
  await page.getByTestId('shell-toggle').click();
  await expect(page.locator('#app')).toHaveAttribute('data-collapsed', 'false');
});

/**
 * Task-6-Review, Minor 3: `gameMain.ts` ist die EINZIGE Stelle, die F3 an `overlay.toggle()`,
 * `?tier=`/`?overlay=` an `applySearchOverrides` und den Speicher an `stats().storage` hängt. Die
 * Module dahinter sind mit Vitest gedeckt, die VERDRAHTUNG war es nur durch einen Wegwerf-Spec – fiel
 * der `keydown`-Zweig oder der `applyTier`-Aufruf aus, blieb das Tor grün.
 *
 * Tick-getrieben wie der Test oben, ohne Berechtigung, ohne neues Projekt.
 */
test('Graybox: ?tier=, ?overlay=1, der Speicher und die F3-Taste', async ({ page }) => {
  await page.goto('./?clock=manual&tier=low&overlay=1');
  await page.waitForFunction(() => '__mb' in window, undefined, { timeout: 20_000 });
  await waitForGeometry(page);

  // `?overlay=1` übersteuert den gespeicherten Wert, und das Overlay steht ohne Tastendruck da.
  const overlay = page.getByTestId('debug-overlay');
  await expect(overlay).toBeVisible();

  // `?tier=low` kommt über `applySearchOverrides` in die Engine UND in `stats()`.
  const facts = await page.evaluate(() => {
    const mb = (window as unknown as { __mb: MbHook }).__mb;
    return mb.stats();
  });
  expect(facts.tier, '?tier=low gewinnt gegen den gespeicherten Wert').toBe('low');
  // Der Speicher wird NACHTRÄGLICH geöffnet; `storage` steht im Haken, damit ein STILLER Rückfall auf
  // den Arbeitsspeicher auffällt. Geprüft wird nur, dass eine der beiden Kennungen dort steht –
  // welche, entscheidet der Browser (privater Modus, gesperrte Website-Daten).
  expect(['idb', 'memory'], `stats().storage war '${facts.storage}'`).toContain(facts.storage);
  // Der Text des Overlays trägt die Bauzeichen des Laufs – nicht die Zahlen, die sind flüchtig.
  await expect(overlay).toContainText('F3');

  // F3 schaltet aus und wieder ein. Die Taste hängt an `window`, nicht am Overlay.
  await page.keyboard.press('F3');
  await expect(overlay).toBeHidden();
  await page.keyboard.press('F3');
  await expect(overlay).toBeVisible();
});

/**
 * Abschlussreview, quality MAJOR-1: der Build-Mismatch-Hinweis hängt als `.shell-note` an `#app`, und
 * die Streifen-Regel blendete `.shell-note` im eingeklappten Zustand aus – die Spielseite startet
 * eingeklappt. `?expect=<Build-ID>` zeigte damit eine STUMME, scheinbar richtige Seite, und genau
 * darauf beruht der Handy-Loop aus CLAUDE.md. Der bestehende Fall in `offline-smoke.spec.ts:27` fiel
 * nicht: er ruft `?view=2d`, und dort wird `game-strip` nie gesetzt.
 */
test('Graybox: der ?expect=-Hinweis ist AUF DER SPIELSEITE sichtbar, auch eingeklappt', async ({ page }) => {
  await page.goto('./?clock=manual&expect=keinebuildid');
  await expect(page.getByTestId('shell-title')).toBeVisible();
  // Der Streifen ist eingeklappt – das ist die Bedingung, unter der die Meldung verschwand.
  await expect(page.locator('#app')).toHaveClass(/game-strip/);
  await expect(page.locator('#app')).toHaveAttribute('data-collapsed', 'true');
  // Der Build-Chip ist rot (`.chip[data-expect='mismatch']` in `shell.css`) …
  await expect(page.getByTestId('build-id')).toHaveAttribute('data-expect', 'mismatch');
  // … und der Hinweis dazu ist SICHTBAR, nicht nur vorhanden.
  await expect(page.getByTestId('build-mismatch')).toBeVisible();
  await expect(page.getByTestId('build-mismatch')).toContainText('keinebuildid');

  // Gegenprobe: ohne `?expect=` gibt es weder Chip-Zustand noch Hinweis.
  await page.goto(URL_GAME);
  await expect(page.getByTestId('build-id')).toHaveAttribute('data-expect', 'none');
  await expect(page.getByTestId('build-mismatch')).toHaveCount(0);
});
