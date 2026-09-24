import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { S } from '../../src/ui/strings';
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

test('Slot außerhalb 1..3 ist ein RangeError und legt keinen Eintrag an', { tag: '@local' }, async ({ context }) => {
  const page = await openLab(context);
  const result = await page.evaluate(async () => {
    const lab = (window as unknown as LabWindow).__mbLab;
    const lobby = lab.createHostLobby({
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => 1,
    });
    // Fehlerobjekte überleben `page.evaluate` nicht (DOMException schon gar nicht) – nur der Name verlässt die Seite.
    const nameOf = (work: Promise<unknown>): Promise<string> =>
      work.then(() => 'kein Fehler', (error: unknown) => (error instanceof Error ? error.name : String(error)));
    const tooSmall = await nameOf(lobby.createOffer(0));
    const tooBig = await nameOf(lobby.createOffer(4));
    const outcome = { tooSmall, tooBig, entries: lobby.entries().size };
    lobby.closeAll();
    return outcome;
  });
  expect(result).toEqual({ tooSmall: 'RangeError', tooBig: 'RangeError', entries: 0 });
});

test('closeSlot während des Gatherings bricht das laufende createOffer mit AbortError ab', { tag: '@local' }, async ({ context }) => {
  const page = await openLab(context);
  const result = await page.evaluate(async () => {
    const lab = (window as unknown as LabWindow).__mbLab;
    const lobby = lab.createHostLobby({
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => 1,
    });
    const nameOf = (work: Promise<unknown>): Promise<string> =>
      work.then(() => 'kein Fehler', (error: unknown) => (error instanceof Error ? error.name : String(error)));
    // Ohne jedes Warten dazwischen: `createOffer` hat den Peer schon angelegt, das Gathering dauert hier
    // rund 130 ms – der Abbruch trifft es also sicher mitten im Lauf.
    const pending = lobby.createOffer(1);
    lobby.closeSlot(1);
    const outcome = { aborted: await nameOf(pending), hasSlot1: lobby.entries().has(1), entries: lobby.entries().size };
    lobby.closeAll();
    return outcome;
  });
  expect(result).toEqual({ aborted: 'AbortError', hasSlot1: false, entries: 0 });
});

test('ein zweites createOffer überholt das erste – mit dem zweiten Code kommt die Verbindung zustande', { tag: '@local' }, async ({ context }) => {
  const host = await openLab(context);
  const client = await openLab(context);

  const raced = await host.evaluate(async () => {
    const w = window as unknown as LabWindow;
    const lab = w.__mbLab;
    const lobby = lab.createHostLobby({
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
    });
    w.__lobby = lobby;
    const nameOf = (work: Promise<unknown>): Promise<string> =>
      work.then(() => 'kein Fehler', (error: unknown) => (error instanceof Error ? error.name : String(error)));
    const first = lobby.createOffer(1);
    const second = lobby.createOffer(1);
    const firstName = await nameOf(first);
    const winner = await second;
    // Der Vergleich der Payloads bleibt in der Seite – nach draußen geht nur das Ergebnis (ein Bool).
    return {
      firstName,
      entryIsSecond: lobby.entries().get(1)?.offer.payload === winner.payload,
      entries: lobby.entries().size,
      payload: winner.payload,
    };
  });
  expect(raced.firstName).toBe('AbortError');
  expect(raced.entryIsSecond).toBe(true);
  expect(raced.entries).toBe(1);

  const answerPayload = await client.evaluate(async (payload) => {
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
    return made.payload;
  }, raced.payload);

  await host.evaluate(async (payload) => {
    const w = window as unknown as LabWindow;
    if (w.__lobby === undefined) throw new Error('Lobby fehlt');
    w.__peer = await w.__lobby.acceptAnswer(1, payload);
  }, answerPayload);

  await waitUntilOpen(host);
  await waitUntilOpen(client);
  await host.evaluate(() => (window as unknown as LabWindow).__lobby?.closeAll());
});

test('close() während des Gatherings bricht acceptOffer des Clients mit AbortError ab', { tag: '@local' }, async ({ context }) => {
  const page = await openLab(context);
  const result = await page.evaluate(async () => {
    const lab = (window as unknown as LabWindow).__mbLab;
    const deps = {
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => 1,
    };
    const nameOf = (work: Promise<unknown>): Promise<string> =>
      work.then(() => 'kein Fehler', (error: unknown) => (error instanceof Error ? error.name : String(error)));
    const lobby = lab.createHostLobby(deps);
    const offer = await lobby.createOffer(1);

    // `acceptOffer` entschlüsselt ZUERST (asynchron) und legt den Peer erst danach an – vor dem Peer gibt es
    // nichts abzubrechen. Auf `join.peer !== null` zu warten wäre ein Wettlauf: das Gathering der ANTWORT
    // dauert hier nur wenige Millisekunden (gemessen 4 ms). Deshalb ereignisgesteuert statt zeitgesteuert:
    // Der Abbruch hängt am ERSTEN Kandidaten-Eintrag der Zeitleiste und fällt damit zwangsläufig mitten ins
    // Gathering – ohne jedes Warten.
    let onCandidate: (() => void) | null = null;
    let candidates = 0;
    const join = lab.createClientJoin({
      ...deps,
      makeTimeline: () => {
        const inner = lab.createTimeline(() => performance.now());
        return {
          push: (kind: string, detail?: string) => {
            inner.push(kind, detail);
            if (kind !== 'candidate') return;
            candidates += 1;
            onCandidate?.();
          },
          events: () => inner.events(),
        };
      },
    });
    onCandidate = () => {
      onCandidate = null; // nur beim allerersten Kandidaten schließen
      join.close();
    };
    const outcome = {
      aborted: await nameOf(join.acceptOffer(offer.payload)),
      sawCandidate: candidates > 0,
      peerAfter: join.peer === null,
    };
    lobby.closeAll();
    return outcome;
  });
  expect(result).toEqual({ aborted: 'AbortError', sawCandidate: true, peerAfter: true });
});

test('close() schon während des Dekodierens überholt die Annahme', { tag: '@local' }, async ({ context }) => {
  const page = await openLab(context);
  const result = await page.evaluate(async () => {
    const lab = (window as unknown as LabWindow).__mbLab;
    const deps = {
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => 1,
    };
    const nameOf = (work: Promise<unknown>): Promise<string> =>
      work.then(() => 'kein Fehler', (error: unknown) => (error instanceof Error ? error.name : String(error)));
    const lobby = lab.createHostLobby(deps);
    const offer = await lobby.createOffer(1);
    const join = lab.createClientJoin(deps);
    // Ohne jedes Warten dazwischen: der Abbruch fällt in das Fenster, in dem `acceptOffer` noch entschlüsselt
    // und den Peer deshalb NOCH NICHT angelegt hat.
    const pending = join.acceptOffer(offer.payload);
    join.close();
    const outcome = {
      aborted: await nameOf(pending),
      peerNull: join.peer === null,
      timelineNull: join.timeline === null,
      slotNull: join.slot === null,
    };
    lobby.closeAll();
    return outcome;
  });
  expect(result).toEqual({ aborted: 'AbortError', peerNull: true, timelineNull: true, slotNull: true });
});

