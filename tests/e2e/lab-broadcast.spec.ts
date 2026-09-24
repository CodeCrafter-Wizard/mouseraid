import { expect, test, type Page } from '@playwright/test';
import { S, fmt } from '../../src/ui/strings';
import type { LabHook } from '../../src/lab/labHook';

// CI-fähig (kein @local): zwei Tabs EINES Kontexts verbinden sich über BroadcastChannel – ohne WebRTC.
// Geprüft wird der ganze Labor-Ablauf: Zelle beschriften → verbunden → Ping-Test → Report → Kopieren.

const REPORTS_KEY = 'maeusebau.lab.reports.v1';

interface StoredReport {
  cell: { role: string; path: string; device: string };
  valid: boolean;
  failures: string[];
  hello: { versionMatch: boolean } | null;
  ping: { events: { sent: number; lossPct: number } | null; state: { sent: number } | null };
  timeline: { kind: string; detail: string }[];
}

async function labelCell(page: Page, device: string): Promise<void> {
  await page.getByTestId('cell-device').fill(device);
  await page.getByTestId('cell-hotspot').selectOption('router');
  // Das Chromium-Projekt hat eine persistierte Kamera-Erlaubnis – „Kamera an" ist damit das ehrliche Label.
  await page.getByTestId('cell-camera-an').check();
  await page.getByTestId('cell-confirm').click();
}

// Nach `setViewportSize` braucht das Layout einen Umbruch – deshalb pollen statt einmal messen.
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => {
      const app = document.getElementById('app');
      const root = document.documentElement;
      return { app: app === null ? -1 : app.scrollWidth - app.clientWidth, root: root.scrollWidth - root.clientWidth };
    }), { message: 'kein horizontaler Überlauf' })
    .toEqual({ app: 0, root: 0 });
}

async function expectTouchTargets(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.lab .btn, .lab .lab-choice, .lab .lab-input')]
        .filter((node) => node.offsetParent !== null && node.getBoundingClientRect().height < 48)
        .map((node) => node.dataset['testid'] ?? node.textContent ?? node.tagName)), { message: 'Touch-Ziele unter 48 px' })
    .toEqual([]);
}

/**
 * Liest die Zwischenablage IN der Seite; nach außen gehen nur Zahlen, eigene Fixture-Namen und
 * Wahrheitswerte – nie der Text selbst. (Hier gibt es ohnehin keine echten Adressen; im
 * `@local`-Block von lab-rtc.spec.ts, wo es welche gibt, gilt dieselbe Regel.)
 */
async function clipboardFacts(page: Page) {
  return page.evaluate(async () => {
    const text = await navigator.clipboard.readText();
    // Der User-Agent bleibt laut Task 7 absichtlich bytegleich; seine Versionsnummern (…/153.0.0.0)
    // sehen wie eine IPv4-Adresse aus, sind aber keine – für die Adress-Suche wird er ersetzt.
    const body = text.replace(/"userAgent":\s*"[^"]*"/g, '"userAgent": "…"');
    // Erste Gruppe `{0,4}`: eine Adresse darf auch mit „::" beginnen. Uhrzeiten („T20:13:49") sind
    // keine IPv6-Adressen – dieselbe Ausnahme kennt `redactReport`.
    const ipv6 = (body.match(/[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}/gi) ?? []).filter((hit) => !/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(hit));
    const parsed = ((): { cell?: { role?: string; device?: string }; gather?: unknown }[] | null => {
      try {
        const value: unknown = JSON.parse(text);
        return Array.isArray(value) ? value : null;
      } catch {
        return null;
      }
    })();
    return {
      isJson: parsed !== null,
      count: parsed?.length ?? -1,
      roles: (parsed ?? []).map((entry) => entry.cell?.role ?? '?').sort(),
      devices: (parsed ?? []).map((entry) => entry.cell?.device ?? '?').sort(),
      allGatherNull: (parsed ?? []).every((entry) => entry.gather === null),
      ipv4: /\d{1,3}(?:\.\d{1,3}){3}/.test(body),
      ipv6: ipv6.length > 0,
      mdns: /\.local\b/i.test(body),
    };
  });
}

