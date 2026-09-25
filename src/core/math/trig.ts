/**
 * Winkelfunktionen fuer den deterministischen Kern.
 *
 * WARUM eigene: ECMA-262 nennt `Math.sin/cos/atan2` "implementation-approximated" – Firefox und V8
 * liefern belegt verschiedene Bits. Erlaubt und bit-gleich vorgeschrieben sind nur `+ - * /`,
 * Vergleiche und `Math.sqrt/abs/floor/round`; genau daraus ist alles hier gebaut.
 *
 * KEINE Tabelle: gemessen ist das Polynom gleichzeitig ~440x genauer (6.63e-10 gegen 2.94e-7) UND
 * ~1.6x schneller als eine 4096er-Tabelle mit Interpolation (der Tabellenzugriff kostet eine
 * Bereichspruefung, das Polynom ist reine Registerarbeit).
 *
 * Gemessene Fehlerschranken (gegen `Math.*`, dichte Gitter, siehe tests/unit/core/math/trig.test.ts):
 *   sin, cos  |Fehler| <= 6.63e-10  (auf [-PI, PI] UND bei +-100 Umdrehungen)
 *   atan2     |Fehler| <= 9.73e-9 rad  (401x401-Gitter in [-1,1]^2 und Kreis-Sweep)
 * Bei Argumenten weit jenseits von +-100 Umdrehungen frisst die Ausloeschung in `x - k*PI` die
 * Genauigkeit auf; der Wertebereich [-1, 1] bleibt erhalten, die Schranke nicht. Im Spiel kommen
 * solche Winkel nicht vor: `facing` kommt aus `atan2` und liegt damit schon in [-PI, PI].
 * `normalizeAngle` ruft in M3 kein Kern-Modul auf – die Funktion ist Vertrag fuer M4/M7 (Kameraweg,
 * Drehungen), und die Schranke oben gilt fuer jeden, der sie dann benutzt.
 *
 * AN DEN ACHSEN EXAKT, aber mit einer Eigenheit: `sin(0) === 0` und `cos(0) === 1` sind exakt (das
 * Polynom liegt bei PI/2 um 6.6e-10 UEBER 1, die Klemme holt es auf genau 1 zurueck). `cos(HALF_PI)`
 * ist dagegen `sin(PI) = -0` – eine negative Null. Das ist folgenlos (`hashF64` normalisiert -0 auf
 * +0, Tests vergleichen mit `toBeCloseTo`/`Math.abs`), aber niemand sollte `toBe(0)` gegen das `rc`
 * eines um 90 Grad gedrehten Kolliders schreiben: `Object.is(-0, 0)` ist `false`.
 */

/** Kreiszahl als naechstliegender double. */
export const PI = 3.141592653589793;
/** Voller Kreis (2*PI). Winkel sind Bogenmass in der XZ-Ebene, +Z zeigt nach "vorn". */
export const TAU = 6.283185307179586;
/** Viertelkreis (PI/2). */
export const HALF_PI = 1.5707963267948966;

// Taylor-Koeffizienten des ungeraden sin-Polynoms bis Grad 13. Als Bruch geschrieben, damit die
// Herkunft (Fakultaet) im Quelltext steht; die Division ist laut IEEE 754 exakt gerundet, also
// auf jeder Engine derselbe double.
const S3 = 1 / 6; //            3!
const S5 = 1 / 120; //          5!
const S7 = 1 / 5040; //         7!
const S9 = 1 / 362880; //       9!
const S11 = 1 / 39916800; //   11!
const S13 = 1 / 6227020800; // 13!

// Koeffizienten des ungeraden atan-Polynoms bis Grad 17 auf |z| <= 1, als Polynom in u = z*z.
// Herkunft: Chebyshev-Approximation von atan(sqrt(u))/sqrt(u) auf [0,1], Grad 8 in u, danach in die
// Monombasis umgerechnet. Gemessener Maximalfehler von atan2 damit: 9.73e-9 rad (groesster Fehler
// an der Oktantennaht |y| = |x|). Die Zahlen sind AUSGESCHRIEBEN – ein Nachrechnen zur Laufzeit
// waere nicht deterministisch reproduzierbar.
const A1 = 0.99999998178865579;
const A3 = -0.33333036709292974;
const A5 = 0.19991872029265295;
const A7 = -0.14197797795410752;
const A9 = 0.10618370642482469;
const A11 = -0.074568548385229860;
const A13 = 0.042137623745702513;
const A15 = -0.015731249223588546;
const A17 = 0.0027662835283182277;

