import { describe, expect, it } from 'vitest';
import { deflateRaw, fromBase64Url, toBase64Url } from '../../../src/net/compress';
import {
  CODEC_VERSION,
  CodecError,
  decodeDesc,
  encodeDesc,
  MAX_PAYLOAD_TEXT_CHARS,
  minimise,
  rebuildSdp,
  type CodecErrorCode,
  type SessionDesc,
} from '../../../src/net/sdpCodec';
import { SDP_FIXTURES } from '../../fixtures/sdp';
import { chromiumOffer } from '../../fixtures/sdp/chromium-offer';
import { fakeFingerprint, fakeMdnsName } from '../../fixtures/sdp/fakeValues';
import { firefoxOffer } from '../../fixtures/sdp/firefox-offer';
import { safariOfferSynthetic } from '../../fixtures/sdp/safari-offer-synthetisch';

const META = { protoV: 1, role: 'offer', slot: 1, nonce: 4_000_000_001 } as const;

/** Beliebigen JSON-Wert als unkomprimierten Payload verpacken – für gezielt kaputte Eingaben. */
function plainPayload(value: unknown): string {
  return `MB1.p.${toBase64Url(new TextEncoder().encode(JSON.stringify(value)))}`;
}

/** Gültiges kompaktes JSON; einzelne Felder werden pro Test überschrieben oder entfernt. */
function compact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: CODEC_VERSION,
    p: 1,
    r: 'o',
    s: 1,
    n: 7,
    u: 'FAKE',
    w: 'FAKEpwdFAKEpwdFAKEpwd012',
    f: toBase64Url(Uint8Array.from({ length: 32 }, (_, index) => index)),
    t: 'x',
    k: 5000,
    m: 262144,
    c: ['1111111111 1 udp 2121998079 192.0.2.10 50001 typ host'],
    ...overrides,
  };
}

function without(key: string): Record<string, unknown> {
  const value = compact();
  delete value[key];
  return value;
}

async function codeOf(action: () => unknown): Promise<CodecErrorCode | 'kein CodecError'> {
  try {
    await action();
  } catch (error) {
    if (error instanceof CodecError) return error.code;
  }
  return 'kein CodecError';
}

/** Kleiner LCG mit festem Seed: liefert Zeichenketten aus einem Alphabet – reproduzierbar, aber unkomprimierbar wie echte Werte. */
function makeRandom(seed: number): (alphabet: string, length: number) => string {
  let state = seed >>> 0;
  return (alphabet, length) => {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out += alphabet[(state >>> 16) % alphabet.length] ?? '';
    }
    return out;
  };
}

