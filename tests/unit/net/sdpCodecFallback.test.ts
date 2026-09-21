import { describe, expect, it, vi } from 'vitest';
import { deflateRaw, toBase64Url } from '../../../src/net/compress';
import { CodecError, decodeDesc, encodeDesc, minimise } from '../../../src/net/sdpCodec';
import { chromiumOffer } from '../../fixtures/sdp/chromium-offer';

// Browser ohne CompressionStream: nur die Feature-Erkennung wird ersetzt, alles andere bleibt echt.
vi.mock('../../../src/net/compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/net/compress')>()),
  supportsDeflateRaw: () => false,
}));

const META = { protoV: 1, role: 'offer', slot: 1, nonce: 99 } as const;

describe('sdpCodec ohne deflate-raw-Unterstützung', () => {
  it('encodeDesc fällt von selbst auf den unkomprimierten Modus p zurück', async () => {
    const desc = minimise(chromiumOffer, META);
    const { text, sizes } = await encodeDesc(desc);
    expect(text.startsWith('MB1.p.')).toBe(true);
    expect(sizes.compressed).toBe(false);
    expect(sizes.packedBytes).toBe(sizes.minimisedBytes);
    expect(await decodeDesc(text)).toEqual(desc);
  });

  it('auch ein ausdrückliches compress: true erzwingt keine Kompression', async () => {
    const { text } = await encodeDesc(minimise(chromiumOffer, META), { compress: true });
    expect(text.startsWith('MB1.p.')).toBe(true);
  });

  it('decodeDesc meldet einen komprimierten Code als CodecError("inflate")', async () => {
    const packed = await deflateRaw(new TextEncoder().encode('{"v":1}'));
    const error: unknown = await decodeDesc(`MB1.d.${toBase64Url(packed)}`).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CodecError);
    expect((error as CodecError).code).toBe('inflate');
  });
});
