import { describe, expect, it } from 'vitest';
import { updateCheckOutcome } from '../../src/platform/updateStatus';

describe('updateCheckOutcome', () => {
  it('meldet "loading", solange ein Worker installiert wird (auch neben einem wartenden)', () => {
    expect(updateCheckOutcome({ installing: {}, waiting: null })).toBe('loading');
    expect(updateCheckOutcome({ installing: {}, waiting: {} })).toBe('loading');
  });

  it('meldet "ready", wenn ein Worker fertig installiert wartet', () => {
    expect(updateCheckOutcome({ installing: null, waiting: {} })).toBe('ready');
  });

  it('meldet "upToDate", wenn weder installiert wird noch etwas wartet', () => {
    expect(updateCheckOutcome({ installing: null, waiting: null })).toBe('upToDate');
    expect(updateCheckOutcome({ installing: undefined, waiting: undefined })).toBe('upToDate');
  });
});
