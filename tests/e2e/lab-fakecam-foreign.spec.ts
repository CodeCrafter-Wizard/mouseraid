import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKECAM_FOREIGN_Y4M_PATH } from '../../scripts/lib/qrY4m.mjs';
import { S } from '../../src/ui/strings';

// Zweiter Fake-Kamera-Smoke, eigenes Projekt `chromium-fakecam-foreign`: in dessen .y4m-Datei steckt
// ein FREMDER Code (eine Adresse aus dem reservierten Bereich `.invalid`, RFC 2606). Er beweist die
// SCHREIBENDE Seite von `qr:skipped` (D7) – bis hierher war nur geprüft, dass ein solcher Eintrag
// richtig ausgewertet wird, nie, dass er überhaupt entsteht.
//
// Anders als der Smoke nebenan treibt dieser Test die ECHTE Oberfläche: QR-Pfad wählen, Kamera
// startet selbst, der Scan läuft von selbst los und trifft auf den fremden Code. Der Host ist die
// Rolle der Wahl, weil nur er mit „Platz freigeben" auch ohne Gegenstelle eine Diagnose speichert.
//
// Datenschutz: der gescannte Text und die echten Kandidaten des Angebots verlassen die Seite nie –
// verglichen wird IN der Seite, heraus kommen nur Arten, Anzahlen und Wahrheitswerte.
//
// Tor (kein @local): der Test braucht weder ein zweites Gerät noch Netz; das Angebot entsteht lokal
// und die Frist des Gatherings liegt bei 2,5 s. Fällt er in der CI auf einem Linux-Runner um (dort
// ungemessen), wird er DORT mit `{ tag: '@local' }` versehen und der Grund in `docs/decisions.md`
// notiert – der Test wird nicht abgeschwächt.

const REPORTS_KEY = 'maeusebau.lab.reports.v1';

interface StoredReport {
  cell: { path: string };
  failures: string[];
  timeline: { kind: string; detail: string }[];
  qr: { backend: string } | null;
}

