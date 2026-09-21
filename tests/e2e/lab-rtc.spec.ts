import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { LabHook } from '../../src/lab/labHook';
import type { ClientJoin, HostLobby } from '../../src/net/connector';
import type { MessageRouter } from '../../src/net/messageRouter';
import type { PingStats } from '../../src/net/pingTest';
import type { RtcPeer } from '../../src/net/rtcTransport';

// Echter WebRTC-Handshake über den Text-Pfad (ohne STUN) zwischen zwei Seiten – getrieben über den
// Test-Haken `window.__mbLab` (nur mit `?hook=1`). NUR LOKAL (Tag @local): im CI gibt es weder eine
// verlässliche Netzwerkschnittstelle noch die persistierte Kamera-Erlaubnis für echte Host-IPs.
// Payloads enthalten echte Adressen dieses Rechners → nie ausgeben, annotieren oder speichern.

interface LabWindow {
  __mbLab: LabHook;
  __lobby?: HostLobby;
  __join?: ClientJoin;
  __peer?: RtcPeer;
  __router?: MessageRouter;
}

const HOOK_URL = 'lab.html?hook=1';

async function openLab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(HOOK_URL);
  // Kurzer Timeout: fehlt der Haken (alter Build, ?hook=1 vergessen), scheitert der Test in 10 s statt in 60.
  await page.waitForFunction(() => '__mbLab' in window, undefined, { timeout: 10_000 });
  return page;
}

/** Router + Pong-Antworter auf dem fertigen Transport dieser Seite. */
async function attachRouter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as LabWindow;
    if (w.__peer === undefined) throw new Error('Peer fehlt');
    w.__router = w.__mbLab.createMessageRouter(w.__peer.transport);
    w.__mbLab.attachPongResponder(w.__router);
  });
}

async function waitUntilOpen(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as LabWindow).__peer?.transport.state === 'open', undefined, { timeout: 15_000 });
}

async function pingBothChannels(page: Page): Promise<{ state: PingStats; events: PingStats }> {
  return page.evaluate(async () => {
    const w = window as unknown as LabWindow;
    if (w.__router === undefined) throw new Error('Router fehlt');
    const options = { count: 20, intervalMs: 33, timeoutMs: 2000, now: () => performance.now() };
    const events = await w.__mbLab.runPingSeries(w.__router, 'events', options);
    const state = await w.__mbLab.runPingSeries(w.__router, 'state', options);
    return { state, events };
  });
}

test('Text-Pfad: zwei Seiten verbinden sich per echtem WebRTC und pingen auf beiden Kanälen', { tag: '@local' }, async ({ context }) => {
  const host = await openLab(context);
  const client = await openLab(context);

  const offer = await host.evaluate(async () => {
    const w = window as unknown as LabWindow;
    const lab = w.__mbLab;
    const lobby = lab.createHostLobby({
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
    });
    w.__lobby = lobby;
    const made = await lobby.createOffer(1);
    return { payload: made.payload, gather: made.gather, textChars: made.sizes.textChars, role: made.desc.role, slot: made.desc.slot, nonce: made.desc.nonce };
  });
  expect(offer.payload.startsWith('MB1.')).toBe(true);
  expect(offer.role).toBe('offer');
  expect(offer.slot).toBe(1);
  expect(offer.gather.gathered).toBeGreaterThan(0);
  // Der Codec filtert nichts: alles Gesammelte wird übertragen.
  expect(offer.gather.transmitted).toBe(offer.gather.gathered);
  expect(offer.textChars).toBe(offer.payload.length);
  // Nur die ANZAHL in der Meldung – nie den Payload selbst (enthält echte Adressen).
  const offerLimit = offer.gather.gathered <= 4 ? 800 : 1100; // ≤ 4 Kandidaten: Spec-Ziel 800; darüber gilt die QR-Reserve aus M2 (~1100)
  expect(offer.textChars, `Angebot mit ${offer.gather.gathered} Kandidaten`).toBeLessThanOrEqual(offerLimit);

  const answer = await client.evaluate(async (payload) => {
    const w = window as unknown as LabWindow;
    const lab = w.__mbLab;
    const join = lab.createClientJoin({
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => 0,
    });
    w.__join = join;
    const made = await join.acceptOffer(payload);
    if (join.peer === null) throw new Error('Client-Peer fehlt');
    w.__peer = join.peer;
    return { payload: made.payload, gather: made.gather, textChars: made.sizes.textChars, role: made.desc.role, slot: made.desc.slot, nonce: made.desc.nonce, joinSlot: join.slot };
  }, offer.payload);
  expect(answer.role).toBe('answer');
  // Die Antwort trägt Slot und Nonce des Angebots.
  expect(answer.slot).toBe(offer.slot);
  expect(answer.joinSlot).toBe(offer.slot);
  expect(answer.nonce).toBe(offer.nonce);
  expect(answer.gather.gathered).toBeGreaterThan(0);
  expect(answer.gather.transmitted).toBe(answer.gather.gathered);
  const answerLimit = answer.gather.gathered <= 4 ? 800 : 1100; // ≤ 4 Kandidaten: Spec-Ziel 800; darüber gilt die QR-Reserve aus M2 (~1100)
  expect(answer.textChars, `Antwort mit ${answer.gather.gathered} Kandidaten`).toBeLessThanOrEqual(answerLimit);

  await host.evaluate(async (payload) => {
    const w = window as unknown as LabWindow;
    if (w.__lobby === undefined) throw new Error('Lobby fehlt');
    w.__peer = await w.__lobby.acceptAnswer(1, payload);
  }, answer.payload);

  await attachRouter(host);
  await attachRouter(client);
  await waitUntilOpen(host);
  await waitUntilOpen(client);

  const fromHost = await pingBothChannels(host);
  const fromClient = await pingBothChannels(client);
  for (const stats of [fromHost, fromClient]) {
    expect(stats.events.sent).toBe(20);
    expect(stats.events.received).toBe(20); // zuverlässiger Kanal: nichts geht verloren
    expect(stats.events.outOfOrder).toBe(0);
    expect(stats.state.sent).toBe(20);
    expect(stats.state.received).toBeGreaterThanOrEqual(18); // unzuverlässiger Kanal: Verlust erlaubt
  }

  // Zeitleiste: Kanäle offen, und Kandidaten-Einträge nennen nur Typ/Familie – nie eine Adresse.
  const hostTimeline = await host.evaluate(() => {
    const w = window as unknown as LabWindow;
    return [...(w.__lobby?.entries().get(1)?.timeline.events() ?? [])].map((event) => ({ kind: event.kind, detail: event.detail }));
  });
  const kinds = hostTimeline.map((event) => event.kind);
  expect(kinds[0]).toBe('pc-created');
  expect(kinds).toContain('channel-open:state');
  expect(kinds).toContain('channel-open:events');
  const candidateDetails = hostTimeline.filter((event) => event.kind === 'candidate').map((event) => event.detail);
  expect(candidateDetails).toHaveLength(offer.gather.gathered);
  for (const detail of candidateDetails) expect(detail).toMatch(/^[a-z]+\/(?:ipv4|ipv6|mdns|other)$/);

  // close() auf der einen Seite → die andere sieht 'closed' (Kanal-Ende nach „war offen").
  await host.evaluate(() => (window as unknown as LabWindow).__lobby?.closeAll());
  await client.waitForFunction(() => (window as unknown as LabWindow).__peer?.transport.state === 'closed', undefined, { timeout: 15_000 });
  expect(await host.evaluate(() => (window as unknown as LabWindow).__peer?.transport.state)).toBe('closed');
  expect(await client.evaluate(() => (window as unknown as LabWindow).__peer?.transport.send('events', new Uint8Array([1])))).toBe(false);
});

