// Gemeinsame Prüfhelfer der beiden Loader-Tests (`balanceLoad`, `levelLoad`). Sie standen dort
// zweimal fast wortgleich; R7 hat nur die Prüfhelfer IM QUELLTEXT als akzeptierte Dopplung
// beschlossen, für die Testhelfer gab es kein Ruling. Diese Datei liegt außerhalb von `src/core`
// und darf `JSON.parse/stringify` benutzen – im Kern ist beides gesperrt.

export type Json = Record<string, unknown>;

/**
 * Baut aus einer eingefrorenen Fixture einen Varianten-Bauer: jeder Aufruf liefert eine TIEFE Kopie,
 * auf der der Rückruf GENAU EINE gezielte Verletzung setzt. Die Fixture selbst bleibt unberührt –
 * sonst würde ein Test den nächsten beeinflussen.
 */
export function makeVariant(fixture: unknown): (patch: (copy: Json) => void) => Json {
  return (patch) => {
    const copy = JSON.parse(JSON.stringify(fixture)) as Json;
    patch(copy);
    return copy;
  };
}

/** Unterobjekt eines Roh-JSON, ohne optionales Lesen im Test. */
export function sub(source: Json, key: string): Json {
  return source[key] as Json;
}

/** Ein Fehler, der seinen Feldpfad mitführt (`BalanceError`, `LevelError`). */
interface PathError { readonly path: string }

/**
 * Feldpfad des geworfenen Loader-Fehlers – oder ein harter Fehler, wenn der Loader NICHT geworfen
 * hat (sonst liefe ein Fall, der durchrutscht, als „Pfad stimmt" durch).
 */
export function pathOfThrow(load: (json: unknown) => unknown, json: unknown,
  errorClass: abstract new (...args: never[]) => PathError): string {
  try {
    load(json);
  } catch (error) {
    if (error instanceof errorClass) return error.path;
    throw error;
  }
  throw new Error('Der Loader hat nicht geworfen');
}