/**
 * sin fuer |r| <= PI/2 (der reduzierte Rest). Horner auf dem ungeraden Taylor-Polynom Grad 13:
 * r - r^3/3! + r^5/5! - ... - r^13/13!.
 */
function sinCore(r: number): number {
  const z = r * r;
  let p = -S13;
  p = p * z + S11;
  p = p * z - S9;
  p = p * z + S7;
  p = p * z - S5;
  p = p * z + S3;
  return r - r * z * p;
}

/**
 * Sinus im Bogenmass. Bereichsreduktion ueber die naechste Vielfache von PI
 * (`k = Math.round(x / PI)`), danach ein Vorzeichenwechsel bei ungeradem k.
 */
export function sin(x: number): number {
  const k = Math.round(x / PI);
  const r = x - k * PI;
  const s0 = sinCore(r);
  // `k % 2` statt `k & 1`: bei sehr grossen Argumenten (|x| > 2^31 * PI ~ 6.7e9) liegt k ausserhalb
  // von int32, und `&` wuerde still falsch rechnen. `%` gilt fuer jede ganze Zahl (auch negative:
  // -3 % 2 = -1). Vorsorglich: im zugesicherten Bereich ist der Unterschied nicht beobachtbar, jenseits
  // davon garantiert `sin` ohnehin nur noch die Klemme auf [-1, 1] – deshalb gibt es dafuer keinen Test.
  const s = k % 2 === 0 ? s0 : -s0;
  // Klemmen auf [-1, 1]: bei riesigen Argumenten laesst die Ausloeschung in `x - k*PI` den Rest
  // knapp ueber PI/2 rutschen, und dort liegt das Polynom bis zu 6.7e-10 ueber 1 (gemessen bei
  // x = 1e12). Ein Aufrufer, der daraus eine Wurzel oder einen Arkus zieht, bekaeme NaN.
  // Fuer alle normalen Winkel ist das Klemmen wirkungslos.
  return s < -1 ? -1 : s > 1 ? 1 : s;
}

/** Kosinus im Bogenmass – ueber die Verschiebung um einen Viertelkreis. */
export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** atan fuer |z| <= 1. Horner auf dem ungeraden Polynom Grad 17 in u = z*z. */
function atanUnit(z: number): number {
  const u = z * z;
  let p = A17;
  p = p * u + A15;
  p = p * u + A13;
  p = p * u + A11;
  p = p * u + A9;
  p = p * u + A7;
  p = p * u + A5;
  p = p * u + A3;
  p = p * u + A1;
  return z * p;
}

/**
 * Winkel des Vektors (x, y) – Argumentfolge WIE `Math.atan2`, der Aufrufer schreibt
 * `atan2(vel.z, vel.x)`. Ergebnis in [-PI, PI].
 *
 * Oktanten-Reduktion: das kleinere Glied wird durch das groessere geteilt, damit das Polynom nur
 * auf |z| <= 1 arbeitet; danach spiegeln Quadrant und Vorzeichen zurueck.
 *
 * Unterschied zu `Math.atan2`: eine NEGATIVE Null wird wie +0 behandelt (`atan2(-0, -1)` liefert
 * hier +PI statt -PI). Im Kern ist das folgenlos – `hashF64` normalisiert -0 ohnehin auf +0.
 */
export function atan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a: number;
  if (ax >= ay) {
    // Enthaelt auch den Ursprung: beide 0 -> Winkel 0, wie Math.atan2(0, 0).
    a = ax === 0 ? 0 : atanUnit(ay / ax);
  } else {
    a = HALF_PI - atanUnit(ax / ay);
  }
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

/** Quadratwurzel – nur weitergereicht; ECMA-262 21.3.2.33 schreibt sie exakt vor. */
export function sqrt(x: number): number {
  return Math.sqrt(x);
}

/**
 * Bringt einen Winkel nach [-PI, PI) – ohne Schleife ueber TAU-Vielfache, damit die Kosten nicht
 * am Betrag des Winkels haengen.
 *
 * `Math.floor(a / TAU + 0.5)` liefert die Umdrehungszahl, deren Rest genau in [-PI, PI) faellt.
 * Die beiden Nachkorrekturen fangen den Rundungsfehler von `n * TAU` ab (bei |a| <= 1e6 rund
 * 1e-10); ohne sie koennte das Ergebnis knapp ausserhalb des zugesicherten Bereichs liegen.
 */
export function normalizeAngle(a: number): number {
  const n = Math.floor(a / TAU + 0.5);
  let r = a - n * TAU;
  if (r >= PI) r -= TAU;
  else if (r < -PI) r += TAU;
  return r;
}
