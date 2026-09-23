import { expect, test, type Page } from '@playwright/test';

// Fähigkeits-Tests für die Agenten-Werkzeuge (Tooling-Spike M0). Laufen nur lokal, nicht im CI:
// jeder Test trägt dafür das Tag @local (E2E-Tor, siehe docs/decisions.md) – auch jeder künftige.

async function waitGatheringAndGetSdp(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const pc = (window as unknown as { __pc: RTCPeerConnection }).__pc;
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(resolve, 2500);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return pc.localDescription?.sdp ?? '';
  });
}

async function setupPeer(page: Page, greeting: string): Promise<void> {
  await page.evaluate(async (text) => {
    const w = window as unknown as Record<string, unknown>;
    // Kamera zuerst: erst die Berechtigung, dann die PeerConnection (Plan A des Designs).
    w.__stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const pc = new RTCPeerConnection({ iceServers: [] });
    const dc = pc.createDataChannel('events', { negotiated: true, id: 1 });
    w.__pc = pc;
    w.__received = new Promise<string>((resolve) => {
      dc.onmessage = (event) => resolve(String(event.data));
    });
    dc.onopen = () => dc.send(text);
  }, greeting);
}

test('(a) zwei Seiten verbinden sich per echter RTCPeerConnection (ohne STUN, Kamera erlaubt)', { tag: '@local' }, async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('lab.html');
  await b.goto('lab.html');
  await setupPeer(a, 'hallo von A');
  await setupPeer(b, 'hallo von B');

  await a.evaluate(async () => {
    const pc = (window as unknown as { __pc: RTCPeerConnection }).__pc;
    await pc.setLocalDescription(await pc.createOffer());
  });
  const offer = await waitGatheringAndGetSdp(a);

  await b.evaluate(async (sdp) => {
    const pc = (window as unknown as { __pc: RTCPeerConnection }).__pc;
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
  }, offer);
  const answer = await waitGatheringAndGetSdp(b);

  await a.evaluate(async (sdp) => {
    const pc = (window as unknown as { __pc: RTCPeerConnection }).__pc;
    await pc.setRemoteDescription({ type: 'answer', sdp });
  }, answer);

  const receivedByA = await a.evaluate(() => (window as unknown as { __received: Promise<string> }).__received);
  const receivedByB = await b.evaluate(() => (window as unknown as { __received: Promise<string> }).__received);
  expect(receivedByA).toBe('hallo von B');
  expect(receivedByB).toBe('hallo von A');

  const candidates = offer.split(/\r?\n/).filter((line) => line.startsWith('a=candidate:'));
  const addresses = candidates.map((line) => line.split(' ')[4] ?? '');
  test.info().annotations.push({ type: 'kandidaten', description: addresses.join(', ') });
  expect(candidates.length).toBeGreaterThan(0);
  // Persistierte Kamera-Erlaubnis (playwright.config.ts: use.permissions) hebt Chromes mDNS-Verschleierung
  // auf – gemessen liefert dann jede Kandidaten-Adresse eine echte IP statt eines mDNS-Namens.
  expect(addresses.filter((address) => address.endsWith('.local'))).toHaveLength(0);
});

test('(a2) ohne persistierte Kamera-Erlaubnis liefert Chrome mDNS-Namen statt IPs', { tag: '@local' }, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, permissions: [] });
  try {
    const page = await context.newPage();
    await page.goto('lab.html');
    await setupPeer(page, 'hallo ohne Erlaubnis');
    await page.evaluate(async () => {
      const pc = (window as unknown as { __pc: RTCPeerConnection }).__pc;
      await pc.setLocalDescription(await pc.createOffer());
    });
    const offer = await waitGatheringAndGetSdp(page);
    const hostCandidates = offer
      .split(/\r?\n/)
      .filter((line) => line.startsWith('a=candidate:'))
      .filter((line) => line.split(' ')[7] === 'host');
    const addresses = hostCandidates.map((line) => line.split(' ')[4] ?? '');
    test.info().annotations.push({ type: 'kandidaten (a2)', description: addresses.join(', ') });
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.every((address) => address.endsWith('.local'))).toBe(true);
  } finally {
    await context.close();
  }
});

test('(b) Offline-Emulation schaltet das Netz der Seite ab und wieder an', { tag: '@local' }, async ({ context, page }) => {
  await page.goto('lab.html');
  const probe = (): Promise<boolean> =>
    page.evaluate(() => fetch(`version.json?t=${Math.random()}`, { cache: 'no-store' }).then((r) => r.ok, () => false));
  expect(await probe()).toBe(true);
  await context.setOffline(true);
  expect(await probe()).toBe(false);
  await context.setOffline(false);
  expect(await probe()).toBe(true);
});

test('(c) WebGL2 rendert und der Screenshot ist nicht schwarz', { tag: '@local' }, async ({ page }) => {
  await page.goto('lab.html');
  const info = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.id = 'gl';
    canvas.width = 200;
    canvas.height = 100;
    canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
    document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (gl === null) return { ok: false, renderer: '' };
    gl.clearColor(1, 0.5, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const renderer = ext === null ? 'unbekannt' : String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    return { ok: true, renderer: `${renderer} | GPU-Timer: ${timer === null ? 'nein' : 'ja'}` };
  });
  expect(info.ok).toBe(true);
  test.info().annotations.push({ type: 'renderer', description: info.renderer });

  const shot = await page.locator('#gl').screenshot();
  const pixel = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return [0, 0, 0];
    ctx.drawImage(image, 0, 0);
    const d = ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
  }, shot.toString('base64'));
  expect(pixel[0]).toBeGreaterThan(200);
  expect(pixel[1]).toBeGreaterThan(90);
  expect(pixel[2]).toBeLessThan(60);
});
