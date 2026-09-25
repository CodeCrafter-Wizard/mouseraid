import { describe, expect, it } from 'vitest';
import type { InputFrame } from '../../../../src/core/sim/input';
import { BUTTON_INTERACT, BUTTON_SPRINT, INPUT_BYTES, neutralInput, packInput, unpackInput } from '../../../../src/core/sim/input';

/** Ein Rahmen aus Einzelwerten – kürzt die Tabellen unten ab. */
function frame(tick: number, mx: number, mz: number, buttons: number, seq: number): InputFrame {
  return { seq, tick, mx, mz, buttons };
}

describe('Konstanten', () => {
  it('Tastenbits sind disjunkte Einzelbits und der Rahmen ist 8 Byte lang', () => {
    expect(BUTTON_SPRINT).toBe(1);
    expect(BUTTON_INTERACT).toBe(2);
    expect(BUTTON_SPRINT & BUTTON_INTERACT).toBe(0);
    expect(INPUT_BYTES).toBe(8);
  });
});

describe('packInput – das Byte-Layout steht wörtlich im Test', () => {
  it('schreibt tick u32 LE, dann mx, mz, buttons, seq', () => {
    const dst = new Uint8Array(INPUT_BYTES);
    // 0x04030201 = 67305985: die vier Bytes sind unterscheidbar, also fällt jede Vertauschung auf.
    packInput(frame(0x04030201, -2, 3, BUTTON_SPRINT | BUTTON_INTERACT, 250), dst, 0);
    expect([...dst]).toEqual([0x01, 0x02, 0x03, 0x04, 0xfe, 0x03, 0x03, 0xfa]);
  });

  it('schreibt an den Versatz und lässt die Nachbarbytes in Ruhe', () => {
    const dst = new Uint8Array(3 * INPUT_BYTES);
    dst.fill(0xaa);
    packInput(frame(1, 1, 1, 1, 1), dst, INPUT_BYTES);
    expect([...dst.subarray(0, INPUT_BYTES)]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]);
    expect([...dst.subarray(INPUT_BYTES, 2 * INPUT_BYTES)]).toEqual([1, 0, 0, 0, 1, 1, 1, 1]);
    expect([...dst.subarray(2 * INPUT_BYTES)]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]);
  });
});

describe('Rundlauf über die Randwerte', () => {
  const CASES: readonly { name: string; frame: InputFrame }[] = [
    { name: 'alles null', frame: frame(0, 0, 0, 0, 0) },
    { name: 'tick am Maximum (u32)', frame: frame(4294967295, 0, 0, 0, 0) },
    { name: 'tick knapp unter dem Maximum', frame: frame(4294967294, 1, -1, 0, 0) },
    { name: 'mx am unteren Rand (i8)', frame: frame(7, -128, 0, 0, 0) },
    { name: 'mz am oberen Rand (i8)', frame: frame(7, 0, 127, 0, 0) },
    { name: 'mz am unteren Rand (i8)', frame: frame(7, 127, -128, 0, 0) },
    { name: 'buttons am Maximum (u8)', frame: frame(9, -1, -1, 255, 0) },
    { name: 'seq am Maximum (u8)', frame: frame(9, 0, 0, 0, 255) },
    { name: 'alles am Maximum', frame: frame(4294967295, 127, 127, 255, 255) },
    { name: 'alles am Minimum', frame: frame(0, -128, -128, 0, 0) },
  ];

  for (const testCase of CASES) {
    it(`überlebt: ${testCase.name}`, () => {
      const dst = new Uint8Array(INPUT_BYTES);
      packInput(testCase.frame, dst, 0);
      expect(unpackInput(dst, 0)).toEqual(testCase.frame);
    });
  }

  it('macht aus Bytes über 127 wieder negative mx/mz (Zweierkomplement)', () => {
    const src = new Uint8Array([0, 0, 0, 0, 0x80, 0xff, 0, 0]);
    const unpacked = unpackInput(src, 0);
    expect(unpacked.mx).toBe(-128);
    expect(unpacked.mz).toBe(-1);
  });

  it('liest tick als vorzeichenlose 32-Bit-Zahl, nicht als negative', () => {
    const src = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
    expect(unpackInput(src, 0).tick).toBe(4294967295);
  });

  it('packt mehrere Rahmen hintereinander in denselben Puffer', () => {
    const dst = new Uint8Array(2 * INPUT_BYTES);
    const first = frame(10, -5, 6, BUTTON_SPRINT, 1);
    const second = frame(11, 7, -8, BUTTON_INTERACT, 2);
    packInput(first, dst, 0);
    packInput(second, dst, INPUT_BYTES);
    expect(unpackInput(dst, 0)).toEqual(first);
    expect(unpackInput(dst, INPUT_BYTES)).toEqual(second);
  });
});

describe('neutralInput', () => {
  it('ist Stillstand mit dem gegebenen Tick und Zähler', () => {
    expect(neutralInput(42, 7)).toEqual({ seq: 7, tick: 42, mx: 0, mz: 0, buttons: 0 });
  });

  it('überlebt den Rundlauf unverändert', () => {
    const dst = new Uint8Array(INPUT_BYTES);
    packInput(neutralInput(0, 0), dst, 0);
    expect([...dst]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(unpackInput(dst, 0)).toEqual(neutralInput(0, 0));
  });
});

describe('Wächter – ein zu kurzer Puffer schluckt Schreibzugriffe still', () => {
  it('Uint8Array verschluckt Schreibzugriffe hinter dem Ende (die Begründung des Wächters)', () => {
    const tiny = new Uint8Array(2);
    tiny[5] = 9;
    expect(tiny.length).toBe(2);
    expect(tiny[5]).toBeUndefined();
  });

  it('packInput wirft, statt hinter das Ende zu schreiben', () => {
    const dst = new Uint8Array(INPUT_BYTES);
    expect(() => packInput(neutralInput(0, 0), dst, 1)).toThrow(RangeError);
    expect(() => packInput(neutralInput(0, 0), dst, -1)).toThrow(RangeError);
  });

  it('unpackInput wirft bei einem zu kurzen Puffer', () => {
    expect(() => unpackInput(new Uint8Array(7), 0)).toThrow(RangeError);
    expect(() => unpackInput(new Uint8Array(INPUT_BYTES), 1)).toThrow(RangeError);
  });

  it.each([
    { name: 'tick negativ', bad: frame(-1, 0, 0, 0, 0) },
    { name: 'tick über u32', bad: frame(4294967296, 0, 0, 0, 0) },
    { name: 'tick gebrochen', bad: frame(1.5, 0, 0, 0, 0) },
    { name: 'tick ist NaN', bad: frame(Number.NaN, 0, 0, 0, 0) },
    { name: 'mx unter -128', bad: frame(0, -129, 0, 0, 0) },
    { name: 'mx über 127', bad: frame(0, 128, 0, 0, 0) },
    { name: 'mz gebrochen', bad: frame(0, 0, 0.5, 0, 0) },
    { name: 'buttons über 255', bad: frame(0, 0, 0, 256, 0) },
    { name: 'seq über 255', bad: frame(0, 0, 0, 0, 256) },
  ])('packInput wirft bei $name', ({ bad }) => {
    expect(() => packInput(bad, new Uint8Array(INPUT_BYTES), 0)).toThrow(RangeError);
  });
});