test('Fake-Kamera: ein FREMDER Code wird übersprungen – qr:skipped, kein qr:error, kein F9', async ({ context, page }) => {
  expect(existsSync(resolve(FAKECAM_FOREIGN_Y4M_PATH)), `${FAKECAM_FOREIGN_Y4M_PATH} fehlt – globalSetup nicht gelaufen?`).toBe(true);
  // Ohne diese Freigabe meldet Chromium jede nicht genannte Berechtigung als „denied" – der Lauf
  // trüge dann F6. `grantPermissions` ist additiv, die Kamera-Erlaubnis des Projekts bleibt.
  await context.grantPermissions(['local-network-access']);

  await page.goto('lab.html?quick=1');
  await page.getByTestId('cell-device').fill('QR-Fremd');
  await page.getByTestId('cell-role-host').check();
  await page.getByTestId('cell-camera-an').check();
  await page.getByTestId('cell-path-choice-qr').check();
  await page.getByTestId('cell-confirm').click();
  // Kamera-zuerst (D5/C3): die Karte öffnet den Dauer-Stream selbst – hier mit der .y4m-Datei darin.
  await expect(page.getByTestId('camera-state')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });

  await page.getByTestId('add-player').click();
  const slot = page.getByTestId('slot-1');
  // Das Angebot entsteht lokal (Gathering-Frist 2,5 s) und wird als QR gezeigt; erst danach startet
  // der Antwort-Scan von selbst.
  await expect.poll(async () => (await slot.getByTestId('offer-out').inputValue()).startsWith('MB1.'), { timeout: 15_000 }).toBe(true);

  // Auf die Zwischenmeldung „Kamera auf den QR-Code … halten" wird BEWUSST nicht gewartet: der fremde
  // Code liegt formatfüllend im Bild und ist gelesen, bevor eine Zusicherung ihn abfragen kann
  // (gemessen: schon der erste Versuch fand hier die Meldung unten vor). Geprüft wird das Ergebnis.
  // Sie sagt genau das, was dieser Test beweisen soll: gelesen, verworfen, weitergescannt.
  // 20 s statt 30: die drei Fristen dieses Tests (Kamera 15 s, Angebot 15 s, hier) müssen zusammen
  // unter der 60-s-Grenze des Projekts bleiben – sonst bräche der Test ab, bevor eine Zusicherung
  // den Grund nennen kann. Gemessen wird der Treffer in Bruchteilen einer Sekunde.
  await expect(slot.getByTestId('qr-status'), 'der fremde Code wird erkannt und übersprungen').toHaveText(S.lab.qr.notAPayload, { timeout: 20_000 });
  // Ein Übersprungener beendet den Scan NICHT: der Knopf „Erneut scannen" bleibt weg. Erst prüfen,
  // dass es ihn überhaupt GIBT: ein nicht vorhandener Knopf ist ebenfalls „hidden" – die Zusicherung
  // wäre dann auch grün, wenn der ganze QR-Block fehlte.
  await expect(slot.getByTestId('qr-retry')).toHaveCount(1);
  await expect(slot.getByTestId('qr-retry')).toBeHidden();

  // „Platz freigeben" speichert die Diagnose, bevor der Platz schließt – der Weg zum Report ohne Gegenstelle.
  await slot.getByTestId('release').click();
  await expect(page.getByTestId('report-item')).toHaveCount(1);

  const facts = await page.evaluate((key) => {
    const report = (JSON.parse(localStorage.getItem(key) ?? '[]') as StoredReport[])[0];
    if (report === undefined) return null;
    const kinds = report.timeline.map((event) => event.kind);
    const qrEvents = report.timeline.filter((event) => event.kind.startsWith('qr:'));
    return {
      path: report.cell.path,
      failures: report.failures,
      kinds: [...new Set(kinds)].sort(),
      skipped: kinds.filter((kind) => kind === 'qr:skipped').length,
      qrErrors: kinds.filter((kind) => kind === 'qr:error').length,
      skippedReasons: [...new Set(report.timeline.filter((event) => event.kind === 'qr:skipped').map((event) => event.detail))],
      backend: report.qr?.backend ?? null,
      // Der Vergleich bleibt IN der Seite: weder der gescannte Text noch ein Payload darf in einem
      // Zeitleisten-Detail stehen – nach außen geht nur dieser Wahrheitswert.
      detailsLeakText: qrEvents.some((event) => event.detail.includes('MB1.') || event.detail.includes('http')),
    };
  }, REPORTS_KEY);

  expect(facts).not.toBeNull();
  // D12: Der QR-Pfad bleibt der QR-Pfad, auch wenn kein Code angenommen wurde.
  expect(facts?.path).toBe('qr');
  expect(facts?.kinds, 'der eigene Code wurde gezeigt (sonst wäre er zu groß)').toContain('qr:shown');
  expect(facts?.skipped, 'mindestens ein übersprungener fremder Code').toBeGreaterThan(0);
  expect(facts?.skippedReasons).toEqual(['not-a-payload']);
  // Der Kern dieses Tests: ein fremder Code ist KEIN Befund.
  expect(facts?.qrErrors, 'ein fremder Code schreibt nie qr:error').toBe(0);
  expect(facts?.kinds, 'ein fremder Code gilt nie als dekodierter Payload').not.toContain('qr:decoded');
  expect(facts?.failures, 'ohne qr:error und mit laufender Kamera gibt es kein F9').not.toContain('F9');
  expect(facts?.detailsLeakText, 'kein Zeitleisten-Detail trägt den gescannten Text').toBe(false);
  // Der Scanner hat sich gemeldet. NICHT geprüft wird `qr.attempts`: die QR-Fakten werden nur an
  // Marken gemeldet (Backend steht fest, Code gezeigt, Code erkannt, Scan gescheitert) – während
  // eines LAUFENDEN Scans steht dort noch 0. Gemessen, kein Versehen; ein Rückruf je Versuch wären
  // zehn Meldungen je Sekunde.
  expect(facts?.kinds).toContain('qr:backend');
  expect(['worker', 'native']).toContain(facts?.backend);
});