describe('minimise', () => {
  it('liest die sitzungsspezifischen Teile eines Chromium-Angebots', () => {
    expect(minimise(chromiumOffer, META)).toEqual({
      codecV: CODEC_VERSION,
      protoV: 1,
      role: 'offer',
      slot: 1,
      nonce: 4_000_000_001,
      ufrag: 'FAKE',
      pwd: 'FAKEpwdFAKEpwdFAKEpwd012',
      fingerprint: fakeFingerprint(0x00),
      setup: 'actpass',
      sctpPort: 5000,
      maxMessageSize: 262144,
      candidates: [
        '1111111111 1 udp 2121998079 192.0.2.10 50001 typ host generation 0 network-id 1 network-cost 10',
        '2222222222 1 udp 2122265343 2001:db8:1::10 50002 typ host generation 0 network-id 2 network-cost 10',
        '3333333333 1 tcp 1518018303 192.0.2.10 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
        '4444444444 1 tcp 1518285567 2001:db8:1::10 9 typ host tcptype active generation 0 network-id 2 network-cost 10',
      ],
    } satisfies SessionDesc);
  });

  it('findet Attribute auf Session-Ebene (Firefox legt den Fingerprint dort ab)', () => {
    const desc = minimise(firefoxOffer, META);
    expect(desc.fingerprint).toBe(fakeFingerprint(0x40));
    expect(desc.ufrag).toBe('fa4e0001');
    expect(desc.pwd).toBe('fa4e00fa4e00fa4e00fa4e00fa4e00fa');
    expect(desc.maxMessageSize).toBe(1073741823);
    expect(desc.candidates).toEqual([
      '0 1 UDP 2122252543 198.51.100.7 50021 typ host',
      '1 1 UDP 2122187007 2001:db8:2::7 50022 typ host',
      `2 1 UDP 2122121471 ${fakeMdnsName('3')} 50023 typ host`,
      '3 1 TCP 2105524479 198.51.100.7 9 typ host tcptype active',
    ]);
  });

  it('Medien-Ebene gewinnt gegen Session-Ebene', () => {
    const sdp = chromiumOffer.replace('t=0 0\r\n', 't=0 0\r\na=ice-ufrag:SESSION\r\na=setup:passive\r\n');
    const desc = minimise(sdp, META);
    expect(desc.ufrag).toBe('FAKE');
    expect(desc.setup).toBe('actpass');
  });

  it('verträgt LF, setzt die Vorgaben 5000 / null und schreibt den Fingerprint groß', () => {
    expect(safariOfferSynthetic).not.toContain('\r');
    const desc = minimise(safariOfferSynthetic, META);
    expect(desc.sctpPort).toBe(5000);
    expect(desc.maxMessageSize).toBeNull();
    expect(desc.fingerprint).toBe(fakeFingerprint(0x80));
    expect(desc.candidates).toEqual(['5555555555 1 udp 2113937151 203.0.113.20 50041 typ host generation 0 network-cost 999']);
  });

  it.each(SDP_FIXTURES)('$name: CRLF und LF ergeben dieselbe Beschreibung, keine Kandidatenzeile geht verloren', (fixture) => {
    const meta = { ...META, role: fixture.role };
    const crlf = fixture.sdp.replace(/\r?\n/g, '\r\n');
    const lf = fixture.sdp.replace(/\r\n/g, '\n');
    expect(minimise(crlf, meta)).toEqual(minimise(lf, meta));
    expect(minimise(crlf, meta).candidates).toHaveLength(fixture.candidates);
  });

  it('liefert eine leere Kandidatenliste, wenn das SDP keine enthält (Safari ohne Kamera)', () => {
    const sdp = chromiumOffer.split('\r\n').filter((line) => !line.startsWith('a=candidate:')).join('\r\n');
    expect(minimise(sdp, META).candidates).toEqual([]);
  });

  it.each([
    ['ohne m=application', chromiumOffer.replace('m=application', 'm=audio')],
    ['ohne ice-ufrag', chromiumOffer.replace('a=ice-ufrag:', 'a=x-ufrag:')],
    ['ohne ice-pwd', chromiumOffer.replace('a=ice-pwd:', 'a=x-pwd:')],
    ['ohne sha-256-Fingerprint', chromiumOffer.replace('a=fingerprint:sha-256', 'a=fingerprint:sha-1')],
    ['mit zu kurzem Fingerprint', chromiumOffer.replace(fakeFingerprint(0x00), 'AB:CD')],
    ['mit unbekanntem setup', chromiumOffer.replace('a=setup:actpass', 'a=setup:holdconn')],
    ['mit kaputtem sctp-port', chromiumOffer.replace('a=sctp-port:5000', 'a=sctp-port:abc')],
    ['leer', ''],
    // Finding 2 (Review, Fix round 1): ein lokal gültiger, aber außerhalb des Vertrags liegender Wert
    // würde sonst eine Beschreibung erzeugen, die die Gegenseite in decodeDesc ablehnt.
    ['mit sctp-port über 65535', chromiumOffer.replace('a=sctp-port:5000', 'a=sctp-port:70000')],
    [
      'mit max-message-size über Number.MAX_SAFE_INTEGER',
      chromiumOffer.replace('a=max-message-size:262144', 'a=max-message-size:9999999999999999'),
    ],
  ])('wirft CodecError("sdp") %s', async (_label, sdp) => {
    expect(await codeOf(() => minimise(sdp, META))).toBe('sdp');
  });
});