test('ein zweites acceptOffer überholt das erste – auch wenn beide noch dekodieren', { tag: '@local' }, async ({ context }) => {
  const page = await openLab(context);
  const raced = await page.evaluate(async () => {
    const w = window as unknown as LabWindow;
    const lab = w.__mbLab;
    let nonce = 100;
    const deps = {
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => (nonce += 1),
    };
    const nameOf = (work: Promise<unknown>): Promise<string> =>
      work.then(() => 'kein Fehler', (error: unknown) => (error instanceof Error ? error.name : String(error)));
    const lobby = lab.createHostLobby(deps);
    w.__lobby = lobby;
    const offerA = await lobby.createOffer(1);
    const offerB = await lobby.createOffer(2);
    const join = lab.createClientJoin(deps);
    w.__join = join;
    // Beide Aufrufe im selben Zug – der zweite überholt den ersten, noch bevor einer von beiden
    // mit dem Entschlüsseln fertig ist.
    const first = join.acceptOffer(offerA.payload);
    const second = join.acceptOffer(offerB.payload);
    const firstName = await nameOf(first);
    const answerB = await second;
    // Der Host nimmt die Antwort auf sein ZWEITES Angebot an; beide Seiten liegen hier in derselben Seite.
    w.__peer = await lobby.acceptAnswer(2, answerB.payload);
    return { firstName, joinSlot: join.slot, slotB: offerB.desc.slot, answerSlot: answerB.desc.slot };
  });
  expect(raced.firstName).toBe('AbortError');
  expect(raced.slotB).toBe(2);
  expect(raced.joinSlot).toBe(raced.slotB);
  expect(raced.answerSlot).toBe(raced.slotB);

  // Die überholte Annahme hat nichts kaputt gemacht: mit Angebot B kommt die Verbindung zustande.
  await page.waitForFunction(
    () => {
      const w = window as unknown as LabWindow;
      return w.__peer?.transport.state === 'open' && w.__join?.peer?.transport.state === 'open';
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.evaluate(() => (window as unknown as LabWindow).__lobby?.closeAll());
});

test('ein überholter Versuch meldet AbortError statt F5 – auch bei kaputtem Code', { tag: '@local' }, async ({ context }) => {
  const page = await openLab(context);
  const result = await page.evaluate(async () => {
    const lab = (window as unknown as LabWindow).__mbLab;
    const join = lab.createClientJoin({
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => 1,
    });
    const nameOf = (work: Promise<unknown>): Promise<string> =>
      work.then(() => 'kein Fehler', (error: unknown) => (error instanceof Error ? error.name : String(error)));
    // Der Nutzer hat selbst abgebrochen – dann darf ihn der kaputte Code nicht mehr als F5 einholen.
    const pending = join.acceptOffer('MB1.d.garbage');
    join.close();
    return { aborted: await nameOf(pending), peerNull: join.peer === null };
  });
  expect(result).toEqual({ aborted: 'AbortError', peerNull: true });
});

test('ohne RTCPeerConnection meldet der Connector F6', { tag: '@local' }, async ({ context }) => {
  const page = await context.newPage();
  // Vor jedem Seitenskript: der Browser sieht aus wie einer ohne WebRTC.
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target.RTCPeerConnection;
    delete target.webkitRTCPeerConnection;
  });
  await page.goto(HOOK_URL);
  await page.waitForFunction(() => '__mbLab' in window, undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => 'RTCPeerConnection' in window)).toBe(false);

  const result = await page.evaluate(async () => {
    const lab = (window as unknown as LabWindow).__mbLab;
    const lobby = lab.createHostLobby({
      protoV: lab.PROTOCOL_VERSION,
      makeTimeline: () => lab.createTimeline(() => performance.now()),
      randomNonce: () => 1,
    });
    try {
      await lobby.createOffer(1);
      return { name: 'kein Fehler', failure: '', entries: lobby.entries().size };
    } catch (error) {
      return {
        name: error instanceof Error ? error.name : String(error),
        failure: error instanceof Error && 'failure' in error ? String(error.failure) : '',
        entries: lobby.entries().size,
      };
    }
  });
  expect(result).toEqual({ name: 'HandshakeError', failure: 'F6', entries: 0 });
});

test('ohne ?hook=1 gibt es keinen Test-Haken', { tag: '@local' }, async ({ page }) => {
  await page.goto('lab.html');
  await expect(page.getByTestId('shell-title')).toBeVisible();
  expect(await page.evaluate(() => '__mbLab' in window)).toBe(false);
});

// ───────── Labor-UI über den Text-Pfad (Task 8) ─────────
// Der Ablauf zweier Menschen mit zwei Geräten – durch die echte Oberfläche, mit echtem WebRTC. NUR LOKAL (@local).
// Codes und Reports enthalten echte Adressen → aus der Seite kommen nur Anzahlen und Wahrheitswerte zurück.
const UI_REPORTS_KEY = 'maeusebau.lab.reports.v1';
interface UiStoredReport {
  cell: { role: string; path: string }; valid: boolean; failures: string[];
  gather: { gathered: unknown[]; transmitted: number } | null; payloadSizes: { textChars: number } | null; selectedPair: object | null;
  hello: { versionMatch: boolean } | null; ping: { events: { sent: number; lossPct: number } | null; state: { sent: number } | null };
}
async function uiReportFacts(page: Page) {
  return page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '[]') as UiStoredReport[]).map((report) => ({
    role: report.cell.role, path: report.cell.path, valid: report.valid, failures: report.failures,
    gathered: report.gather?.gathered.length ?? -1, transmitted: report.gather?.transmitted ?? -2, textChars: report.payloadSizes?.textChars ?? 0,
    hasPair: report.selectedPair !== null, versionMatch: report.hello?.versionMatch ?? false,
    eventsSent: report.ping.events?.sent ?? 0, eventsLossPct: report.ping.events?.lossPct ?? -1, stateSent: report.ping.state?.sent ?? 0,
  })), UI_REPORTS_KEY);
}
/**
 * Zwischenablage IN der Seite auswerten: Dieser Lauf hat ECHTE Kandidaten, deshalb verlässt der Text
 * die Seite nie – nach außen gehen nur Wahrheitswerte. Ausgenommen von der Adress-Suche ist der
 * User-Agent: Task 7 lässt ihn bewusst bytegleich, und seine Versionsnummern (…/153.0.0.0) sähen
 * sonst wie eine IPv4-Adresse aus. Uhrzeiten („T20:13:49") sind keine IPv6-Adressen – dieselbe
 * Ausnahme kennt `redactReport` selbst.
 */