test('Ungültige Codes enden als HandshakeError F5 – die richtige Antwort wird danach noch angenommen', { tag: '@local' }, async ({ context }) => {
  const page = await openLab(context);
  const result = await page.evaluate(async () => {
    const lab = (window as unknown as LabWindow).__mbLab;
    let nonce = 100;
    const deps = {
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => (nonce += 1),
    };
    const failureOf = async (run: () => Promise<unknown>): Promise<string> => {
      try {
        await run();
        return 'kein Fehler';
      } catch (error) {
        return error instanceof Error && error.name === 'HandshakeError' && 'failure' in error ? String(error.failure) : `unerwartet: ${String(error)}`;
      }
    };
    const lobbyA = lab.createHostLobby(deps);
    const lobbyB = lab.createHostLobby(deps);
    const join = lab.createClientJoin(deps);
    const offerA = await lobbyA.createOffer(1);
    const offerB = await lobbyB.createOffer(1);
    const answerB = await join.acceptOffer(offerB.payload);
    const outcome = {
      noncesDiffer: offerA.desc.nonce !== offerB.desc.nonce,
      garbageAnswer: await failureOf(() => lobbyA.acceptAnswer(1, 'das ist kein Code')),
      garbageOffer: await failureOf(() => lab.createClientJoin(deps).acceptOffer('MB1.d.%%%')),
      emptyOffer: await failureOf(() => lab.createClientJoin(deps).acceptOffer('   ')),
      offerAsAnswer: await failureOf(() => lobbyA.acceptAnswer(1, offerA.payload)),
      answerAsOffer: await failureOf(() => lab.createClientJoin(deps).acceptOffer(answerB.payload)),
      wrongNonce: await failureOf(() => lobbyA.acceptAnswer(1, answerB.payload)),
      emptySlot: await failureOf(() => lobbyA.acceptAnswer(2, answerB.payload)),
      wrongProtocol: await failureOf(() => lab.createClientJoin({ ...deps, protoV: lab.PROTOCOL_VERSION + 1 }).acceptOffer(offerA.payload)),
      stillPending: lobbyA.entries().get(1)?.remoteSdp === null,
      rightAnswer: await failureOf(() => lobbyB.acceptAnswer(1, answerB.payload)),
      answerTwice: await failureOf(() => lobbyB.acceptAnswer(1, answerB.payload)),
    };
    lobbyA.closeAll();
    lobbyB.closeAll();
    join.close();
    return { ...outcome, entriesAfterClose: lobbyA.entries().size + lobbyB.entries().size, peerAfterClose: join.peer === null };
  });

  expect(result).toEqual({
    noncesDiffer: true,
    garbageAnswer: 'F5',
    garbageOffer: 'F5',
    emptyOffer: 'F5',
    offerAsAnswer: 'F5',
    answerAsOffer: 'F5',
    wrongNonce: 'F5',
    emptySlot: 'F5',
    wrongProtocol: 'F5',
    stillPending: true,
    rightAnswer: 'kein Fehler',
    answerTwice: 'F5',
    entriesAfterClose: 0,
    peerAfterClose: true,
  });
});

test('ohne ?hook=1 gibt es keinen Test-Haken', { tag: '@local' }, async ({ page }) => {
  await page.goto('lab.html');
  await expect(page.getByTestId('shell-title')).toBeVisible();
  expect(await page.evaluate(() => '__mbLab' in window)).toBe(false);
});
