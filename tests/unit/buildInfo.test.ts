import { describe, expect, it } from 'vitest';
import { BUILD_ID, checkExpectedBuild, expectedBuild } from '../../src/platform/buildInfo';

describe('buildInfo', () => {
  it('stellt die per define injizierte Build-ID bereit', () => {
    expect(BUILD_ID).toBe('test-build');
  });

  it('meldet "none", wenn kein ?expect= gesetzt ist', () => {
    expect(checkExpectedBuild('', 'abc12345')).toBe('none');
    expect(checkExpectedBuild('?view=2d', 'abc12345')).toBe('none');
    expect(checkExpectedBuild('?expect=', 'abc12345')).toBe('none');
  });

  it('meldet "match" bzw. "mismatch" für ?expect=', () => {
    expect(checkExpectedBuild('?expect=abc12345', 'abc12345')).toBe('match');
    expect(checkExpectedBuild('?x=1&expect=zzz', 'abc12345')).toBe('mismatch');
  });

  it('akzeptiert ein mindestens 7-stelliges Praefix einer sauberen Build-ID (git-Standard-Kurz-SHA)', () => {
    expect(checkExpectedBuild('?expect=abc1234', 'abc12345')).toBe('match');
    expect(checkExpectedBuild('?expect=abc123', 'abc12345')).toBe('mismatch');
  });

  it('vergleicht Dirty-Builds nur exakt – ein Praefix darf nie auf einen -dirty-Build passen', () => {
    expect(checkExpectedBuild('?expect=abc1234', 'abc12345-dirty-101530')).toBe('mismatch');
    expect(checkExpectedBuild('?expect=abc12345', 'abc12345-dirty-101530')).toBe('mismatch');
    expect(checkExpectedBuild('?expect=abc12345-dirty-101530', 'abc12345-dirty-101530')).toBe('match');
  });

  it('liefert den erwarteten Wert zur Anzeige', () => {
    expect(expectedBuild('?expect=zzz')).toBe('zzz');
    expect(expectedBuild('')).toBeNull();
  });
});