test('Zwei Tabs: Zelle beschriften, verbinden, Ping-Test, Report auf beiden Seiten, JSON ohne Roh-SDP', async ({ context }, testInfo) => {
  // Gemessen (Playwright-Chromium): Sobald ein Kontext IRGENDEINE Erlaubnis gesetzt bekommt, melden alle
  // übrigen 'denied' – auch `local-network`. Ohne diese Freigabe stünde in jedem Report F6.
  await context.grantPermissions(['clipboard-read', 'clipboard-write', 'local-network-access']);
  const room = `e2e-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  const host = await context.newPage();
  const client = await context.newPage();
  await host.setViewportSize({ width: 844, height: 390 });
  await client.setViewportSize({ width: 844, height: 390 });
  await host.goto(`lab.html?transport=bc&room=${room}&role=host&slot=1&quick=1`);
  await client.goto(`lab.html?transport=bc&room=${room}&role=client&slot=1&quick=1`);

  await expect(host.getByTestId('cell-path')).toHaveText(S.lab.cell.pathBroadcast);
  await expect(host.getByTestId('selftest-mount')).toBeAttached();
  await expect(host.getByTestId('cell-role-host')).toBeChecked();
  await expect(client.getByTestId('cell-role-client')).toBeChecked();

  // Ohne Spitznamen geht es nicht weiter.
  await host.getByTestId('cell-device').fill('');
  await host.getByTestId('cell-confirm').click();
  await expect(host.getByText(S.lab.cell.deviceMissing)).toBeVisible();

  await labelCell(host, 'E2E-Host');
  await labelCell(client, 'E2E-Client');

  // Kamera-Schalter: die synthetische Kamera des Projekts liefert einen Stream, der offen bleibt.
  await host.getByTestId('camera-start').click();
  await expect(host.getByTestId('camera-state')).toHaveText(S.lab.camera.running);
  // Der Sucher zeigt ein laufendes Bild (Kamera-zuerst): Maße und Wiedergabe kommen als Wahrheitswerte
  // aus der Seite – `track.label` verlässt sie nie.
  await expect(host.getByTestId('camera-video')).toBeVisible();
  await expect
    .poll(() => host.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('[data-testid="camera-video"]');
      return video !== null && video.videoWidth > 0 && video.videoHeight > 0 && !video.paused;
    }), { message: 'Kamera-Sucher zeigt ein laufendes Bild' })
    .toBe(true);
  // Solange die Spur lebt, bleibt „Kamera neu starten" verborgen.
  await expect(host.getByTestId('camera-restart')).toBeHidden();

  await expect(host.getByTestId('slot-1').getByTestId('conn-state')).toHaveText(S.lab.state.open);
  await expect(client.getByTestId('conn-state')).toHaveText(S.lab.state.open);

  // Der Client misst von selbst, sobald die Verbindung steht – der Host antwortet schon vor seinem eigenen Lauf.
  await expect(client.getByTestId('run-status')).toHaveText(S.lab.run.saved, { timeout: 20_000 });

  await host.getByTestId('slot-1').getByTestId('start-ping').click();
  await expect(host.getByTestId('slot-1').getByTestId('run-status')).toHaveText(S.lab.run.saved, { timeout: 20_000 });
  await expect(host.getByTestId('slot-1').getByTestId('run-pings').locator('p')).toHaveCount(2);

  // Standbilder für die Sichtprüfung (landen im git-ignorierten test-results/).
  await host.getByTestId('host-card').scrollIntoViewIfNeeded();
  await host.screenshot({ path: testInfo.outputPath('lab-host-844x390.png') });
  await client.getByTestId('client-card').scrollIntoViewIfNeeded();
  await client.screenshot({ path: testInfo.outputPath('lab-client-844x390.png') });

  // Beide Tabs teilen sich den localStorage des Kontexts: je ein Report pro Rolle.
  const stored = await host.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as StoredReport[], REPORTS_KEY);
  expect(stored).toHaveLength(2);
  for (const role of ['host', 'client']) {
    const report = stored.find((entry) => entry.cell.role === role);
    expect(report, `Report der Rolle ${role}`).toBeDefined();
    expect(report?.cell.path).toBe('broadcast');
    expect(report?.valid).toBe(true);
    expect(report?.failures).toEqual([]);
    expect(report?.hello?.versionMatch).toBe(true);
    expect(report?.ping.events).toMatchObject({ sent: 20, lossPct: 0 });
    expect(report?.ping.state?.sent).toBe(20);
  }

  // Wake Lock und Kamera-Spuren stehen als Seiten-Ereignisse in der Zeitleiste jedes Laufs dieses
  // Seitenaufrufs. Headless Chromium lehnt den Wake Lock mit NotAllowedError ab – der Fehlschlag wird
  // geschluckt, die Seite läuft weiter (headful stünde hier `wakelock:acquired`; siehe Bekannte Grenzen).
  const hostReport = stored.find((entry) => entry.cell.role === 'host');
  const kinds = (hostReport?.timeline ?? []).map((event) => event.kind);
  expect(kinds.filter((kind) => kind.startsWith('wakelock:'))).toEqual(['wakelock:denied']);
  expect(kinds).toContain('camera:track:live');
  // Datenschutz: weder die Spur-ID noch ein Gerätename verlässt die Seite.
  expect((hostReport?.timeline ?? [])
    .filter((event) => event.kind.startsWith('camera:track:') || event.kind.startsWith('wakelock:'))
    .every((event) => event.detail === '')).toBe(true);

  // Die Liste zeigt den eigenen Report sofort und den des anderen Tabs über das storage-Ereignis.
  for (const page of [host, client]) {
    await expect(page.getByTestId('report-item')).toHaveCount(2);
    await expect(page.getByTestId('report-valid').first()).toHaveText(S.lab.reports.valid);
    await expect(page.getByTestId('report-failures').first()).toHaveText(S.lab.reports.noFailures);
  }
  await expect(host.locator('[data-testid="report-item"][data-role="host"]')).toContainText('E2E-Host');
  await expect(client.locator('[data-testid="report-item"][data-role="client"]')).toContainText('E2E-Client');
  // Ohne WebRTC gibt es kein SDP – den Knopf gibt es, er bleibt aber verborgen.
  await expect(host.getByTestId('reports-copy-raw')).toBeAttached();
  await expect(host.getByTestId('reports-copy-raw')).toBeHidden();

  await host.bringToFront();
  await host.getByTestId('reports-copy-all').click();
  // Rauchprobe der Schwärzungs-Naht: Im BroadcastChannel-Modus gibt es weder SDP noch Kandidaten,
  // also kann hier nichts Echtes durchrutschen – der scharfe Test mit ECHTEN Adressen steht im
  // `@local`-Block von lab-rtc.spec.ts. Erst lesen, dann die kurz stehende „Kopiert"-Beschriftung prüfen.
  expect(await clipboardFacts(host)).toEqual({
    isJson: true, count: 2, roles: ['client', 'host'], devices: ['E2E-Client', 'E2E-Host'],
    allGatherNull: true, ipv4: false, ipv6: false, mdns: false,
  });
  await expect(host.getByTestId('reports-copy-all')).toHaveText(S.lab.share.copied);

  // Layout quer UND hochkant: nichts ragt seitlich heraus, alle Touch-Ziele sind groß genug.
  for (const page of [host, client]) {
    for (const size of [{ width: 844, height: 390 }, { width: 667, height: 375 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
    }
  }

  // Verlauf löschen braucht zwei Tipper.
  await host.getByTestId('reports-clear').click();
  await expect(host.getByTestId('reports-clear')).toHaveText(S.lab.reports.clearConfirm);
  await host.getByTestId('reports-clear').click();
  await expect(host.getByTestId('report-item')).toHaveCount(0);
  await expect(host.getByText(S.lab.reports.empty)).toBeVisible();
});

test('Host ohne Gegenstelle: Ping-Test schon beim Verbinden erreichbar, „Platz freigeben" rettet die Diagnose genau einmal', async ({ context }, testInfo) => {
  // Ohne diese Freigabe stünde in jeder Diagnose F6 (siehe Anmerkung im Test oben).
  await context.grantPermissions(['local-network-access']);
  const page = await context.newPage();
  // Ein Raum, in dem nie ein Mitspieler auftaucht: der Transport bleibt für immer „verbinde …".
  const room = `e2e-allein-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  await page.goto(`lab.html?transport=bc&room=${room}&role=host&slot=1&quick=1`);
  await labelCell(page, 'E2E-Allein');

  // 1. Der Ping-Test ist erreichbar, BEVOR die Verbindung steht – sonst bliebe die Diagnose eines nie
  //    geöffneten Platzes (F7/F3) in der Zwei-Geräte-Oberfläche unerreichbar.
  const slot1 = page.getByTestId('slot-1');
  await expect(slot1.getByTestId('conn-state')).toHaveText(S.lab.state.connecting);
  await expect(slot1.getByTestId('start-ping')).toBeEnabled();
  await slot1.getByTestId('start-ping').click();
  await expect(slot1.getByTestId('run-status')).toHaveText(S.lab.run.saved, { timeout: 20_000 });
  await expect(page.getByTestId('report-item')).toHaveCount(1);

  // 2. Ein zweiter Platz, der nie verbunden war: „Platz freigeben" speichert erst die Diagnose und
  //    schließt dann – der Platz verschwindet also erst NACH dem Report.
  await page.getByTestId('add-player').click();
  const slot2 = page.getByTestId('slot-2');
  await expect(slot2.getByTestId('conn-state')).toHaveText(S.lab.state.connecting);
  await slot2.getByTestId('release').click();
  await expect(slot2).toHaveCount(0);
  await expect(page.getByTestId('report-item')).toHaveCount(2);

  // 3. Platz 1 hat seinen Report schon hergegeben – sein Freigeben erzeugt keinen zweiten. Auch das ist
  //    nach dem Verschwinden des Platzes entschieden (Diagnose vor dem Schließen).
  await slot1.getByTestId('release').click();
  await expect(slot1).toHaveCount(0);
  await expect(page.getByTestId('report-item')).toHaveCount(2);
});

