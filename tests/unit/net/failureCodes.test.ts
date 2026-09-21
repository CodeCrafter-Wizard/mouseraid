import { describe, expect, it } from 'vitest';
import type { CandidateSummary } from '../../../src/net/candidates';
import { FAILURE_CODES, classifyFailures, type FailureInput } from '../../../src/net/failureCodes';
import { S } from '../../../src/ui/strings';

const REAL_HOSTS: CandidateSummary = { total: 2, host: 2, hostRealIp: 2, mdns: 0, ipv4: 2, ipv6: 0, tcp: 0, iosHotspot: false };
const MDNS_ONLY: CandidateSummary = { total: 2, host: 2, hostRealIp: 0, mdns: 2, ipv4: 0, ipv6: 0, tcp: 0, iosHotspot: false };
const NOTHING: CandidateSummary = { total: 0, host: 0, hostRealIp: 0, mdns: 0, ipv4: 0, ipv6: 0, tcp: 0, iosHotspot: false };

/** Gesunde, laufende Verbindung – jeder Test verbiegt genau die Felder, um die es ihm geht. */
function input(overrides: Partial<FailureInput> = {}): FailureInput {
  return {
    secureContext: true,
    rtcAvailable: true,
    engine: 'chromium',
    cameraPermission: 'granted',
    localNetworkPermission: 'unsupported',
    candidates: REAL_HOSTS,
    iceState: 'connected',
    channelsOpen: true,
    msSinceIceConnected: 400,
    wasOpenBefore: true,
    codecError: false,
    cameraError: false,
    ...overrides,
  };
}

/** Verbindungsaufbau läuft noch: ICE noch nicht verbunden, Kanäle noch nie offen. */
const connecting: Partial<FailureInput> = { iceState: 'checking', channelsOpen: false, msSinceIceConnected: null, wasOpenBefore: false };

describe('classifyFailures – kein Befund', () => {
  it('gesunde Verbindung → leer', () => {
    expect(classifyFailures(input())).toEqual([]);
  });

  it('vor dem Gathering (candidates = null, ICE "none") → leer', () => {
    expect(classifyFailures(input({ ...connecting, candidates: null, iceState: 'none' }))).toEqual([]);
  });

  it('während des Aufbaus mit echten Kandidaten → leer', () => {
    expect(classifyFailures(input(connecting))).toEqual([]);
  });
});

describe('classifyFailures – F6 Umgebung ungeeignet', () => {
  it.each([
    ['kein sicherer Kontext', { secureContext: false }],
    ['kein WebRTC', { rtcAvailable: false }],
    ['Local-Network-Zugriff verweigert', { localNetworkPermission: 'denied' as const }],
  ])('%s → F6', (_name, overrides) => {
    expect(classifyFailures(input(overrides))).toEqual(['F6']);
  });

  it.each(['granted', 'prompt', 'unsupported'] as const)('localNetworkPermission "%s" ist kein F6', (state) => {
    expect(classifyFailures(input({ localNetworkPermission: state }))).toEqual([]);
  });

  it('F6 verdrängt alle anderen Codes – ohne brauchbare Umgebung sagt nichts anderes etwas aus', () => {
    const everythingBroken = input({
      secureContext: false,
      candidates: { ...NOTHING, iosHotspot: true },
      iceState: 'failed',
      channelsOpen: false,
      codecError: true,
      cameraError: true,
    });
    expect(classifyFailures(everythingBroken)).toEqual(['F6']);
  });
});

describe('classifyFailures – Kandidaten-Codes F1, F1S, F2, F4', () => {
  it('F1: keine Host-Kandidaten', () => {
    expect(classifyFailures(input({ ...connecting, candidates: NOTHING }))).toEqual(['F1']);
  });

  it('F1 zählt Host-Kandidaten, nicht die Gesamtzahl', () => {
    const onlySrflx: CandidateSummary = { ...NOTHING, total: 1, ipv4: 1 };
    expect(classifyFailures(input({ ...connecting, candidates: onlySrflx }))).toEqual(['F1']);
  });

  it.each(['prompt', 'denied', 'unsupported'] as const)('F1S statt F1: WebKit mit Kamera-Status "%s"', (state) => {
    expect(classifyFailures(input({ ...connecting, engine: 'webkit', cameraPermission: state, candidates: NOTHING }))).toEqual(['F1S']);
  });

  it('WebKit MIT Kamera-Erlaubnis bleibt beim gewöhnlichen F1', () => {
    expect(classifyFailures(input({ ...connecting, engine: 'webkit', cameraPermission: 'granted', candidates: NOTHING }))).toEqual(['F1']);
  });

  it.each(['chromium', 'gecko', 'unknown'] as const)('Engine "%s" ohne Kamera-Erlaubnis bleibt bei F1', (engine) => {
    expect(classifyFailures(input({ ...connecting, engine, cameraPermission: 'prompt', candidates: NOTHING }))).toEqual(['F1']);
  });

  it('F2: Host-Kandidaten vorhanden, aber keiner mit echter IP (nur mDNS)', () => {
    expect(classifyFailures(input({ ...connecting, candidates: MDNS_ONLY }))).toEqual(['F2']);
  });

  it('F4: iPhone-Hotspot-Adresse unter den Kandidaten', () => {
    expect(classifyFailures(input({ ...connecting, candidates: { ...REAL_HOSTS, iosHotspot: true } }))).toEqual(['F4']);
  });

  it('ohne Gathering (candidates = null) gibt es keinen Kandidaten-Code', () => {
    expect(classifyFailures(input({ ...connecting, candidates: null, engine: 'webkit', cameraPermission: 'prompt' }))).toEqual([]);
  });
});