async function uiClipboardFacts(page: Page) {
  return page.evaluate(async () => {
    const text = await navigator.clipboard.readText();
    const body = text.replace(/"userAgent":\s*"[^"]*"/g, '"userAgent": "…"').replace(/^\s*Browser:.*$/gm, '  Browser: …');
    // Erste Gruppe `{0,4}`: eine Adresse darf auch mit „::" beginnen (wie in der Selbsttest-Probe unten).
    const ipv6 = (body.match(/[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}/gi) ?? []).filter((hit) => !/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(hit));
    return {
      isText: text.startsWith('Mäusebau-Laborbericht'),
      isJson: text.trimStart().startsWith('['),
      tokens: /(?:ipv4|ipv6|mdns|other)\/[a-z-]+#\d+/.test(body),
      ipv4: /\d{1,3}(?:\.\d{1,3}){3}/.test(body),
      ipv6: ipv6.length > 0,
      mdns: /\.local\b/i.test(body),
    };
  });
}
async function uiLabelCell(page: Page, role: 'host' | 'client', device: string): Promise<void> {
  await page.getByTestId('cell-device').fill(device);
  await page.getByTestId(`cell-role-${role}`).check();
  await page.getByTestId('cell-camera-an').check();
  await page.getByTestId('cell-confirm').click();
  await page.getByTestId('camera-start').click();
  await expect(page.getByTestId('camera-state')).toHaveAttribute('data-state', 'ready');
}
test('Labor-UI: Host und Client verbinden sich per Text-Code und speichern je einen gültigen Report', { tag: '@local' }, async ({ context }) => {
  // `grantPermissions` ist ADDITIV: playwright-core führt die Liste mit den schon erteilten Rechten des
  // Kontexts zusammen (hier `permissions: ['camera']` aus playwright.config.ts), statt sie zu ersetzen.
  // Die Kamera-Erlaubnis bleibt also erhalten – nachgeprüft im Selbsttest weiter unten.
  await context.grantPermissions(['local-network-access', 'clipboard-read', 'clipboard-write']);
  const host = await context.newPage();
  const client = await context.newPage();
  await host.goto('lab.html?quick=1');
  await client.goto('lab.html?quick=1');
  await uiLabelCell(host, 'host', 'UI-Host');
  await uiLabelCell(client, 'client', 'UI-Client');
  await host.getByTestId('add-player').click();
  const offerOut = host.getByTestId('slot-1').getByTestId('offer-out');
  await expect.poll(async () => (await offerOut.inputValue()).startsWith('MB1.'), { timeout: 10_000 }).toBe(true);
  await client.getByTestId('offer-in').fill(await offerOut.inputValue());
  await client.getByTestId('make-answer').click();
  const answerOut = client.getByTestId('answer-out');
  await expect.poll(async () => (await answerOut.inputValue()).startsWith('MB1.'), { timeout: 10_000 }).toBe(true);
  const connect = host.getByTestId('slot-1').getByTestId('connect');
  // Erst der Fehlschlag: ein kaputter Code gibt den Knopf für den nächsten Versuch wieder frei.
  await host.getByTestId('slot-1').getByTestId('answer-in').fill('das ist kein Code');
  await connect.click();
  await expect(host.getByTestId('slot-1').getByRole('alert').filter({ hasText: S.failures.F5.title })).toBeVisible();
  await expect(connect, 'nach einem Fehlschlag wieder frei').toBeEnabled();

  await host.getByTestId('slot-1').getByTestId('answer-in').fill(await answerOut.inputValue());
  // Der Knopf sperrt sich SYNCHRON im Tipp – ein zweiter Tipp käme sonst als rotes F5 neben das grüne
  // „verbunden". Im selben Zug geklickt und gelesen, damit die Zusage ohne Zeitfenster geprüft wird.
  const lockedOnTap = await connect.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    return button.disabled;
  });
  expect(lockedOnTap, 'Verbinden sperrt sich beim Tipp selbst').toBe(true);
  await expect(host.getByTestId('slot-1').getByTestId('conn-state')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  // … und bleibt nach der angenommenen Antwort gesperrt (das Code-Feld ist dann ohnehin ausgeblendet).
  await expect(connect, 'nach der angenommenen Antwort gesperrt').toBeDisabled();
  await expect(client.getByTestId('conn-state')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  // Der Client misst von selbst; erst danach startet der Host (beide Tabs teilen sich den localStorage).
  await expect.poll(async () => (await uiReportFacts(client)).length, { timeout: 20_000 }).toBe(1);
  await host.getByTestId('slot-1').getByTestId('start-ping').click();
  await expect.poll(async () => (await uiReportFacts(host)).length, { timeout: 20_000 }).toBe(2);
  const facts = await uiReportFacts(host);
  expect(facts.map((entry) => entry.role).sort()).toEqual(['client', 'host']);
  for (const entry of facts) {
    expect(entry).toMatchObject({ path: 'text', valid: true, failures: [], hasPair: true, versionMatch: true, eventsSent: 20, eventsLossPct: 0, stateSent: 20 });
    expect(entry.gathered).toBeGreaterThan(0);
    expect(entry.transmitted).toBe(entry.gathered);
    expect(entry.textChars).toBeGreaterThan(0);
  }

  // ── Schwärzungs-Naht, geprüft an ECHTEN Kandidaten dieses Rechners ──
  // „Alle kopieren" ist immer anonymisiert: Tokens statt Adressen.
  await host.bringToFront();
  await host.getByTestId('reports-copy-all').click();
  expect(await uiClipboardFacts(host)).toEqual({ isText: false, isJson: true, tokens: true, ipv4: false, ipv6: false, mdns: false });

  // Einzel-Report ohne Haken: anonymisierter TEXT – er nennt Kandidaten nur nach Art und Anzahl,
  // führt also weder Adressen noch Tokens auf.
  await host.getByTestId('report-copy').first().click();
  expect(await uiClipboardFacts(host)).toEqual({ isText: true, isJson: false, tokens: false, ipv4: false, ipv6: false, mdns: false });

  // Mit Haken: JSON MIT echten Adressen (der Entwicklerpfad). Geprüft wird nur, DASS Adressen drinstehen.
  await host.getByTestId('with-addresses').check();
  await host.getByTestId('report-copy').first().click();
  const withAddresses = await uiClipboardFacts(host);
  expect(withAddresses.isJson, 'Einzel-Report mit Adressen ist JSON').toBe(true);
  expect(withAddresses.tokens, 'ungeschwärzt: keine Platzhalter').toBe(false);
  // `mdns` gehört dazu: auf einem Rechner ohne Kamera-Erlaubnis gibt es nur verschleierte Namen.
  expect(withAddresses.ipv4 || withAddresses.ipv6 || withAddresses.mdns, 'ungeschwärzt: echte Adressen vorhanden').toBe(true);

  await expect(host.getByTestId('reports-copy-raw')).toBeVisible();
  await expect(host.getByText(S.lab.reports.rawWarning)).toBeVisible();
});

