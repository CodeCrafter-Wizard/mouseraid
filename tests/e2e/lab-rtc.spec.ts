import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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