test('Verlorene Kamera-Spur: Hinweis, „Kamera neu starten" und F9 im Report', async ({ context }, testInfo) => {
  // Ohne diese Freigabe stünde in jeder Diagnose zusätzlich F6 (siehe Anmerkung im ersten Test).
  await context.grantPermissions(['local-network-access']);
  const page = await context.newPage();
  const room = `e2e-spur-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  // `hook=1`: weiter unten wird die Kamera von AUSSERHALB der Karte neu gestartet – denselben Weg
  // nimmt der Knopf im QR-Block, der hier (Text-Pfad) gar nicht steht.
  await page.goto(`lab.html?transport=bc&room=${room}&role=host&slot=1&quick=1&hook=1`);
  await page.waitForFunction(() => '__mbLab' in window, undefined, { timeout: 10_000 });
  await labelCell(page, 'E2E-Spur');
  await page.getByTestId('camera-start').click();
  await expect(page.getByTestId('camera-state')).toHaveText(S.lab.camera.running);

  // Eine echte Spur lässt sich im Test nicht beenden (`track.stop()` löst kein `ended` aus), das
  // Ereignis dagegen schon: es kommt beim Handy vom Betriebssystem und geht denselben Weg.
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="camera-video"]');
    const stream = video?.srcObject as MediaStream | null;
    stream?.getVideoTracks()[0]?.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByTestId('camera-state')).toHaveText(S.lab.camera.trackLost);
  await expect(page.getByTestId('camera-video')).toBeHidden();
  await expect(page.getByTestId('camera-restart')).toBeVisible();

  // Der Befund landet im Report des Laufs: `camera-error` → F9.
  await page.getByTestId('slot-1').getByTestId('start-ping').click();
  await expect(page.getByTestId('slot-1').getByTestId('run-status')).toHaveText(S.lab.run.saved, { timeout: 20_000 });
  const report = await page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '[]') as StoredReport[])[0], REPORTS_KEY);
  expect(report?.failures).toContain('F9');
  expect(report?.timeline.map((event) => event.kind)).toContain('camera:track:ended');
  expect(report?.timeline.find((event) => event.kind === 'camera-error')?.detail).toBe('track-ended');

  // „Kamera neu starten" holt einen frischen Stream – der Sucher zeigt wieder ein Bild.
  await page.getByTestId('camera-restart').click();
  await expect(page.getByTestId('camera-state')).toHaveText(S.lab.camera.running);
  await expect(page.getByTestId('camera-video')).toBeVisible();
  await expect(page.getByTestId('camera-restart')).toBeHidden();

  // ── Ein Neustart, der NICHT von diesem Knopf kommt (der QR-Block hat seinen eigenen) ──
  // Beide rufen dasselbe `restartCamera`; die Heilung – Karte aktualisieren UND die Spuren neu
  // beobachten – gehört deshalb dem Kamera-Modul, nicht dem Aufrufer.
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="camera-video"]');
    (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]?.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByTestId('camera-state')).toHaveText(S.lab.camera.trackLost);
  // Ein lebender QR-Sucher hängt am Stream: nach dem Neustart MUSS er den neuen haben, sonst zeigte er
  // ein eingefrorenes Bild und scannte ins Leere. Verglichen werden Stream-Identitäten IN der Seite.
  const reattached = await page.evaluate(async () => {
    const lab = (window as unknown as { __mbLab: LabHook }).__mbLab;
    const exchange = lab.createQrExchange({
      timeline: lab.createTimeline(() => performance.now()),
      marks: lab.createPairingTracker(() => performance.now()),
      // Der Scan darf nie fertig werden: dieser Block ist hier nur ein Sucher am Dauer-Stream.
      looksLikePayload: () => Promise.resolve(false),
      onQrFacts: () => undefined,
    });
    document.body.append(exchange.element);
    void exchange.scan('offer').catch(() => undefined);
    const video = exchange.element.querySelector('video');
    const attached = (): boolean => lab.cameraStream() !== null && video?.srcObject === lab.cameraStream();
    const before = attached();
    await lab.restartCamera();
    const after = attached();
    exchange.dispose();
    return { before, after };
  });
  expect(reattached, 'der Neustart hängt JEDEN lebenden Sucher wieder ein').toEqual({ before: true, after: true });
  await expect(page.getByTestId('camera-state'), 'auch ein Neustart von außen heilt die Karte').toHaveText(S.lab.camera.running);
  await expect(page.getByTestId('camera-video')).toBeVisible();
  await expect(page.getByTestId('camera-restart')).toBeHidden();

  // Und die Beobachtung läuft wieder: ein NEUER Platz bringt eine frische Zeitleiste, in die allein
  // die Seiten-Ereignisse fließen – die enden jetzt auf „Spur läuft", also ist das F9 vom Tisch.
  // Ohne die frische Beobachtung fehlte `camera:track:live` und JEDER weitere Lauf dieses
  // Seitenaufrufs trüge den behobenen Kamera-Fehler weiter mit sich.
  await page.getByTestId('add-player').click();
  const slot2 = page.getByTestId('slot-2');
  await slot2.getByTestId('start-ping').click();
  await expect(slot2.getByTestId('run-status')).toHaveText(S.lab.run.saved, { timeout: 20_000 });
  const healed = await page.evaluate((key) => {
    const stored = (JSON.parse(localStorage.getItem(key) ?? '[]') as StoredReport[])[0];
    if (stored === undefined) return null;
    const kinds = stored.timeline.map((event) => event.kind);
    return { f9: stored.failures.includes('F9'), live: kinds.includes('camera:track:live'), lastCamera: kinds.filter((kind) => kind.startsWith('camera')).pop() ?? '' };
  }, REPORTS_KEY);
  expect(healed?.live, 'die geheilte Kamera meldet wieder eine laufende Spur').toBe(true);
  expect(healed?.lastCamera, 'der letzte Kamera-Eintrag ist die laufende Spur').toBe('camera:track:live');
  expect(healed?.f9, 'ein behobener Kamera-Fehler ist kein Befund mehr').toBe(false);

  // Scheitert der Neustart (Kamera inzwischen von einer anderen App belegt oder entzogen), MUSS der
  // Knopf stehen bleiben – sonst gäbe es am Handy keinen zweiten Versuch mehr.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('kein Geraet', 'NotFoundError'));
  });
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="camera-video"]');
    (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]?.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByTestId('camera-restart')).toBeVisible();
  await page.getByTestId('camera-restart').click();
  await expect(page.getByTestId('camera-state')).toHaveText(fmt(S.lab.camera.failed, { reason: 'NotFoundError' }));
  await expect(page.getByTestId('camera-restart')).toBeVisible();
  await expect(page.getByTestId('camera-restart')).toBeEnabled();
});

test('Text-Pfad ohne Parameter: Formular passt bei 667×375 ohne horizontalen Überlauf, Spitzname bleibt erhalten', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto('lab.html');
  await expect(page.getByTestId('cell-path')).toHaveText(S.lab.cell.pathText);
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  await page.getByTestId('cell-device').fill('Handy-Test');
  await page.getByTestId('cell-role-client').check();
  await page.getByTestId('cell-confirm').click();
  await expect(page.getByTestId('client-card')).toBeVisible();
  await expect(page.getByTestId('cell-device')).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  // Ein leerer Code wird abgefangen, ein kaputter Code zeigt F5 mit Titel und Hinweis.
  await page.getByTestId('make-answer').click();
  await expect(page.getByText(S.lab.run.emptyCode)).toBeVisible();
  await page.getByTestId('offer-in').fill('das ist kein Code');
  await page.getByTestId('make-answer').click();
  await expect(page.getByRole('alert').filter({ hasText: S.failures.F5.title })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: S.failures.F5.hint })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('cell-device')).toHaveValue('Handy-Test');
});

// ───────── M2 Task 4: QR-Pfad in der Oberfläche (Tor – kein @local) ─────────
// Der Handshake über QR braucht ZWEI Kameras und lässt sich mit einer Datei-Fake-Kamera nicht
// fahren (Abweichung 10 des M2-Plans). Hier laufen deshalb nur die beiden Teile, die ohne Scan
// entscheidbar sind: die Pfad-Auswahl und der Weg „Code zu groß → Text-Pfad".

test('QR-Pfad: die Auswahl spiegelt sich im Zellen-Chip, der Text-Code bleibt als Rückfall stehen', async ({ page }) => {
  await page.goto('lab.html');
  await expect(page.getByTestId('cell-path')).toHaveText(S.lab.cell.pathText);

  await page.getByTestId('cell-path-choice-qr').check();
  await expect(page.getByTestId('cell-path'), 'der Chip spiegelt die Auswahl').toHaveText(S.lab.cell.pathQr);
  await page.getByTestId('cell-path-choice-text').check();
  await expect(page.getByTestId('cell-path')).toHaveText(S.lab.cell.pathText);

  await page.getByTestId('cell-path-choice-qr').check();
  await page.getByTestId('cell-device').fill('QR-Auswahl');
  await page.getByTestId('cell-role-client').check();
  await page.getByTestId('cell-confirm').click();

  // Eine Zelle je Seitenaufruf: nach „Zelle übernehmen" ist auch der Pfad festgeschrieben.
  await expect(page.getByTestId('cell-path-choice-qr')).toBeDisabled();
  await expect(page.getByTestId('cell-path')).toHaveText(S.lab.cell.pathQr);
  // Der QR-Pfad BRAUCHT die Kamera – deshalb steht die Kamera-Karte auch ohne „Kamera an".
  await expect(page.getByTestId('camera-card')).toBeVisible();
  // Kamera-zuerst: der QR-Pfad öffnet den Stream ohne Knopfdruck (D5).
  await expect(page.getByTestId('camera-state')).toHaveText(S.lab.camera.lobbyRunning, { timeout: 10_000 });
  // QR-Block UND Text-Rückfall stehen nebeneinander; der Hinweis nennt den Rückfallweg.
  await expect(page.getByTestId('qr-block')).toBeAttached();
  await expect(page.getByTestId('offer-in')).toBeVisible();
  await expect(page.getByTestId('make-answer')).toBeVisible();
  await expect(page.getByText(S.lab.qr.fallbackHint)).toBeVisible();

  // Der Scan startet von selbst (C4), aber ERST mit laufender Kamera: startete er im selben Tick wie
  // der Selbststart der Karte, fände `attachCamera` keinen Stream – die Statuszeile zeigte den
  // Kamera-Fehler, „Kamera neu starten" stünde da und der Lauf trüge ein falsches F9.
  await expect(page.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning, { timeout: 10_000 });
  await expect(page.getByTestId('qr-restart-camera')).toBeHidden();
  await expect(page.getByTestId('qr-retry')).toBeHidden();

  // Seitenwechsel (Sperrbildschirm): der Scan hält an und bietet den zweiten Versuch an. Playwright kann
  // die Sichtbarkeit nicht echt umschalten – gefälscht wird nur `visibilityState`, das Ereignis ist echt.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('qr-retry'), 'ein Scan im Hintergrund läuft nicht weiter').toBeVisible();

  // „Erneut scannen" nimmt die Schleife wieder auf …
  await page.getByTestId('qr-retry').click();
  await expect(page.getByTestId('qr-retry')).toBeHidden();
  await expect(page.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning);

  // … und „Auf Text-Pfad wechseln" beendet sie und setzt den Fokus ins Textfeld.
  await page.getByTestId('qr-to-text').click();
  await expect(page.getByTestId('qr-status'), 'der Wechsel beendet die Schleife').not.toHaveText(S.lab.qr.scanning);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('offer-in');
  // Der Weg zurück bleibt offen (Fixrunde 1/5): `userLeftScan` sperrt allein den AUTOMATISCHEN Start.
  // Ohne diesen Knopf gäbe es für diesen Schritt keine Möglichkeit mehr, doch noch zu scannen.
  await expect(page.getByTestId('qr-retry'), 'nach dem Wechsel auf Text bleibt der Weg zurück offen').toBeVisible();
  await page.getByTestId('qr-retry').click();
  await expect(page.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning);
  await expect(page.getByTestId('qr-retry')).toBeHidden();
});

test('QR-Pfad am Test-Haken: ein zu großer Code meldet „too-large", clear() beginnt einen neuen Austausch', async ({ page }) => {
  await page.goto('lab.html?hook=1');
  await page.waitForFunction(() => '__mbLab' in window, undefined, { timeout: 10_000 });

  // Der Payload entsteht IN der Seite und ist synthetisch (base64url-Füllung, keine echte Beschreibung):
  // aus echtem Gathering kommt nie ein Code über 1100 Zeichen, und committet wird er schon gar nicht.
  const facts = await page.evaluate((chars) => {
    const lab = (window as unknown as { __mbLab: LabHook }).__mbLab;
    const timeline = lab.createTimeline(() => performance.now());
    const exchange = lab.createQrExchange({
      timeline,
      marks: lab.createPairingTracker(() => performance.now()),
      looksLikePayload: () => Promise.resolve(true),
      onQrFacts: () => undefined,
    });
    document.body.append(exchange.element);
    exchange.show('offer', `MB1.p.${'A'.repeat(chars - 6)}`);
    const status = exchange.element.querySelector<HTMLElement>('[data-testid="qr-status"]');
    const tap = exchange.element.querySelector<HTMLElement>('[data-testid="qr-enlarge"]');
    return {
      events: [...timeline.events()].map((event) => `${event.kind}:${event.detail}`),
      status: status?.textContent ?? '',
      codeHidden: tap?.hidden ?? false,
    };
  }, 1101);

  expect(facts.events).toContain('qr:error:too-large');
  // Kein Eintrag trägt je den Code selbst – nur den Grund.
  expect(facts.events.some((entry) => entry.includes('MB1.'))).toBe(false);
  expect(facts.status).toBe(S.lab.qr.tooLarge);
  expect(facts.codeHidden, 'kein halbgares Bild: ohne Code bleibt die Fläche leer').toBe(true);
  await expect(page.getByTestId('qr-block').getByText(S.lab.qr.fallbackHint)).toBeVisible();

  // `clear()` beendet einen AUSTAUSCH (der Client behält seinen QR-Block über „Neu verbinden" hinweg):
  // Der nächste zählt bei null und bringt seine Backend-Zeile selbst mit – ohne beides trüge der
  // Report der frischen Verbindung die Längen des toten Peers und gar kein Backend.
  const fresh = await page.evaluate(async () => {
    const lab = (window as unknown as { __mbLab: LabHook }).__mbLab;
    const timeline = lab.createTimeline(() => performance.now());
    const seen: { offerChars: number; answerChars: number }[] = [];
    const exchange = lab.createQrExchange({
      timeline,
      marks: lab.createPairingTracker(() => performance.now()),
      looksLikePayload: () => Promise.resolve(true),
      onQrFacts: (entry) => { seen.push({ offerChars: entry.offerChars, answerChars: entry.answerChars }); },
    });
    document.body.append(exchange.element);
    // Die Erkennung meldet sich asynchron; ihr Eintrag muss vor dem Zählen stehen (der Adapter
    // antwortet aus seinem Gedächtnis, der Rückruf des Blocks stand vor diesem `await` in der Schlange).
    await lab.detectScanBackend();
    exchange.show('offer', `MB1.p.${'A'.repeat(194)}`);
    exchange.show('answer', `MB1.p.${'B'.repeat(94)}`);
    const before = seen[seen.length - 1];
    exchange.clear();
    exchange.show('answer', `MB1.p.${'C'.repeat(94)}`);
    const after = seen[seen.length - 1];
    exchange.dispose();
    return {
      before: { offerChars: before?.offerChars ?? -1, answerChars: before?.answerChars ?? -1 },
      after: { offerChars: after?.offerChars ?? -1, answerChars: after?.answerChars ?? -1 },
      backendRows: timeline.events().filter((event) => event.kind === 'qr:backend').length,
    };
  });

  expect(fresh.before, 'der erste Austausch hat beide Codes gezeigt').toEqual({ offerChars: 200, answerChars: 100 });
  expect(fresh.backendRows, 'die frische Zeitleiste bekommt ihre Backend-Zeile').toBe(2);
  expect(fresh.after, 'nach clear() zählt nur noch der neue Austausch').toEqual({ offerChars: 0, answerChars: 100 });
});

// ───────── Fixrunde 2: der Nutzer ist schneller als die Kamera ─────────

/** Lässt `getUserMedia` erst auf Kommando antworten – so steht die Berechtigungs-Blase im Test still. */
async function holdCamera(page: Page): Promise<void> {
  await page.evaluate(() => {
    const media = navigator.mediaDevices;
    const real = media.getUserMedia.bind(media);
    const win = window as unknown as { __letCameraAnswer?: () => void };
    media.getUserMedia = (constraints?: MediaStreamConstraints) =>
      new Promise<MediaStream>((resolve, reject) => {
        win.__letCameraAnswer = () => { void real(constraints).then(resolve, reject); };
      });
  });
}

/** Wählt den QR-Pfad als Client und übernimmt die Zelle. */
async function confirmQrClient(page: Page, device: string): Promise<void> {
  await page.getByTestId('cell-path-choice-qr').check();
  await page.getByTestId('cell-device').fill(device);
  await page.getByTestId('cell-role-client').check();
  await page.getByTestId('cell-confirm').click();
}

test('QR-Pfad: wer während der Kamera-Abfrage auf den Text-Pfad wechselt, bekommt keinen Scan mehr', async ({ page }) => {
  await page.goto('lab.html');
  await holdCamera(page);
  await confirmQrClient(page, 'QR-Ueberholt');

  // Am Handy steht jetzt die Berechtigungs-Blase; der Nutzer tippt in der Zeit auf „Auf Text-Pfad
  // wechseln". Antwortet die Kamera danach, darf KEIN Scan mehr anspringen – auf der Client-Seite
  // führte er sonst zu einem zweiten `acceptOffer`, das die schon laufende Verbindung schließt.
  await page.getByTestId('qr-to-text').click();
  await page.evaluate(() => { (window as unknown as { __letCameraAnswer?: () => void }).__letCameraAnswer?.(); });
  await expect(page.getByTestId('camera-state')).toHaveText(S.lab.camera.lobbyRunning, { timeout: 10_000 });

  await expect(page.getByTestId('qr-status'), 'kein Scan nach dem Wechsel auf den Text-Pfad').not.toHaveText(S.lab.qr.scanning);
  // Das Tor sperrt den AUTOMATISCHEN Start – nicht den ausdrücklichen Wunsch: der Knopf bleibt
  // erreichbar, damit dieser Schritt nicht in einer Sackgasse endet (Fixrunde 1/5).
  await expect(page.getByTestId('qr-retry'), 'von Hand geht es weiterhin zurück zum Scan').toBeVisible();

  // Gegenprobe im gleichen Aufbau: OHNE den Wechsel startet der Scan sehr wohl, sobald die Kamera
  // antwortet. Die Zusicherung oben misst also den Wechsel – nicht einen Aufbau, in dem nie scannt.
  const control = await page.context().newPage();
  await control.goto('lab.html');
  await holdCamera(control);
  await confirmQrClient(control, 'QR-Kontrolle');
  await control.evaluate(() => { (window as unknown as { __letCameraAnswer?: () => void }).__letCameraAnswer?.(); });
  await expect(control.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning, { timeout: 10_000 });
  await control.close();
});

test('QR-Pfad ohne Kamera: der Block nennt den Grund, der Neustart-Knopf bleibt weg', async ({ page }) => {
  await page.goto('lab.html');
  // Eine Kamera, die ablehnt (Erlaubnis entzogen, Gerät belegt) – der häufigste Fall am Handy. Das
  // echte `getUserMedia` wird beiseitegelegt: weiter unten darf der Neustart glücken.
  await page.evaluate(() => {
    const media = navigator.mediaDevices;
    (window as unknown as { __realGum?: MediaDevices['getUserMedia'] }).__realGum = media.getUserMedia.bind(media);
    media.getUserMedia = () => Promise.reject(new DOMException('abgelehnt', 'NotAllowedError'));
  });
  await confirmQrClient(page, 'QR-Ohne-Kamera');

  await expect(page.getByTestId('camera-state')).toHaveAttribute('data-state', 'bad', { timeout: 10_000 });
  // Nach dem ERSTEN Fehlschlag gibt es nichts neu zu starten – nur einzuschalten.
  await expect(page.getByTestId('camera-restart')).toBeHidden();
  await expect(page.getByTestId('camera-start')).toBeEnabled();
  // Der QR-Block sagt selbst, warum nichts passiert, statt stumm zu bleiben.
  await expect(page.getByTestId('qr-no-camera')).toHaveText(S.lab.qr.noCamera);
  await expect(page.getByTestId('qr-status')).not.toHaveText(S.lab.qr.scanning);

  // Der QR-Block hat seinen EIGENEN Neustart-Knopf: er erscheint, sobald ein Scan an der fehlenden
  // Kamera scheitert. Von Hand angestoßen, weil das Tor den automatischen Start ohne Kamera gar nicht
  // erst versucht.
  await page.getByTestId('qr-retry').click();
  await expect(page.getByTestId('qr-status')).toHaveText(S.lab.qr.cameraError);
  await expect(page.getByTestId('qr-restart-camera')).toBeVisible();

  // Jetzt darf die Kamera wieder – und der Neustart AUS DEM QR-BLOCK muss die Kamera-Karte genauso
  // heilen wie ihr eigener Knopf. Ohne das behauptete sie für den Rest des Seitenaufrufs einen
  // Kamera-Fehler, den es nicht mehr gibt, und beobachtete die frischen Spuren nie.
  await page.evaluate(() => {
    const real = (window as unknown as { __realGum?: MediaDevices['getUserMedia'] }).__realGum;
    if (real !== undefined) navigator.mediaDevices.getUserMedia = real;
  });
  await page.getByTestId('qr-restart-camera').click();
  await expect(page.getByTestId('camera-state'), 'der Neustart aus dem QR-Block heilt die Karte').toHaveText(S.lab.camera.lobbyRunning, { timeout: 10_000 });
  await expect(page.getByTestId('camera-video')).toBeVisible();
  await expect(page.getByTestId('qr-restart-camera')).toBeHidden();
});
