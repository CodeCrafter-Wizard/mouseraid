/**
 * Eingaberahmen und ihr Drahtformat. Die Flanken (»gerade gedrückt«) liegen NICHT hier, sondern im
 * Zustand (`player.prevButtons`, ausgewertet im System `playerIntent`) – ein Rahmen ist eine reine
 * Momentaufnahme und muss ohne Vorgeschichte verständlich sein.
 */

/** Sprint-Taste (Weg 1; Weg 2 ist der Außenring des Sticks – siehe playerIntent). */
export const BUTTON_SPRINT = 1;
/** Benutzen/Aufheben – wirkt nur auf der Flanke. */
export const BUTTON_INTERACT = 2;
/** Länge eines gepackten Rahmens in Byte. */
export const INPUT_BYTES = 8;

export interface InputFrame { seq: number; tick: number; mx: number; mz: number; buttons: number }

// Feste Bytepositionen. Sie stehen hier als Konstanten, damit Packer und Entpacker nachweislich
// dieselbe Karte lesen: tick u32 LE (0..3) | mx i8 (4) | mz i8 (5) | buttons u8 (6) | seq u8 (7).
// Das ist die einzige 8-Byte-Aufteilung, in die alle fünf Felder passen (gemessen; seq als u16
// bräuchte 9 Byte und damit faktisch 12).
const OFF_TICK = 0;
const OFF_MX = 4;
const OFF_MZ = 5;
const OFF_BUTTONS = 6;
const OFF_SEQ = 7;

const U32_MAX = 4294967295;

/**
 * Prüft ein Feld VOR dem Schreiben. Grund: `Uint8Array` verschluckt jeden Schreibzugriff hinter dem
 * Ende und schneidet jeden Wert auf 8 Bit – ein falscher Rahmen käme also still verfälscht wieder
 * heraus. Entwickler-Rückkanal, keine Spiel-UI.
 */
function checkField(name: string, value: number, lo: number, hi: number): void {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new RangeError(`InputFrame.${name} muss eine ganze Zahl in [${lo}, ${hi}] sein, ist ${value}`);
  }
}

function checkRoom(length: number, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + INPUT_BYTES > length) {
    throw new RangeError(`Versatz ${offset} passt nicht in einen Puffer von ${length} Byte (${INPUT_BYTES} Byte nötig)`);
  }
}

/** Schreibt den Rahmen als 8 Byte an `offset`. Die Bytes werden EINZELN gesetzt – die Reihenfolge
 *  steht damit im Quelltext und hängt an keinem Endianness-Flag. */
export function packInput(frame: InputFrame, dst: Uint8Array, offset: number): void {
  checkRoom(dst.length, offset);
  checkField('tick', frame.tick, 0, U32_MAX);
  checkField('mx', frame.mx, -128, 127);
  checkField('mz', frame.mz, -128, 127);
  checkField('buttons', frame.buttons, 0, 255);
  checkField('seq', frame.seq, 0, 255);

  const tick = frame.tick;
  dst[offset + OFF_TICK] = tick & 0xff;
  dst[offset + OFF_TICK + 1] = (tick / 256) & 0xff;
  dst[offset + OFF_TICK + 2] = (tick / 65536) & 0xff;
  dst[offset + OFF_TICK + 3] = (tick / 16777216) & 0xff;
  dst[offset + OFF_MX] = frame.mx & 0xff;
  dst[offset + OFF_MZ] = frame.mz & 0xff;
  dst[offset + OFF_BUTTONS] = frame.buttons;
  dst[offset + OFF_SEQ] = frame.seq;
}

/** Liest 8 Byte ab `offset` zurück in einen Rahmen. */
export function unpackInput(src: Uint8Array, offset: number): InputFrame {
  checkRoom(src.length, offset);
  const b0 = src[offset + OFF_TICK] ?? 0;
  const b1 = src[offset + OFF_TICK + 1] ?? 0;
  const b2 = src[offset + OFF_TICK + 2] ?? 0;
  const b3 = src[offset + OFF_TICK + 3] ?? 0;
  const mx = src[offset + OFF_MX] ?? 0;
  const mz = src[offset + OFF_MZ] ?? 0;
  return {
    // Bewusst `+ b3 * 16777216` statt `| b3 << 24`: der Bit-Oder liefert ab Bit 31 eine NEGATIVE
    // Zahl, tick ist aber vorzeichenlos.
    seq: src[offset + OFF_SEQ] ?? 0,
    tick: b0 + b1 * 256 + b2 * 65536 + b3 * 16777216,
    mx: mx > 127 ? mx - 256 : mx,
    mz: mz > 127 ? mz - 256 : mz,
    buttons: src[offset + OFF_BUTTONS] ?? 0,
  };
}

/** Stillstand: kein Ausschlag, keine Taste. Fehlt ein Slot beim Schritt, gilt genau dieser Rahmen. */
export function neutralInput(tick: number, seq: number): InputFrame {
  return { seq, tick, mx: 0, mz: 0, buttons: 0 };
}