// ───────── Sperrbildschirm-Test (Task 5) ─────────
// Der echte Lauf dauert 10–60 s Sperrzeit plus Ping-Serie (bis zu ~90 s je Lauf, siehe Plan). Hier wird
// NUR das Ereignis gefälscht: `document.hidden` überschrieben und `visibilitychange` von Hand ausgelöst.
// Damit prüft der Test die Naht (Messung, Report-Feld, „Neu verbinden") in Sekunden; die echten Dauern
// misst der Nutzer in Sitzung A. Codes enthalten echte Adressen → der Vergleich passiert IN der Seite.

/**
 * Zelle beschriften und den QR-Pfad wählen. Dort öffnet die Kamera-Karte den Stream SELBST (D5/C3) –
 * „Kamera einschalten" ist gesperrt, ein Klick darauf liefe in die Zeitüberschreitung.
 */
async function uiLabelCellQr(page: Page, role: 'host' | 'client', device: string): Promise<void> {
  await page.getByTestId('cell-device').fill(device);
  await page.getByTestId(`cell-role-${role}`).check();
  await page.getByTestId('cell-camera-an').check();
  await page.getByTestId('cell-path-choice-qr').check();
  await page.getByTestId('cell-confirm').click();
  await expect(page.getByTestId('camera-state')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
}

/**
 * „Steht schon ein Code im Feld?" – die Prüfung läuft IN der Seite, heraus kommt nur ein
 * Wahrheitswert. Der Payload selbst trägt echte Adressen dieses Rechners und bleibt deshalb dort.
 */
const hasPayload = (area: Locator): Promise<boolean> =>
  area.evaluate((node) => node instanceof HTMLTextAreaElement && node.value.startsWith('MB1.'));

/** Angebot → Antwort → verbinden, bis beide Seiten „verbunden" zeigen. */
async function uiHandshake(host: Page, client: Page): Promise<void> {
  const slot = host.getByTestId('slot-1');
  const offerOut = slot.getByTestId('offer-out');
  await expect.poll(() => hasPayload(offerOut), { timeout: 15_000 }).toBe(true);
  await client.getByTestId('offer-in').fill(await offerOut.inputValue());
  await client.getByTestId('make-answer').click();
  const answerOut = client.getByTestId('answer-out');
  await expect.poll(() => hasPayload(answerOut), { timeout: 15_000 }).toBe(true);
  await slot.getByTestId('answer-in').fill(await answerOut.inputValue());
  await slot.getByTestId('connect').click();
  await expect(slot.getByTestId('conn-state')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(client.getByTestId('conn-state')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
}

/**
 * Sperrbildschirm vortäuschen. `hidden`/`visibilityState` sind Getter auf `Document.prototype`; eine
 * eigene Eigenschaft auf dem Dokument überdeckt sie (in Chromium 153 geprüft). Das Ereignis feuert der
 * Browser dann nicht selbst – also von Hand.
 */
async function fakeVisibility(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (isHidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Nur Zahlen und Wahrheitswerte aus den gespeicherten Host-Reports mit Sperrtest. */
interface StoredLockReport {
  cell: { role: string };
  timeline: { kind: string }[];
  lockTest: { runs: { plannedSeconds: number; hiddenMs: number; transportAfter: string; trackAfter: string; reconnected: boolean; pingAfter: { events: { sent: number } | null; state: { sent: number } | null } | null }[] } | null;
}
async function lockFacts(page: Page) {
  return page.evaluate((key) => {
    const reports = JSON.parse(localStorage.getItem(key) ?? '[]') as StoredLockReport[];
    return reports
      .filter((report) => report.cell.role === 'host' && report.lockTest !== null)
      .map((report) => {
        const runs = report.lockTest?.runs ?? [];
        const first = runs[0];
        return {
          runs: runs.length,
          plannedSeconds: first?.plannedSeconds ?? -1,
          hiddenMsIsNumber: typeof first?.hiddenMs === 'number',
          transportAfter: first?.transportAfter ?? '',
          reconnected: first?.reconnected ?? null,
          eventsSent: first?.pingAfter?.events?.sent ?? -1,
          stateSent: first?.pingAfter?.state?.sent ?? -1,
          // Nur die ANZAHL der Marken – Zeitleisten-Details verlassen die Seite nie.
          lockStarts: report.timeline.filter((event) => event.kind === 'lock:start').length,
        };
      });
  }, UI_REPORTS_KEY);
}

/**
 * Dasselbe für den CLIENT: Anzahlen und Wahrheitswerte seiner Sperrtest-Reports. Beide Seiten teilen
 * denselben Ursprung und damit denselben `localStorage` – die Rolle trennt sie.
 */
async function clientLockFacts(page: Page) {
  return page.evaluate((key) => {
    const reports = (JSON.parse(localStorage.getItem(key) ?? '[]') as StoredLockReport[])
      .filter((report) => report.cell.role === 'client' && report.lockTest !== null);
    const newest = reports[0];
    const runs = newest?.lockTest?.runs ?? [];
    return {
      reports: reports.length,
      runs: runs.length,
      transportAfter: runs[0]?.transportAfter ?? '',
      reconnected: runs[0]?.reconnected ?? null,
      // Nur die ART des Eintrags: der frische Austausch muss seine Backend-Zeile selbst mitbringen.
      hasQrBackend: (newest?.timeline ?? []).some((event) => event.kind === 'qr:backend'),
    };
  }, UI_REPORTS_KEY);
}

/**
 * Die gemessene Paarungsdauer des NEUESTEN Host-Reports (nur diese Seite speichert Host-Reports) –
 * eine Zahl, keine Adresse. Marken rasten je Name ein: teilten sich zwei Austausche eine Buchführung,
 * stünde nach „Neu verbinden" wieder exakt der Wert des toten Peers im Report.
 */
function hostPairingConnectedMs(page: Page): Promise<number | null> {
  return page.evaluate((key) => {
    const reports = JSON.parse(localStorage.getItem(key) ?? '[]') as { cell: { role: string }; pairing: { connectedMs: number | null } | null }[];
    return reports.find((report) => report.cell.role === 'host')?.pairing?.connectedMs ?? null;
  }, UI_REPORTS_KEY);
}

test('Sperrbildschirm-Test: ein gefälschtes visibilitychange misst einen Lauf, „Neu verbinden" legt ein frisches Angebot an', { tag: '@local' }, async ({ context }) => {
  // Zwei vollständige Handshakes, zwei Läufe mit je 20 Pings auf zwei Kanälen und eine Ping-Serie des
  // Sperrtests – 60 s des Projekt-Standards sind dafür zu knapp.
  test.setTimeout(150_000);
  await context.grantPermissions(['local-network-access']);
  const host = await context.newPage();
  const client = await context.newPage();
  await host.goto('lab.html?quick=1');
  await client.goto('lab.html?quick=1');
  // BEIDE Seiten stehen auf dem QR-PFAD: nur dort ist prüfbar, dass „Neu verbinden" den Scan wieder
  // aufnimmt – und das muss auf beiden Seiten gelten. Der Handshake selbst läuft über die Textfelder
  // (Rückfallweg, D7): die Datei-Fake-Kamera liefert je Browser-Start nur EINEN Code und taugt für
  // keinen echten Austausch.
  await uiLabelCellQr(host, 'host', 'Sperr-Host');
  await uiLabelCellQr(client, 'client', 'Sperr-Client');

  // ── Das Tor: „Auf Text-Pfad wechseln" ist keine Sackgasse ──
  // Der Scan läuft von selbst (C4). Wer von Hand auf Text wechselt, muss von Hand zurückkönnen:
  // `userLeftScan` sperrt allein den AUTOMATISCHEN Start.
  await expect(client.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning, { timeout: 15_000 });
  await client.getByTestId('qr-to-text').click();
  await expect(client.getByTestId('qr-video'), 'der Wechsel beendet die Schleife').toBeHidden();
  await expect(client.getByTestId('qr-retry'), 'der Weg zurück zum Scan bleibt offen').toBeVisible();
  await client.getByTestId('qr-retry').click();
  await expect(client.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning);

  await host.bringToFront();
  await host.getByTestId('add-player').click();
  const slot = host.getByTestId('slot-1');
  // Auch der HOST weicht für diesen Austausch auf den Text-Pfad aus – genau die Lage, aus der „Neu
  // verbinden" seinen QR-Block wiederbeleben muss. (Der Tipp auf „Verbinden" täte es ohnehin.)
  await expect(slot.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning, { timeout: 15_000 });
  await slot.getByTestId('qr-to-text').click();
  await uiHandshake(host, client);

  // ── Ein Lauf über 30 s ──
  await expect(slot.getByTestId('lock-block')).toBeVisible();
  // Den bisherigen Angebots-Code NUR in der Seite merken – er enthält echte Adressen dieses Rechners.
  await host.evaluate(() => {
    const area = document.querySelector('[data-testid="offer-out"]');
    (window as unknown as { __lockOffer?: string }).__lockOffer = area instanceof HTMLTextAreaElement ? area.value : '';
  });
  // Ein scharfer Lauf ist noch abbrechbar: solange nichts verdeckt war, gilt der ZULETZT getippte Knopf.
  await slot.getByTestId('lock-10').click();
  await expect(slot.getByTestId('lock-status')).toContainText('10');
  await expect(slot.getByTestId('lock-30'), 'vor dem Verdecken bleibt die Wahl offen').toBeEnabled();
  await slot.getByTestId('lock-30').click();
  await expect(slot.getByTestId('lock-status')).toContainText('30');
  await fakeVisibility(host, true);
  // Jetzt läuft die Messung – erst jetzt sind die Dauer-Knöpfe zu.
  await expect(slot.getByTestId('lock-30')).toBeDisabled();
  await fakeVisibility(host, false);
  // Während der Ping-Serie des Sperrtests bleibt „Ping-Test starten" gesperrt: zwei Serien auf
  // demselben Router messen einander.
  await expect(slot.getByTestId('start-ping'), 'kein zweiter Ping-Test in die Messung hinein').toBeDisabled();
  await expect(slot.getByTestId('lock-result')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(slot.getByTestId('lock-pings')).toContainText('events');
  await expect(slot.getByTestId('start-ping'), 'nach der Messung wieder frei').toBeEnabled();

  // Der Lauf landet im Report: geprüft werden nur Zahlen und Wahrheitswerte.
  await slot.getByTestId('start-ping').click();
  await expect.poll(async () => (await lockFacts(host)).length, { timeout: 40_000 }).toBe(1);
  expect((await lockFacts(host))[0]).toEqual({
    // `lockStarts: 1` hält fest, dass das Umschwenken von 10 auf 30 EINEN gemessenen Lauf ergibt und
    // nicht zwei Startmarken: `lock:start` gehört zur Messung, nicht zum Knopfdruck.
    runs: 1, plannedSeconds: 30, hiddenMsIsNumber: true, transportAfter: 'open', reconnected: false, eventsSent: 20, stateSent: 20, lockStarts: 1,
  });
  // Dieser Austausch hat seine Paarung gemessen; unten wird sie mit der des frischen verglichen.
  const firstPairingMs = await hostPairingConnectedMs(host);
  expect(firstPairingMs, 'der erste Austausch hat seine Paarungsdauer gemessen').not.toBeNull();

  // ── „Neu verbinden": frisches Angebot auf DEMSELBEN Platz ──
  await slot.getByTestId('lock-reconnect').click();
  // Spiegelbild zum Client: auch der HOST muss danach wieder scannen können. Ohne das Zurücksetzen
  // von `userLeftScan` bliebe sein frischer QR-Block stumm, weil er für den ALTEN Austausch auf den
  // Text-Pfad gewechselt war. Zuerst prüfen – der nächste Klick holt den Client nach vorn und
  // beendet die Schleife des Hosts (ein Scan im Hintergrund läuft nicht weiter).
  await expect(slot.getByTestId('qr-status'), 'nach „Neu verbinden" scannt auch der Host wieder').toHaveText(S.lab.qr.scanning, { timeout: 15_000 });
  await client.getByTestId('lock-reconnect').click();
  // Der Client muss den frischen Code auch scannen KÖNNEN: ein „Neu verbinden" ist ein neuer
  // Austausch, also nimmt der QR-Block die Schleife wieder auf (das Tor gilt nur für den alten
  // Schritt). Die Fake-Kamera dieses Rechners läuft – ohne sie stünde stattdessen „Erneut scannen".
  await expect(client.getByTestId('qr-status'), 'nach „Neu verbinden" scannt der Client wieder').toHaveText(S.lab.qr.scanning, { timeout: 15_000 });
  await expect(client.getByTestId('qr-video')).toBeVisible();
  // Die gezeigte Antwort gehört dem toten Peer und ist weg – sonst scannte der Host sie erneut.
  await expect(client.getByTestId('qr-enlarge'), 'der Antwort-Code des toten Peers ist weg').toBeHidden();
  // Der Vergleich bleibt IN der Seite; heraus kommt nur ein Wahrheitswert.
  const freshOffer = (): Promise<boolean> =>
    host.evaluate(() => {
      const area = document.querySelector('[data-testid="offer-out"]');
      const value = area instanceof HTMLTextAreaElement ? area.value : '';
      return value.startsWith('MB1.') && value !== (window as unknown as { __lockOffer?: string }).__lockOffer;
    });
  await expect.poll(freshOffer, { message: 'nach „Neu verbinden" steht ein anderer Code im Feld', timeout: 15_000 }).toBe(true);

  // … und mit dem frischen Code kommt die Verbindung erneut zustande.
  await uiHandshake(host, client);
  await slot.getByTestId('start-ping').click();
  await expect.poll(async () => (await lockFacts(host)).length, { timeout: 40_000 }).toBe(2);
  // Der neueste Report trägt denselben Lauf – jetzt mit „neu verbunden".
  expect((await lockFacts(host))[0]).toMatchObject({ runs: 1, plannedSeconds: 30, reconnected: true });
  // … und eine EIGENE Paarung: ein frischer Austausch misst neu. Ohne frische Marken stünde hier
  // wieder die Zahl des toten Peers (sie rasten je Name ein und ließen sich nie überschreiben).
  expect(await hostPairingConnectedMs(host), 'der frische Austausch misst seine Paarung neu').not.toBe(firstPairingMs);

  // ── Derselbe Lauf auf dem CLIENT: eine ÜBERLEBTE Sperre muss auch dort einen Report ergeben ──
  // D9 und die Tabelle „Sperrbildschirm-Test" wollen je GERÄT eine Zeile. Der Client hat keinen
  // „Ping-Test starten"-Knopf: von selbst speichert bei ihm nur der VERLUST (über `transport:failed`) –
  // ausgerechnet der Normalfall „hat gehalten" fiele ohne Report unter den Tisch.
  await client.bringToFront();
  await client.getByTestId('lock-10').click();
  await expect(client.getByTestId('lock-status')).toContainText('10');
  await fakeVisibility(client, true);
  await fakeVisibility(client, false);
  // Mitten in die laufende Messung getippt: „Neu verbinden" gehört zu DIESEM Lauf. Vorher gibt es auf
  // dem Client gar keinen Lauf – ohne Merker fiele die Marke ganz aus, statt beim Falschen zu landen.
  await expect(client.getByTestId('lock-phase'), 'die Ping-Serie des Sperrtests läuft noch').toHaveText(S.lab.lock.running);
  await client.getByTestId('lock-reconnect').click();
  await expect(client.getByTestId('lock-result')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });

  // Ein Client-Report mit genau diesem Lauf – und die Zeitleiste des frischen Austauschs bringt ihre
  // eigene Backend-Zeile mit (der QR-Block des Clients überlebt „Neu verbinden", seine Erkennung
  // meldet sich aber nur einmal je Seitenaufruf).
  await expect.poll(() => clientLockFacts(client), { timeout: 40_000 }).toEqual({
    reports: 1, runs: 1, transportAfter: 'open', reconnected: true, hasQrBackend: true,
  });
});

// ───────── Selbsttest (Task 9) ─────────
// Ein Gerät, eine Seite: Lauf A ohne getUserMedia, danach Lauf B mit offenem Kamera-Stream. NUR LOKAL (@local).
// Das chromium-Projekt hat eine PERSISTIERTE Kamera-Erlaubnis (playwright.config.ts) – deshalb MUSS Lauf A
// hier als ungültig markiert sein: „Kamera aus" bei Status `granted` misst nicht, was das Label behauptet
// (gemessenes Chrome-Verhalten aus M0, docs/decisions.md). Reports enthalten echte Adressen dieses Rechners →
// nie ausgeben, annotieren oder speichern; geprüft wird nur der anonymisierte Kopiertext.

const SELFTEST_REASON_RUN_A = 'Kamera aus, aber Berechtigung ist erteilt';

/**
 * Nur die Felder, die dieser Test liest. Bewusst KEIN Import aus src/lab/report: dessen Importkette reicht bis
 * src/platform/buildInfo.ts, und `__BUILD_ID__` ist im Node-Typecheck (tsconfig.node.json) nicht deklariert.
 */
interface SelfTestReport {
  cell: { role: string; hotspotOwner: string; camera: string; path: string; device: string };
  permissions: { camera: string };
  gumCalledThisSession: boolean;
  gather: { gathered: { type: string; family: string }[] } | null;
  hello: { versionMatch: boolean } | null;
  ping: { events: { sent: number; received: number; lossPct: number } | null };
  failures: string[];
  valid: boolean;
  invalidReason: string | null;
}

test('Selbsttest: Lauf A ungültig (Berechtigung erteilt), Lauf B gültig mit echten Host-IPs, Kopiertext ohne Adressen', { tag: '@local' }, async ({ context, page }) => {
  // CDP lehnt beim Erteilen EINER Berechtigung alle nicht genannten ab: mit `permissions: ['camera']` allein meldet
  // Chromium `local-network` als „denied" – und der Lauf bekäme F6, obwohl die Verbindung steht (gemessen).
  // `grantPermissions` selbst ist additiv (playwright-core führt die Listen je Origin zusammen), die
  // Kamera-Erlaubnis aus playwright.config.ts bleibt also erhalten – unten per `cameraPermission` nachgeprüft.
  await context.grantPermissions(['local-network-access']);
  // Zwischenablage abfangen: geprüft wird genau der Text, den „Beide Reports kopieren" schreibt.
  await page.addInitScript(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    const writeText = (text: string): Promise<void> => {
      copied.push(text);
      return Promise.resolve();
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  await page.goto('lab.html');
  await page.getByTestId('cell-device').fill('Playwright-PC');
  await page.getByTestId('selftest-start').click();

  // Zwei Läufe mit je 50 Pings pro Kanal im 33-ms-Takt plus Gathering: zusammen deutlich unter 40 s.
  await expect(page.getByTestId('selftest-A-valid')).toHaveAttribute('data-state', 'invalid', { timeout: 20_000 });
  await expect(page.getByTestId('selftest-B-valid')).toHaveAttribute('data-state', 'valid', { timeout: 30_000 });
  await expect(page.getByTestId('selftest-A-valid')).toContainText(SELFTEST_REASON_RUN_A);
  await expect(page.getByTestId('selftest-alert')).toBeVisible();
  await expect(page.getByTestId('selftest-alert')).toContainText(SELFTEST_REASON_RUN_A);
  await expect(page.getByTestId('selftest-B-camera')).not.toContainText('NotAllowedError');
  await expect(page.getByTestId('selftest-B-ping')).toContainText('/ 0 %');
  await expect(page.getByTestId('error-panel')).toBeHidden();

  await page.getByTestId('selftest-copy').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.length)).toBe(1);

  // Adressformen NUR in der Seite prüfen – nach außen gehen drei Wahrheitswerte. Der User-Agent bleibt laut
  // Vertrag ungekürzt und enthält „Chrome/<a.b.c.d>"; er wird vorher geleert, sonst sähe er wie eine IPv4 aus.
  const shapes = await page.evaluate(() => {
    const body = ((window as unknown as { __copied: string[] }).__copied[0] ?? '').replace(/"userAgent":\s*"[^"]*"/g, '"userAgent": ""');
    const ipv6 = (body.match(/[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}/gi) ?? []).filter((hit) => !/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(hit));
    return { ipv4: /\d{1,3}(?:\.\d{1,3}){3}/.test(body), ipv6: ipv6.length > 0, mdns: /\.local\b/i.test(body) };
  });
  expect(shapes).toEqual({ ipv4: false, ipv6: false, mdns: false });

  // Strukturprüfung außerhalb der Seite, aber nur auf adressfreien Werten: `gather`, `timeline` und `notes`
  // bleiben drin – aus `gather` kommt allein die ANZAHL echter Host-IPs heraus.
  const facts = await page.evaluate(() => {
    const reports = JSON.parse((window as unknown as { __copied: string[] }).__copied[0] ?? '[]') as SelfTestReport[];
    return {
      count: reports.length,
      runs: reports.map((report) => ({
        cell: report.cell,
        cameraPermission: report.permissions.camera,
        gumCalled: report.gumCalledThisSession,
        valid: report.valid,
        invalidReason: report.invalidReason,
        failures: report.failures,
        versionMatch: report.hello?.versionMatch ?? null,
        events: report.ping.events,
        hostRealIp: (report.gather?.gathered ?? []).filter((c) => c.type === 'host' && (c.family === 'ipv4' || c.family === 'ipv6')).length,
      })),
    };
  });
  expect(facts.count).toBe(2);
  const [runA, runB] = facts.runs;

  expect(runA?.cell).toEqual({ role: 'selbsttest', hotspotOwner: 'unbekannt', camera: 'aus', path: 'loopback', device: 'Playwright-PC' });
  expect(runA?.valid).toBe(false);
  expect(runA?.invalidReason).toContain(SELFTEST_REASON_RUN_A);
  expect(runA?.cameraPermission).toBe('granted');
  expect(runA?.gumCalled).toBe(false);

  expect(runB?.cell.camera).toBe('an');
  expect(runB?.valid).toBe(true);
  expect(runB?.gumCalled).toBe(true);
  expect(runB?.failures).toEqual([]);
  expect(runB?.versionMatch).toBe(true);
  expect(runB?.hostRealIp).toBeGreaterThan(0);
  expect(runB?.events).toMatchObject({ sent: 50, received: 50, lossPct: 0 });

  // Beide Läufe stehen auch im Verlauf des Labors (finishRun speichert, `onResult` aktualisiert die Liste).
  await expect(page.locator('[data-testid="report-item"][data-role="selbsttest"]')).toHaveCount(2);
});

// ───────── M2 Task 4: QR-Pfad in der Oberfläche (@local) ─────────
// Ein echter QR-HANDSHAKE bräuchte zwei Kameras mit je einem eigenen Bild – die Datei-Fake-Kamera
// liefert je Browser-Start genau EINEN Code (Abweichung 10 des M2-Plans). Geprüft wird deshalb die
// Hälfte, die ohne Scan entscheidbar ist: Der Host zeigt sein Angebot als QR (Canvas, Overlay), und
// der Handshake läuft über den Text-Rückfall – genau den Weg, den ein Nutzer nimmt, wenn der Scan
// nicht klappt. Der Payload verlässt die Seite nie; nach außen gehen nur Zahlen und Wahrheitswerte.

interface QrStoredReport {
  cell: { path: string };
  valid: boolean;
  failures: string[];
  timeline: { kind: string; detail: string }[];
  pairing: { offerShownAt: number | null; offerScannedMs: number | null; connectedMs: number | null; projectedLobbyFullMs: number | null } | null;
  qr: { backend: string; offerChars: number; answerChars: number; decodeLatencyMs: number; attempts: number } | null;
}

async function qrReportFacts(page: Page) {
  return page.evaluate((key) => {
    const report = (JSON.parse(localStorage.getItem(key) ?? '[]') as QrStoredReport[])[0];
    if (report === undefined) return null;
    return {
      path: report.cell.path,
      valid: report.valid,
      failures: report.failures,
      // Nur die ARTEN der Einträge und die Rolle beim Rückfall – nie ein Detail mit Codeinhalt.
      kinds: [...new Set(report.timeline.map((event) => event.kind))].sort(),
      fallbackRoles: report.timeline.filter((event) => event.kind === 'qr:fallback-text').map((event) => event.detail),
      backend: report.qr?.backend ?? null,
      offerChars: report.qr?.offerChars ?? -1,
      answerChars: report.qr?.answerChars ?? -1,
      pairingOfferShownAt: report.pairing?.offerShownAt ?? -1,
      pairingOfferScanned: report.pairing?.offerScannedMs ?? null,
      pairingConnected: typeof report.pairing?.connectedMs === 'number',
      pairingProjection: report.pairing?.projectedLobbyFullMs ?? null,
    };
  }, UI_REPORTS_KEY);
}

test('Labor-UI auf dem QR-Pfad: Angebot als QR, Handshake über den Text-Rückfall', { tag: '@local' }, async ({ context }) => {
  await context.grantPermissions(['local-network-access']);
  const host = await context.newPage();
  const client = await context.newPage();
  await host.goto('lab.html?quick=1');
  await client.goto('lab.html?quick=1');

  // Host auf dem QR-Pfad …
  await host.getByTestId('cell-device').fill('QR-Host');
  await host.getByTestId('cell-role-host').check();
  await host.getByTestId('cell-camera-an').check();
  await host.getByTestId('cell-path-choice-qr').check();
  await expect(host.getByTestId('cell-path')).toHaveText(S.lab.cell.pathQr);
  await host.getByTestId('cell-confirm').click();
  // Kamera-zuerst (D5/C3): auf dem QR-Pfad öffnet die Karte den Stream SELBST – „Kamera einschalten"
  // bleibt gesperrt, solange er läuft. Ein Klick darauf liefe hier in die Zeitüberschreitung.
  await expect(host.getByTestId('camera-state')).toHaveAttribute('data-state', 'ready', { timeout: 10_000 });
  await expect(host.getByTestId('camera-start'), 'der Selbststart macht den Knopf überflüssig').toBeDisabled();
  // … der Client bleibt auf dem Text-Pfad: seine Seite des Austauschs ist hier nicht der Prüfgegenstand.
  await uiLabelCell(client, 'client', 'QR-Client');

  // Der QR-Block steht unterhalb des Sichtfensters; ihn anzutippen verlangt Scrollen, und Chromium
  // hält `requestAnimationFrame` in einem HINTERGRUND-Tab an – Playwrights Stabilitätsprüfung liefe
  // sonst in die Zeitüberschreitung. Deshalb vor jeder Tipp-Handlung die Seite nach vorn holen.
  await host.bringToFront();
  await host.getByTestId('add-player').click();
  const slot = host.getByTestId('slot-1');
  const offerOut = slot.getByTestId('offer-out');
  await expect.poll(async () => (await offerOut.inputValue()).startsWith('MB1.'), { timeout: 10_000 }).toBe(true);

  // Der Code steht als QR auf dem Canvas. Nach außen geht nur die Kantenlänge in Gerätepixeln –
  // nie der Payload. Ein Canvas ohne Module wäre 0 px breit.
  const canvasPx = await slot.getByTestId('qr-canvas').evaluate((node) => (node as HTMLCanvasElement).width);
  expect(canvasPx, 'QR-Canvas hat Module').toBeGreaterThan(0);
  const dark = await slot.getByTestId('qr-canvas').evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; data !== undefined && i < data.length; i += 4) if ((data[i] ?? 255) < 128) count += 1;
    return count;
  });
  expect(dark, 'der Code ist wirklich gezeichnet, nicht nur eine weiße Fläche').toBeGreaterThan(0);

  // Vollbild-Overlay auf und wieder zu.
  await slot.getByTestId('qr-enlarge').click();
  await expect(host.getByTestId('qr-overlay')).toBeVisible();
  await host.keyboard.press('Escape');
  await expect(host.getByTestId('qr-overlay')).toBeHidden();

  // Pass-Chip: nennt Anzahlen, nie Adressen.
  await expect(slot.getByTestId('qr-pass-chip')).toBeVisible();
  await expect(slot.getByTestId('qr-pass-counts')).toContainText('Host-Kandidaten:');

  // Handshake über den Text-Rückfall: Angebot kopieren, Antwort erzeugen, Antwort einfügen.
  const offerPayload = await offerOut.inputValue();
  await client.bringToFront();
  await client.getByTestId('offer-in').fill(offerPayload);
  await client.getByTestId('make-answer').click();
  const answerOut = client.getByTestId('answer-out');
  await expect.poll(async () => (await answerOut.inputValue()).startsWith('MB1.'), { timeout: 10_000 }).toBe(true);
  const answerPayload = await answerOut.inputValue();
  await host.bringToFront();
  await slot.getByTestId('answer-in').fill(answerPayload);
  await slot.getByTestId('connect').click();
  await expect(slot.getByTestId('conn-state')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });

  await slot.getByTestId('start-ping').click();
  await expect(slot.getByTestId('run-status')).toHaveText(S.lab.run.saved, { timeout: 20_000 });

  const facts = await qrReportFacts(host);
  expect(facts).not.toBeNull();
  // D12: Der Ausweg auf den Text-Pfad ändert das Zellenlabel NICHT – er steht in der Zeitleiste.
  expect(facts?.path).toBe('qr');
  expect(facts?.valid).toBe(true);
  // Der Scan lief mit laufender Kamera los: kein `qr:error` und damit kein falsches F9.
  expect(facts?.kinds).not.toContain('qr:error');
  expect(facts?.failures).not.toContain('F9');
  expect(facts?.kinds).toContain('qr:backend');
  expect(facts?.kinds).toContain('qr:shown');
  expect(facts?.kinds).toContain('qr:fallback-text');
  expect(facts?.fallbackRoles).toEqual(['answer']);
  expect(['native', 'worker']).toContain(facts?.backend);
  expect(facts?.offerChars).toBeGreaterThan(0);
  // Die Antwort kam als Text – es gibt also keinen gescannten Antwort-Code.
  expect(facts?.answerChars).toBe(0);
  // Paarung: der eigene Code wurde gezeigt (Nullpunkt) und die Verbindung kam zustande; ohne Scan
  // gibt es keine Scan-Dauer und damit auch keine Hochrechnung.
  expect(facts?.pairingOfferShownAt).toBe(0);
  expect(facts?.pairingConnected).toBe(true);
  expect(facts?.pairingOfferScanned).toBeNull();
  expect(facts?.pairingProjection).toBeNull();
});

test('QR-Pfad am Host: ein zweiter Platz übernimmt die Kamera, der erste bietet „Erneut scannen"', { tag: '@local' }, async ({ context }) => {
  await context.grantPermissions(['local-network-access']);
  const host = await context.newPage();
  await host.goto('lab.html?quick=1');
  await host.getByTestId('cell-device').fill('QR-Zwei-Plaetze');
  await host.getByTestId('cell-role-host').check();
  await host.getByTestId('cell-camera-an').check();
  await host.getByTestId('cell-path-choice-qr').check();
  await host.getByTestId('cell-confirm').click();
  await expect(host.getByTestId('camera-state')).toHaveAttribute('data-state', 'ready', { timeout: 10_000 });

  await host.bringToFront();
  await host.getByTestId('add-player').click();
  const slot1 = host.getByTestId('slot-1');
  await expect(slot1.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning, { timeout: 10_000 });
  await expect(slot1.getByTestId('qr-retry')).toBeHidden();

  // Drei Plätze teilen sich EINE Kamera: liefen zwei Schleifen, entschiede der Zufall, welcher Platz
  // die Antwort des anderen dekodiert – der falsche bekäme ein Nonce-F5 und käme nicht mehr weiter.
  await host.getByTestId('add-player').click();
  const slot2 = host.getByTestId('slot-2');
  await expect(slot2.getByTestId('qr-status')).toHaveText(S.lab.qr.scanning, { timeout: 10_000 });
  await expect(slot1.getByTestId('qr-retry'), 'der überholte Platz bietet den zweiten Versuch an').toBeVisible();
  // … und sagt auch, WARUM er aufgehört hat – „Kamera draufhalten" wäre hier eine Lüge.
  await expect(slot1.getByTestId('qr-status')).toHaveText(S.lab.qr.overtaken);

  // Und zurück: „Erneut scannen" auf Platz 1 überholt nun Platz 2.
  await slot1.getByTestId('qr-retry').click();
  await expect(slot1.getByTestId('qr-retry')).toBeHidden();
  await expect(slot2.getByTestId('qr-retry')).toBeVisible();
});

test('QR-Pfad am Host: ein freigegebener Platz hinterlässt keinen verwaisten QR-Block', { tag: '@local' }, async ({ context }) => {
  await context.grantPermissions(['local-network-access']);
  const host = await context.newPage();
  await host.goto('lab.html?hook=1&quick=1');
  await host.waitForFunction(() => '__mbLab' in window, undefined, { timeout: 10_000 });
  await host.getByTestId('cell-device').fill('QR-Waise');
  await host.getByTestId('cell-role-host').check();
  await host.getByTestId('cell-camera-an').check();
  await host.getByTestId('cell-path-choice-qr').check();
  await host.getByTestId('cell-confirm').click();
  await expect(host.getByTestId('camera-state')).toHaveAttribute('data-state', 'ready', { timeout: 10_000 });

  // Platz belegen und sofort wieder freigeben, WÄHREND `createOffer` noch sammelt – danach denselben
  // Platz neu belegen. Ein noch laufendes `createOffer` des alten Platzes darf keinen zweiten
  // QR-Block auf dem neuen Eintrag anlegen: der überholte dann jeden Scan des echten.
  await host.bringToFront();
  await host.getByTestId('add-player').click();
  await host.getByTestId('slot-1').getByTestId('release').click();
  await expect(host.getByTestId('slot-1')).toHaveCount(0);
  await host.getByTestId('add-player').click();

  const slot1 = host.getByTestId('slot-1');
  await expect.poll(async () => (await slot1.getByTestId('offer-out').inputValue()).startsWith('MB1.'), { timeout: 15_000 }).toBe(true);
  await expect(slot1.getByTestId('qr-block')).toHaveCount(1);
  // Nach außen geht nur die ANZAHL lebender QR-Blöcke – genau einer, nämlich der des neuen Platzes.
  expect(await host.evaluate(() => (window as unknown as { __mbLab: LabHook }).__mbLab.liveExchangeCount())).toBe(1);
});
