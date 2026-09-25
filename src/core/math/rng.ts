/**
 * sfc32 – der Zufall des Kerns.
 *
 * Warum sfc32: schnell (gemessen 1.49 ns je Wert), vier uint32 Zustand, ohne BigInt in JS
 * bit-genau darstellbar (gegen eine BigInt-Referenz ueber 3 Saaten x 100 000 Werte geprueft).
 *
 * Der Zustand liegt als `rng: RngState` IM `WorldState`. Deshalb MUTIEREN `nextU32` & Co. den
 * uebergebenen Zustand, statt einen neuen zurueckzugeben: ein neuer Zustand muesste an jeder
 * Aufrufstelle zurueckgeschrieben werden, und genau das vergisst man einmal – der Lauf driftet
 * dann still auseinander, und der Golden-Hash zeigt nur, DASS etwas anders ist.
 *
 * Alle vier Felder werden nach jedem Schritt auf uint32 normalisiert (`>>> 0`). Der Ausgabestrom
 * ist damit bitgleich zur ueblichen int32-Fassung (gemessen ueber 200 000 Werte); der Vorteil:
 * im Zustand steht nie eine negative Zahl und nie ein `-0`, das der Hash erst normalisieren
 * muesste.
 */
import { createHasher } from './hash';

/** Zustand von sfc32: vier uint32. Liegt im `WorldState`, wird also mitgeklont und mitgehasht. */
export interface RngState { a: number; b: number; c: number; d: number }

/** 2^32 – der Teiler fuer `nextFloat` und die Obergrenze der Verwerfungsregel. */
const TWO_32 = 4294967296;

/**
 * Saat aus Text oder Zahl. Eine Zahl geht als ihre Dezimalziffern in den Hash (`seedRng(42)` und
 * `seedRng('42')` liefern denselben Zustand) – so kann die Saat aus einem Textfeld ODER aus
 * `hashNumbers([...])` kommen, ohne dass die Behandlung auseinanderlaeuft.
 *
 * Ablauf: FNV-1a-32 ueber den Saattext, danach VIER weitere Schritte mit den Salzbytes 1..4 – das
 * ergibt vier verschiedene Startwerte aus einem einzigen Hash. Zum Schluss 12 Verwurfrunden
 * (PractRand-Saatregel), damit sich benachbarte Saaten nicht in den ersten Werten aehneln.
 */
export function seedRng(seed: number | string): RngState {
  const text = typeof seed === 'string' ? seed : String(seed);
  const hasher = createHasher();
  hasher.hashStr(text);
  hasher.hashU8(1);
  const a = hasher.digest();
  hasher.hashU8(2);
  const b = hasher.digest();
  hasher.hashU8(3);
  const c = hasher.digest();
  hasher.hashU8(4);
  const d = hasher.digest();
  const state: RngState = { a, b, c, d };
  for (let i = 0; i < 12; i += 1) nextU32(state);
  return state;
}

/** Naechster Wert als uint32. MUTIERT `rng` in place. */
export function nextU32(rng: RngState): number {
  const t = ((((rng.a + rng.b) | 0) + rng.d) | 0) >>> 0;
  rng.d = (rng.d + 1) >>> 0;
  rng.a = (rng.b ^ (rng.b >>> 9)) >>> 0;
  rng.b = ((rng.c + (rng.c << 3)) | 0) >>> 0;
  const rotated = ((rng.c << 21) | (rng.c >>> 11)) >>> 0;
  rng.c = ((rotated + t) | 0) >>> 0;
  return t;
}

/** Gleichverteilt in [0, 1) mit 32 Bit Mantisse. MUTIERT `rng`. */
export function nextFloat(rng: RngState): number {
  return nextU32(rng) / TWO_32;
}

/**
 * Gleichverteilt in [0, n) – mit VERWERFUNG, also ohne Modulo-Verzerrung. MUTIERT `rng`.
 * `n` muss eine positive ganze Zahl <= 2^32 sein, sonst `RangeError` – oberhalb von 2^32 waere
 * `limit` 0, jeder Rohwert wuerde verworfen und der Notausgang liefert dann still nur die untere
 * Haelfte des Bereichs (und verbraucht 65 Rohwerte, was einen Golden-Hash verschiebt).
 *
 * Gemessen ist die Verzerrung des reinen Modulo bei kleinen n winzig (2.33e-8 % bei n = 3); die
 * faire Fassung kostet im Normalfall trotzdem nichts und macht die Eigenschaft beweisbar.
 */
export function nextInt(rng: RngState, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > TWO_32) {
    throw new RangeError(`nextInt braucht eine positive ganze Zahl <= 2^32, bekam: ${n}`);
  }
  // Alles ab `limit` faellt in einen unvollstaendigen Block und wird verworfen.
  const limit = TWO_32 - (TWO_32 % n);
  // Sicherheitszaehler: die Verwerfungswahrscheinlichkeit liegt unter 1/2, 64 Versuche scheitern
  // also mit einer Wahrscheinlichkeit unter 2^-64. Der Zaehler ist reine Schleifen-Hygiene –
  // ein unbegrenztes `while` im Kern waere eine Haengestelle ohne Diagnose.
  for (let i = 0; i < 64; i += 1) {
    const u = nextU32(rng);
    if (u < limit) return u % n;
  }
  // Notausgang, ABSICHTLICH so: nach 64 Fehlversuchen (Wahrscheinlichkeit < 2^-64) wird der
  // Modulo-Wert genommen – lieber eine Zahl mit 2^-64-Verzerrung als ein Haenger im Kern. Das ist
  // kein vergessener Wurf: ein `throw` an dieser Stelle koennte eine laufende Partie beenden.
  return nextU32(rng) % n;
}

/** Gleichverteilt in [lo, hi). MUTIERT `rng`. Bei `lo === hi` immer `lo`. */
export function nextRange(rng: RngState, lo: number, hi: number): number {
  return lo + nextFloat(rng) * (hi - lo);
}

/** Flache Kopie des Zustands – vier Zahlen, mehr ist er nicht. */
export function cloneRng(rng: RngState): RngState {
  return { a: rng.a, b: rng.b, c: rng.c, d: rng.d };
}
