import { expect, test, type Page } from '@playwright/test';
import feinkost from '../../src/data/levels/feinkost.json' with { type: 'json' };
import { Colors, UNDER_SHELF_ALPHA } from '../../src/render/view2d/draw';
import type { MbHook } from '../../src/render/view2d/hook';
import golden from '../fixtures/core/golden.json' with { type: 'json' };
import miniLevel from '../fixtures/core/mini-level.json' with { type: 'json' };
import testBalance from '../fixtures/core/test-balance.json' with { type: 'json' };

// Tor-Spec (KEIN @local, Projekt `chromium`): Canvas 2D braucht weder GPU noch Berechtigung noch
// eine echte Netzschnittstelle. Gerechnet wird über Ticks (`__mb.advance`), nie über Wartezeit.
// Die feinkost-Vorgabe wird STRUKTURELL geprüft (Schwellen aus `stats()`, Farbproben in der
// Flächenmitte), der Zustandshash gegen den EINGEFRORENEN Golden-Fall, den `cmd.loadFixtures` in
// die Seite injiziert – so hängt das Tor an keiner provisorischen Balance-Zahl.

const URL_2D = './?view=2d&clock=manual';
/** Farbtoleranz je Kanal (R3): die Rasterung eines fremden Runners darf das Tor nicht umwerfen. */
const TOL = 2;

/** '#rrggbb' -> [r, g, b]. */
function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Größte Kanalabweichung zweier Farben. */
function channelDelta(a: string, b: string): number {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
}

/**
 * `source-over` mit `globalAlpha`: `alpha * Quelle + (1 - alpha) * Ziel`, je Kanal gerundet. Damit
 * steht die erwartete Mischfarbe der Unter-Regal-Zone HERGELEITET im Spec – aus `Colors` und
 * `UNDER_SHELF_ALPHA` – statt als Hex-Literal, das mit der Farbtafel auseinanderliefe.
 */
function blend(source: string, target: string, alpha: number): string {
  const src = rgb(source);
  const dst = rgb(target);
  const mixed = src.map((channel, i) => Math.round(alpha * channel + (1 - alpha) * (dst[i] ?? 0)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

// Die Probenorte kommen aus feinkost.json, nicht aus abgeschriebenen Zahlen: so fällt eine
// Layout-Änderung hier auf, statt still eine Kante statt einer Fläche zu treffen.
const counter = feinkost.boxes.find((box) => box.kind === 'counter');
const plant = feinkost.plants[0];
const shelf = feinkost.shelves[1];
const goldenCase = golden.cases.find((entry) => entry.name === 'mini-neutral-300');
if (counter === undefined || plant === undefined || shelf === undefined) {
  throw new Error('feinkost.json: Theke, Pflanze oder Regal fehlt – die Farbproben haben keinen Ort');
}
if (goldenCase === undefined) throw new Error('golden.json: Fall mini-neutral-300 fehlt');

/**
 * Die Regalprobe sitzt NICHT in der Regalmitte: dort liegt in `feinkost` immer ein Beuteplatz
 * (`loot-regal-mitte`), und die Marken werden VOR der Zone gezeichnet – gemessen liest die Probe
 * dann `Zone über Beuteplatz` statt `Zone über Baldachin`. Genommen wird deshalb die Mitte der
 * östlichen Baldachinhälfte: markenfrei (nachgemessen: kein Beuteplatz, kein Wegpunkt, kein Spawn
 * innerhalb von 2 Einheiten) und weiterhin FLÄCHENMITTE im Sinne von R3 – bei Skala 9 sind es
 * 18 px zur nächsten Baldachinkante.
 */
const shelfProbeX = shelf.cx + shelf.hx / 2;

/**
 * Anteil der Nicht-Hintergrund-Pixel und ein FNV-1a über die RGB-Bytes – beides IN der Seite
 * gerechnet, nach außen geht nur je eine Zahl. Ein absoluter Pixelwert wäre plattformabhängig,
 * die GLEICHHEIT zweier Aufrufe derselben Sitzung ist es nicht.
 */
async function canvasFacts(page: Page): Promise<{ hash: number; nonBgPct: number }> {
  return page.evaluate((background: string) => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) throw new Error('canvas fehlt');
    // Ein zweiter getContext('2d') liefert denselben Kontext – die Attribute des ersten gelten weiter.
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2d-Kontext fehlt');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const br = Number.parseInt(background.slice(1, 3), 16);
    const bg = Number.parseInt(background.slice(3, 5), 16);
    const bb = Number.parseInt(background.slice(5, 7), 16);
    let hash = 0x811c9dc5;
    let other = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      hash = Math.imul(hash ^ r, 0x01000193);
      hash = Math.imul(hash ^ g, 0x01000193);
      hash = Math.imul(hash ^ b, 0x01000193);
      if (r !== br || g !== bg || b !== bb) other += 1;
    }
    return { hash: hash >>> 0, nonBgPct: (other * 400) / data.length };
  }, Colors.background);
}

