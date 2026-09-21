// base64url (RFC 4648 §5, ohne Padding) und deflate-raw über die Web-Standard-Globals
// btoa/atob, Blob, Response und CompressionStream – in Browsern wie in Node 24 vorhanden.

const BASE64URL = /^[A-Za-z0-9_-]*$/;
/** String.fromCharCode(...chunk) legt jedes Byte auf den Stack – deshalb in Portionen. */
const CHUNK = 0x8000;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @throws Error bei Zeichen außerhalb des URL-Alphabets (auch "+", "/", "=", Leerraum) und bei unmöglicher Länge. */
export function fromBase64Url(text: string): Uint8Array {
  if (!BASE64URL.test(text)) throw new Error('base64url: ungültiges Zeichen.');
  if (text.length % 4 === 1) throw new Error('base64url: unmögliche Länge.');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Wahr, wenn der Browser `CompressionStream` UND das Format "deflate-raw" kennt (ältere Chrome-Versionen nur gzip/deflate). */
export function supportsDeflateRaw(): boolean {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return false;
  try {
    new CompressionStream('deflate-raw');
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // Die Kopie löst die Eingabe von ihrem Puffer (Teilansicht, SharedArrayBuffer) – Blob nimmt nur ArrayBuffer-Sichten.
  const source = new Blob([new Uint8Array(bytes)]).stream();
  return new Uint8Array(await new Response(source.pipeThrough(transform)).arrayBuffer());
}

/** Lehnt ab (wirft nie synchron), wenn `CompressionStream` fehlt – vorher `supportsDeflateRaw()` fragen. */
export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('deflate-raw'));
}

/** Lehnt ab, wenn die Bytes kein vollständiger deflate-raw-Strom sind. */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('deflate-raw'));
}