describe('Roundtrip', () => {
  it.each(SDP_FIXTURES)('$name: minimise → encodeDesc → decodeDesc → rebuildSdp → minimise bleibt gleich', async (fixture) => {
    const meta = { protoV: 1, role: fixture.role, slot: 2, nonce: 123_456_789 };
    const desc = minimise(fixture.sdp, meta);
    const { text } = await encodeDesc(desc);
    const decoded = await decodeDesc(text);
    expect(decoded).toEqual(desc);
    const rebuilt = rebuildSdp(decoded);
    expect(rebuilt).toContain('o=- 123456789 2 IN IP4 127.0.0.1\r\n');
    expect(minimise(rebuilt, meta)).toEqual(desc);
  });

  it('Kandidaten überleben wörtlich und in Reihenfolge: IPv6, link-local, mDNS, TCP, raddr/rport', async () => {
    const candidates = [
      '1 1 udp 2122265343 2001:db8:1::10 50002 typ host generation 0 network-id 2 network-cost 10',
      '2 1 udp 2122199807 fe80::1 50003 typ host generation 0 network-id 3',
      `3 1 udp 2113937151 ${fakeMdnsName('4')} 50004 typ host generation 0 network-cost 999`,
      '4 1 tcp 1518018303 192.0.2.10 9 typ host tcptype active generation 0 network-id 1',
      '5 1 udp 1685987071 203.0.113.9 50005 typ srflx raddr 192.0.2.10 rport 50001 generation 0 network-id 1',
    ];
    const desc: SessionDesc = { ...minimise(chromiumOffer, META), candidates };
    const decoded = await decodeDesc((await encodeDesc(desc)).text);
    expect(decoded.candidates).toEqual(candidates);
    expect(minimise(rebuildSdp(decoded), META).candidates).toEqual(candidates);
  });
});

describe('encodeDesc', () => {
  it.each(SDP_FIXTURES)('$name: komprimierter Payload bleibt unter 800 Zeichen', async (fixture) => {
    const desc = minimise(fixture.sdp, { ...META, role: fixture.role });
    const { text, sizes } = await encodeDesc(desc);
    console.info(
      `[sdpCodec] ${fixture.name}: SDP ${fixture.sdp.length} B → JSON ${sizes.minimisedBytes} B → gepackt ${sizes.packedBytes} B → Text ${sizes.textChars} Zeichen`,
    );
    expect(text.startsWith('MB1.d.')).toBe(true);
    expect(sizes.compressed).toBe(true);
    expect(sizes.textChars).toBe(text.length);
    expect(sizes.packedBytes).toBeLessThan(sizes.minimisedBytes);
    expect(sizes.minimisedBytes).toBeLessThan(fixture.sdp.length);
    expect(sizes.textChars).toBeLessThanOrEqual(800);
  });

  it('typischer Umschlag mit ZUFÄLLIGEN Werten (vier mDNS-Kandidaten) bleibt komprimiert unter 800 Zeichen', async () => {
    // Echte ufrag/pwd/Fingerprints/mDNS-Namen sind zufällig und lassen sich kaum packen – die Fixtures
    // mit ihren Wiederholungen wären geschönt. Deshalb hier Pseudozufall (fester Seed, zur Laufzeit erzeugt).
    const random = makeRandom(20260921);
    const hex = '0123456789abcdef';
    const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const candidates = [0, 1, 2, 3].map((index) => {
      const uuid = [8, 4, 4, 4, 12].map((length) => random(hex, length)).join('-');
      return `${random('123456789', 10)} 1 udp 211393${index}151 ${uuid}.local 5${random('0123456789', 4)} typ host generation 0 network-cost 999`;
    });
    const desc: SessionDesc = {
      ...minimise(chromiumOffer, META),
      ufrag: random(base64, 4),
      pwd: random(base64, 24),
      fingerprint: Array.from({ length: 32 }, () => random(hex, 2).toUpperCase()).join(':'),
      candidates,
    };
    const packed = await encodeDesc(desc);
    const plain = await encodeDesc(desc, { compress: false });
    console.info(
      `[sdpCodec] 4× mDNS, Zufallswerte: JSON ${packed.sizes.minimisedBytes} B → komprimiert ${packed.sizes.textChars} Zeichen, unkomprimiert ${plain.sizes.textChars} Zeichen`,
    );
    expect(await decodeDesc(packed.text)).toEqual(desc);
    expect(packed.sizes.textChars).toBeLessThanOrEqual(800);
    expect(packed.sizes.textChars).toBeLessThan(plain.sizes.textChars);
  });

  it('unkomprimierter Modus: Präfix MB1.p., Größen stimmen, Dekodieren klappt', async () => {
    const desc = minimise(chromiumOffer, META);
    const { text, sizes } = await encodeDesc(desc, { compress: false });
    expect(text.startsWith('MB1.p.')).toBe(true);
    expect(sizes.compressed).toBe(false);
    expect(sizes.packedBytes).toBe(sizes.minimisedBytes);
    expect(sizes.textChars).toBe(text.length);
    expect(await decodeDesc(text)).toEqual(desc);
  });

  it('schreibt das kompakte JSON mit den kurzen Schlüsseln des Vertrags', async () => {
    const desc = minimise(chromiumOffer, META);
    const { text } = await encodeDesc(desc, { compress: false });
    const json: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(text.slice('MB1.p.'.length))));
    expect(Object.keys(json as object)).toEqual(['v', 'p', 'r', 's', 'n', 'u', 'w', 'f', 't', 'k', 'm', 'c']);
    expect(json).toMatchObject({ v: 1, p: 1, r: 'o', s: 1, n: 4_000_000_001, u: 'FAKE', t: 'x', k: 5000, m: 262144 });
    const fingerprint = (json as { f: string }).f;
    expect(fingerprint).toHaveLength(43);
    expect([...fromBase64Url(fingerprint)]).toEqual(Array.from({ length: 32 }, (_, index) => index));
  });

  it('lehnt eine Beschreibung mit kaputtem Fingerprint ab', async () => {
    const desc: SessionDesc = { ...minimise(chromiumOffer, META), fingerprint: 'AB:CD' };
    expect(await codeOf(() => encodeDesc(desc))).toBe('sdp');
  });
});