describe('classifyFailures – F5 und F9', () => {
  it('F5: Code ungültig / Versionskonflikt / falsche Rolle', () => {
    expect(classifyFailures(input({ ...connecting, candidates: null, iceState: 'none', codecError: true }))).toEqual(['F5']);
  });

  it('F9: Kamera-Anforderung fehlgeschlagen', () => {
    expect(classifyFailures(input({ cameraError: true }))).toEqual(['F9']);
  });
});

describe('classifyFailures – Zustands-Codes F3, F7, F8', () => {
  it('F3: ICE fehlgeschlagen, ohne dass die Verbindung je offen war', () => {
    expect(classifyFailures(input({ ...connecting, iceState: 'failed' }))).toEqual(['F3']);
  });

  it.each(['connected', 'completed'])('F7: ICE "%s", Kanäle nach 10 s noch zu', (iceState) => {
    expect(classifyFailures(input({ ...connecting, iceState, msSinceIceConnected: 10_000 }))).toEqual(['F7']);
  });

  it('F7 erst ab 10 000 ms', () => {
    expect(classifyFailures(input({ ...connecting, iceState: 'connected', msSinceIceConnected: 9_999 }))).toEqual([]);
  });

  it('kein F7 ohne Zeitmessung (msSinceIceConnected = null)', () => {
    expect(classifyFailures(input({ ...connecting, iceState: 'connected', msSinceIceConnected: null }))).toEqual([]);
  });

  it('kein F7, solange ICE noch prüft', () => {
    expect(classifyFailures(input({ ...connecting, iceState: 'checking', msSinceIceConnected: 60_000 }))).toEqual([]);
  });

  it('kein F7, wenn die Kanäle offen sind', () => {
    expect(classifyFailures(input({ wasOpenBefore: false, msSinceIceConnected: 60_000 }))).toEqual([]);
  });

  it.each(['disconnected', 'closed'])('F8: war offen, ICE jetzt "%s"', (iceState) => {
    expect(classifyFailures(input({ iceState }))).toEqual(['F8']);
  });

  it('F8: war offen, Kanäle jetzt zu – und dann NICHT zusätzlich F7', () => {
    expect(classifyFailures(input({ channelsOpen: false, msSinceIceConnected: 60_000 }))).toEqual(['F8']);
  });

  it('F8 setzt voraus, dass die Verbindung vorher offen war', () => {
    expect(classifyFailures(input({ ...connecting, iceState: 'disconnected' }))).toEqual([]);
  });

  it('war offen und ICE "failed" → F3 und F8', () => {
    expect(classifyFailures(input({ iceState: 'failed', channelsOpen: false }))).toEqual(['F3', 'F8']);
  });
});

describe('classifyFailures – Kombinationen und Reihenfolge', () => {
  it('klassischer mDNS-Fehlschlag: F2 + F3', () => {
    expect(classifyFailures(input({ ...connecting, candidates: MDNS_ONLY, iceState: 'failed' }))).toEqual(['F2', 'F3']);
  });

  it('Safari ohne Kamera, danach ICE fehlgeschlagen: F1S + F3', () => {
    const safari = input({ ...connecting, engine: 'webkit', cameraPermission: 'prompt', candidates: NOTHING, iceState: 'failed' });
    expect(classifyFailures(safari)).toEqual(['F1S', 'F3']);
  });

  it('Hotspot-Isolation mit Fehlschlag: F3 + F4', () => {
    expect(classifyFailures(input({ ...connecting, candidates: { ...REAL_HOSTS, iosHotspot: true }, iceState: 'failed' }))).toEqual(['F3', 'F4']);
  });

  it('F1 und F2 schließen sich aus', () => {
    const codes = classifyFailures(input({ ...connecting, candidates: NOTHING }));
    expect(codes).not.toContain('F2');
  });

  it('die Ausgabe folgt immer der festen Reihenfolge', () => {
    const many = input({
      engine: 'webkit',
      cameraPermission: 'denied',
      candidates: { ...NOTHING, iosHotspot: true },
      iceState: 'failed',
      channelsOpen: false,
      codecError: true,
      cameraError: true,
    });
    expect(classifyFailures(many)).toEqual(['F1S', 'F3', 'F4', 'F5', 'F8', 'F9']);
  });

  it('FAILURE_CODES nennt alle Codes in der festen Reihenfolge', () => {
    expect(FAILURE_CODES).toEqual(['F1', 'F1S', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']);
  });
});

describe('S.failures – Texte zu den Fehlercodes', () => {
  it.each(FAILURE_CODES)('%s hat Titel und Hinweis', (code) => {
    const text = S.failures[code];
    expect(text.title.trim().length).toBeGreaterThan(0);
    expect(text.hint.trim().length).toBeGreaterThan(0);
  });

  it('kennt keine Codes, die es nicht gibt', () => {
    expect(Object.keys(S.failures).sort()).toEqual([...FAILURE_CODES].sort());
  });
});
