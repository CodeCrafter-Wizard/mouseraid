import { expect, test } from '@playwright/test';

// Beweist den Kern der Offline-Anforderung: einmal online laden → danach ohne Netz startbar,
// auch mit URL-Parametern und für die zweite HTML-Seite.
test('Hülle und Testlabor starten offline – auch mit URL-Parametern', async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });

  await page.goto('./');
  await expect(page.getByTestId('shell-title')).toBeVisible();
  await expect(page.getByTestId('offline-badge')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  expect(foreign, 'Seite darf online keine Fremd-Hosts ansprechen').toEqual([]);

  await context.setOffline(true);

  await page.reload();
  await expect(page.getByTestId('shell-title')).toBeVisible();
  await expect(page.getByTestId('build-id')).toContainText('Build');

  await page.goto('./?view=2d&expect=irgendwas');
  await expect(page.getByTestId('shell-title')).toBeVisible();
  await expect(page.getByTestId('build-id')).toHaveAttribute('data-expect', 'mismatch');

  await page.goto('lab.html?x=1');
  await expect(page.getByTestId('shell-title')).toBeVisible();
  await expect(page.getByText('Verbindungs-Testlabor').first()).toBeVisible();
});