describe('decodeDesc', () => {
  it('ignoriert Leerraum und Zeilenumbrüche im eingefügten Text', async () => {
    const desc = minimise(chromiumOffer, META);
    const { text } = await encodeDesc(desc);
    const chunks = text.match(/.{1,40}/g) ?? [];
    const pasted = `  \n${chunks.join(' \r\n\t')}\n\n `;
    expect(pasted.length).toBeGreaterThan(text.length);
    expect(await decodeDesc(pasted)).toEqual(desc);
  });

  it('bildet Rolle und setup für eine Antwort ab', async () => {
    const decoded = await decodeDesc(plainPayload(compact({ r: 'a', t: 'a', s: 3, m: null, c: [] })));
    expect(decoded).toMatchObject({ role: 'answer', setup: 'active', slot: 3, maxMessageSize: null, candidates: [] });
    expect((await decodeDesc(plainPayload(compact({ t: 'p' })))).setup).toBe('passive');
  });

  it.each<[CodecErrorCode, string, string]>([
    ['empty', 'leerer Text', ''],
    ['empty', 'nur Leerraum', ' \r\n\t '],
    ['prefix', 'fremder Text', 'hallo'],
    ['prefix', 'fremde Formatversion', 'MB2.d.AAAA'],
    ['prefix', 'unbekannter Modus', 'MB1.z.AAAA'],
    ['prefix', 'ohne Rumpf-Trenner', 'MB1.d'],
    ['base64', 'ungültige Zeichen', 'MB1.p.ab$cd'],
    ['base64', 'leerer Rumpf', 'MB1.p.'],
    ['inflate', 'kein deflate-Strom', `MB1.d.${toBase64Url(new Uint8Array([0xff, 0xff, 0xff, 0xff]))}`],
    ['json', 'kein JSON', `MB1.p.${toBase64Url(new TextEncoder().encode('kein json'))}`],
    ['json', 'ungültiges UTF-8', `MB1.p.${toBase64Url(new Uint8Array([0xc3, 0x28]))}`],
    ['shape', 'Array statt Objekt', plainPayload([1, 2, 3])],
    ['shape', 'null', plainPayload(null)],
    ['shape', 'codecV fehlt', plainPayload(without('v'))],
    ['shape', 'ufrag fehlt', plainPayload(without('u'))],
    ['shape', 'ufrag leer', plainPayload(compact({ u: '' }))],
    ['shape', 'protoV keine Zahl', plainPayload(compact({ p: '1' }))],
    ['shape', 'unbekannte Rolle', plainPayload(compact({ r: 'x' }))],
    ['shape', 'slot 4', plainPayload(compact({ s: 4 }))],
    ['shape', 'slot -1', plainPayload(compact({ s: -1 }))],
    ['shape', 'slot 1.5', plainPayload(compact({ s: 1.5 }))],
    ['shape', 'nonce negativ', plainPayload(compact({ n: -1 }))],
    ['shape', 'nonce über uint32', plainPayload(compact({ n: 4_294_967_296 }))],
    ['shape', 'Fingerprint mit 31 Bytes', plainPayload(compact({ f: toBase64Url(new Uint8Array(31)) }))],
    ['shape', 'Fingerprint kein base64url', plainPayload(compact({ f: '$$$' }))],
    ['shape', 'unbekanntes setup', plainPayload(compact({ t: 'z' }))],
    ['shape', 'sctpPort 70000', plainPayload(compact({ k: 70000 }))],
    ['shape', 'maxMessageSize negativ', plainPayload(compact({ m: -1 }))],
    ['shape', 'Kandidaten kein Array', plainPayload(compact({ c: 'x' }))],
    ['shape', 'Kandidat keine Zeichenkette', plainPayload(compact({ c: ['ok', 5] }))],
    ['shape', 'Zeilenumbruch im Kandidaten (SDP-Injektion)', plainPayload(compact({ c: ['1 1 udp 1 192.0.2.1 9 typ host\r\na=setup:active'] }))],
    ['shape', 'Zeilenumbruch im ufrag (SDP-Injektion)', plainPayload(compact({ u: 'a\nb' }))],
    ['shape', 'Zeilenumbruch im Passwort', plainPayload(compact({ w: 'a\nb' }))],
    ['codec-version', 'neuere Codec-Version', plainPayload(compact({ v: CODEC_VERSION + 1 }))],
    ['codec-version', 'neuere Codec-Version mit fremder Form', plainPayload({ v: CODEC_VERSION + 1 })],
  ])('wirft CodecError("%s"): %s', async (code, _label, text) => {
    expect(await codeOf(() => decodeDesc(text))).toBe(code);
  });

  it('abgeschnittener Code (unvollständig kopiert) wird als CodecError("inflate") gemeldet', async () => {
    const { text } = await encodeDesc(minimise(chromiumOffer, META));
    // 8 Zeichen weniger: bleibt gültiges base64url, aber der deflate-Strom endet zu früh.
    expect(await codeOf(() => decodeDesc(text.slice(0, -8)))).toBe('inflate');
  });

  it('CodecError ist ein Error mit Code und Namen', () => {
    const error = new CodecError('prefix', 'Test');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CodecError');
    expect(error.code).toBe('prefix');
    expect(error.message).toBe('Test');
  });

  // Finding 1 (Review, Fix round 1): ein absichtlich riesiger eingefügter Text – oder ein kleiner
  // Text, der zu einer riesigen entpackten Größe aufbläht (deflate-raw kann bis zu ~1000:1) – darf
  // den Tab nicht hängen lassen. Beide Grenzen greifen VOR JSON.parse.
  it('lehnt einen eingefügten Text über MAX_PAYLOAD_TEXT_CHARS ab, bevor Präfix/base64 geprüft werden', async () => {
    const text = `MB1.p.${'A'.repeat(MAX_PAYLOAD_TEXT_CHARS - 5)}`;
    expect(text).toHaveLength(MAX_PAYLOAD_TEXT_CHARS + 1);
    expect(await codeOf(() => decodeDesc(text))).toBe('shape');
  });

  it('Leerraum zählt nicht zur Längengrenze – ein gültiger Code bleibt lesbar, auch grosszügig gepolstert', async () => {
    const desc = minimise(chromiumOffer, META);
    const { text } = await encodeDesc(desc);
    expect(text.length).toBeLessThan(MAX_PAYLOAD_TEXT_CHARS);
    const padded = `${' \n\t'.repeat(2000)}${text}${' \r\n'.repeat(2000)}`;
    expect(padded.length).toBeGreaterThan(MAX_PAYLOAD_TEXT_CHARS);
    expect(await decodeDesc(padded)).toEqual(desc);
  });

  it('eine „Zip-Bombe" (klein komprimiert, riesig entpackt) wird zügig als CodecError("inflate") abgelehnt', async () => {
    // Mode p mit über 16384 Bytes Rumpf kann unter der 4096-Zeichen-Grenze gar nicht erst entstehen
    // (base64url dehnt höchstens um 1/3) – die Längengrenze oben deckt diesen Fall also mit ab.
    const huge = new TextEncoder().encode(`{"pad":"${'A'.repeat(1_000_000)}"}`);
    const packed = await deflateRaw(huge);
    const text = `MB1.d.${toBase64Url(packed)}`;
    expect(text.length).toBeLessThanOrEqual(MAX_PAYLOAD_TEXT_CHARS);
    const start = Date.now();
    expect(await codeOf(() => decodeDesc(text))).toBe('inflate');
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
