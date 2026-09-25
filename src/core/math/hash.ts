/**
 * Inkrementeller FNV-1a-32-Hasher ueber einen KANONISCHEN Little-Endian-Bytestrom.
 *
 * Wozu: `hashState` (M3/T4) laeuft die Feldfolge des `WorldState` ab und verdichtet sie zu einer
 * uint32. Zwei Laeufe mit derselben Saat muessen bitgleiche Hashes liefern – sonst ist der
 * Golden-Test wertlos.
 *
 * Warum 32 Bit: gemessen kostet FNV-1a-32 mit `Math.imul` fuer einen Zustand mit ~2200 Feldern
 * 15.7 us, die 64-Bit-Fassung ueber BigInt 294 us (18.7x). Fuer "hat sich etwas geaendert?" bringt
 * die groessere Breite nichts.
 *
 * Warum `DataView` mit `littleEndian = true` und NIE eine `Float64Array`-Sicht: die Typed-Array-
 * Sicht folgt der PLATTFORM (ECMA-262 9.6 nennt das "implementation-defined"), `DataView` folgt dem
 * Flag. Nur so ist der Bytestrom auf jedem Geraet derselbe.
 *
 * Drei Regeln, die den Strom eindeutig machen (gemessen: jede Verletzung faellt sonst erst im
 * Golden-Test auf, ohne die Ursache zu zeigen):
 *   1. `-0` wird auf `+0` normalisiert – sonst haetten rechnerisch gleiche Zustaende zwei Hashes.
 *   2. `NaN` und `+-Infinity` WERFEN (`NaNError` mit dem Feldpfad). ECMA-262 25.1.3.17 erlaubt der
 *      Engine, NaN beliebig zu kodieren; ein NaN im Zustand ist ohnehin immer ein Fehler.
 *   3. Vor jedem Array steht seine Laenge (`hashLen`), damit ["ab"] und ["a","b"] sich unterscheiden.
 */

/** Wirft der Hasher, wenn eine nicht endliche Zahl in den Strom soll. `path` nennt das Feld. */
export class NaNError extends Error {
  readonly path: string;

  constructor(path: string, value: number) {
    super(`Nicht endliche Zahl im Hash-Lauf bei ${path}: ${value}`);
    this.name = 'NaNError';
    this.path = path;
  }
}

/** Inkrementeller Hasher. Die Aufrufreihenfolge ist Teil des Vertrags. */
export interface Hasher {
  /** Ein Byte (`& 0xff`) – fuer Aufzaehlungen, Masken und Slots. */
  hashU8(byte: number): void;
  /** Acht Byte float64 Little-Endian. `-0` wird zu `+0`; `NaN`/`+-Infinity` werfen `NaNError`. */
  hashF64(value: number, path: string): void;
  /** Ein Byte 0 oder 1. */
  hashBool(value: boolean): void;
  /** Laengenpraefix (uint32 LE) + die UTF-16-Code-Einheiten LE. Kein `TextEncoder` – fehlt in der Core-lib. */
  hashStr(value: string): void;
  /** uint32 LE als Laengenpraefix VOR jedem Array. */
  hashLen(length: number): void;
  /** Der Zwischenstand als uint32. Aendert den Hasher nicht – er laesst sich weiterfuellen. */
  digest(): number;
}

/** FNV-1a-32: Startwert (offset basis). */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a-32: Primzahl. */
const FNV_PRIME = 16777619;

/**
 * Neuer Hasher. Startwert 0x811c9dc5, Schritt `h = Math.imul(h ^ byte, 16777619) >>> 0`.
 * `Math.imul` ist erlaubt und exakt spezifiziert (ECMA-262 21.3.2.20) – eine gewoehnliche
 * Multiplikation verliert oberhalb von 2^53 Bits.
 */
export function createHasher(): Hasher {
  let h = FNV_OFFSET;
  // Ein Puffer je Hasher, acht Byte gross: er nimmt sowohl den float64 als auch den uint32 auf.
  const view = new DataView(new ArrayBuffer(8));

  function step(byte: number): void {
    h = Math.imul(h ^ (byte & 0xff), FNV_PRIME) >>> 0;
  }

  // Bewusst freie Funktionen statt Methoden mit `this`: so bleibt der Hasher auch dann heil, wenn
  // ein Aufrufer ihn zerlegt (`const { hashF64 } = createHasher()`).
  function hashU8(byte: number): void {
    step(byte);
  }

  function hashF64(value: number, path: string): void {
    if (!Number.isFinite(value)) throw new NaNError(path, value);
    // `value === 0` trifft +0 UND -0; die Zuweisung von 0 macht daraus das positive.
    view.setFloat64(0, value === 0 ? 0 : value, true);
    for (let i = 0; i < 8; i += 1) step(view.getUint8(i));
  }

  function hashBool(value: boolean): void {
    step(value ? 1 : 0);
  }

  function hashLen(length: number): void {
    view.setUint32(0, length >>> 0, true);
    for (let i = 0; i < 4; i += 1) step(view.getUint8(i));
  }

  function hashStr(value: string): void {
    hashLen(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const unit = value.charCodeAt(i);
      step(unit);
      step(unit >>> 8);
    }
  }

  function digest(): number {
    return h >>> 0;
  }

  return { hashU8, hashF64, hashBool, hashStr, hashLen, digest };
}

/**
 * Hash einer Zahlenfolge: Laengenpraefix + `hashF64` je Wert. Fuer Tests und fuer Saaten
 * (`seedRng(hashNumbers([seed, slot, tick]))` in den Skript-Bots).
 */
export function hashNumbers(values: readonly number[]): number {
  const h = createHasher();
  h.hashLen(values.length);
  for (let i = 0; i < values.length; i += 1) {
    h.hashF64(values[i] as number, `values[${i}]`);
  }
  return h.digest();
}
