// Erfundene Bausteine für die SDP-Fixtures. Das Repo ist öffentlich: Fixtures tragen nur
// Dokumentationsadressen (RFC 5737 / RFC 3849) und offensichtlich unechte ufrag/pwd/Fingerprints.

/**
 * mDNS-Name in Chromes Form (`<uuid>.local`), erst zur Laufzeit zusammengesetzt – ein wörtlicher
 * Name in einer getrackten Datei würde den Datenschutz-Wächter (tests/node/privacy-guard.test.ts) auslösen.
 */
export function fakeMdnsName(digit: string): string {
  return `${[8, 4, 4, 4, 12].map((length) => digit.repeat(length)).join('-')}.local`;
}

/** sha-256-Fingerprint aus 32 aufsteigenden Bytes ab `firstByte`, z. B. 00:01:02:…:1F. */
export function fakeFingerprint(firstByte: number): string {
  return Array.from({ length: 32 }, (_, index) =>
    ((firstByte + index) & 0xff).toString(16).padStart(2, '0').toUpperCase(),
  ).join(':');
}

/** Browser liefern SDP mit CRLF-Zeilenenden und abschließendem CRLF. */
export function sdpFromLines(lines: readonly string[]): string {
  return `${lines.join('\r\n')}\r\n`;
}