test('2D-Ansicht: Struktur, Farben und Zustandshash gegen den Golden-Fall', async ({ page }) => {
  // 1. Seite mit angehaltener Uhr: ohne rAF-Schleife bleibt der Zustand auf Tick 0 stehen.
  await page.goto(URL_2D);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => '__mb' in window, undefined, { timeout: 10_000 });

  const stats = await page.evaluate(() => (window as unknown as { __mb: MbHook }).__mb.stats());
  expect(stats.tick, 'die Uhr steht bei ?clock=manual').toBe(0);
  expect(stats.players, 'aktive Plätze').toBeGreaterThan(0);
  // Schwellen, keine exakten Zahlen: die pinnt Vitest, wo eine Layout-Änderung eine Zeile kostet.
  // RETTUNGSANWEISUNG, falls eine Zahl darunter fällt: dann ist das LEVEL zu dünn – `feinkost.json`
  // nachbessern (Wegpunkte in jede Gasse, siehe docs/decisions.md „Layout-Prüfung"). Die Schwelle
  // wird NIE gesenkt; sie ist die billigste und damit gefährlichste Reparatur eines roten Tors.
  expect(stats.colliders, 'Kollider aus feinkost.json').toBeGreaterThanOrEqual(30);
  expect(stats.navPoints, 'Wegpunkte aus feinkost.json').toBeGreaterThanOrEqual(40);
  expect(stats.navEdges, 'Nav-Kanten aus feinkost.json').toBeGreaterThanOrEqual(60);

  // 2. Die Leinwand ist nicht leer – und ihr Bild bekommt eine Zahl, die Schritt 6 wiederholt.
  const first = await canvasFacts(page);
  expect(first.nonBgPct, 'Anteil Nicht-Hintergrund-Pixel in Prozent').toBeGreaterThan(20);

  // 3. Farbproben in der MITTE gefüllter Flächen (nie an einer Kante), Toleranz +-2 je Kanal.
  const probes = await page.evaluate((points) => {
    const mb = (window as unknown as { __mb: MbHook }).__mb;
    const at = (x: number, z: number): string => String(mb.cmd['pixelAt']?.(x, z));
    return {
      wall: at(points.wall[0], points.wall[1]),
      plant: at(points.plant[0], points.plant[1]),
      shelf: at(points.shelf[0], points.shelf[1]),
    };
  }, {
    wall: [counter.cx, counter.cz] as [number, number],
    plant: [plant.x, plant.z] as [number, number],
    shelf: [shelfProbeX, shelf.cz] as [number, number],
  });

  expect(channelDelta(probes.wall, Colors.wall), `Theke ${probes.wall} gegen ${Colors.wall}`).toBeLessThanOrEqual(TOL);
  expect(channelDelta(probes.plant, Colors.plant), `Pflanze ${probes.plant} gegen ${Colors.plant}`).toBeLessThanOrEqual(TOL);
  // Die Unter-Regal-Zone ist per Konstruktion eine MISCHFARBE: `globalAlpha` über dem Baldachin.
  // Verglichen wird nur über ABSTÄNDE (R3), aber gegen DREI Farben – Hintergrund und reiner
  // Baldachin müssen weit weg sein, die hergeleitete Mischfarbe nah dran. Ohne die dritte Zusicherung
  // wäre die Probe auch dann grün, wenn die Ebene `undershelf` komplett fehlte.
  const zoneOverCanopy = blend(Colors.underShelf, Colors.canopy, UNDER_SHELF_ALPHA);
  expect(channelDelta(probes.shelf, Colors.background), `Baldachin ${probes.shelf} gegen Hintergrund`).toBeGreaterThan(TOL);
  expect(channelDelta(probes.shelf, Colors.canopy), `Baldachin ${probes.shelf} gegen reinen Baldachin`).toBeGreaterThan(TOL);
  expect(channelDelta(probes.shelf, zoneOverCanopy), `Baldachin ${probes.shelf} gegen Zone ${zoneOverCanopy}`).toBeLessThanOrEqual(TOL);

  // 4. Screenshot für die Augen des Umsetzers – git-ignoriert, KEIN Golden-PNG.
  await page.locator('canvas').screenshot({ path: 'test-results/view2d-feinkost.png' });

  // 5. NODE == BROWSER (R2): die beiden EINGEFRORENEN Fixtures werden injiziert, nicht gebündelt.
  const proof = await page.evaluate(([levelJson, balanceJson, ticks]) => {
    const mb = (window as unknown as { __mb: MbHook }).__mb;
    // Ein verlorener oder umbenannter Befehl täte hier STILL nichts, und der Test fiele erst an der
    // Hash-Zeile – die Meldung schickte den Leser in den Kern, obwohl nur der Haken fehlt.
    const load = mb.cmd['loadFixtures'];
    if (typeof load !== 'function') throw new Error('cmd.loadFixtures fehlt – Haken-Vertrag gebrochen');
    load(levelJson, balanceJson);
    const afterLoad = mb.tick();
    const reached = mb.advance(ticks);
    return { afterLoad, reached, read: mb.tick(), hash: mb.hash() };
  }, [miniLevel, testBalance, goldenCase.ticks] as const);
  expect(proof.afterLoad, 'loadFixtures setzt den Zustand zurück').toBe(0);
  expect(proof.reached, 'advance liefert die neue Ticknummer').toBe(goldenCase.ticks);
  expect(proof.read, 'tick() liest nur – gerechnet wird mit advance').toBe(goldenCase.ticks);
  expect(proof.hash, `Zustandshash gegen Golden-Fall ${goldenCase.name}`).toBe(goldenCase.hash);

  // 6. Derselbe Seitenaufruf ergibt dasselbe Bild: der Zeichenweg ist innerhalb eines Laufs
  //    deterministisch. Verglichen wird der Pixel-HASH, nie ein absoluter Pixelwert.
  await page.goto(URL_2D);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => '__mb' in window, undefined, { timeout: 10_000 });
  const second = await canvasFacts(page);
  expect(second.hash, 'Pixel-Hash des zweiten Aufrufs').toBe(first.hash);
});
