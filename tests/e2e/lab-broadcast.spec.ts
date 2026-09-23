import { expect, test, type Page } from '@playwright/test';
import { S } from '../../src/ui/strings';

// CI-fähig (kein @local): zwei Tabs EINES Kontexts verbinden sich über BroadcastChannel – ohne WebRTC.
// Geprüft wird der ganze Labor-Ablauf: Zelle beschriften → verbunden → Ping-Test → Report → Kopieren.

const REPORTS_KEY = 'maeusebau.lab.reports.v1';

interface StoredReport {
  cell: { role: string; path: string; device: string };
  valid: boolean;
  failures: string[];
  hello: { versionMatch: boolean } | null;
  ping: { events: { sent: number; lossPct: number } | null; state: { sent: number } | null };
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
    // Uhrzeiten („T20:13:49") sind keine IPv6-Adressen – dieselbe Ausnahme kennt `redactReport`.
    const ipv6 = (body.match(/[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,}/gi) ?? []).filter((hit) => !/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(hit));
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
