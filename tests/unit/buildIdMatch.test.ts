import { describe, expect, it } from 'vitest';
import { matchesBuildId } from '../../src/platform/buildIdMatch';

// Dieselbe Regel gilt für `?expect=` (Hülle) und für `scripts/wait-for-deploy.mjs` (Deploy-Warten).
const CASES: [expected: string, live: string, matches: boolean][] = [
  ['abc12345', 'abc12345', true], // exakt
  ['abc1234', 'abc12345', true], // 7-stelliges Präfix (git-Standard-Kurz-SHA)
  ['abc123', 'abc12345', false], // 6 Stellen sind zu wenig
  ['abc12345', 'abc12346', false], // gleich lang, anderer Wert
  ['abc123456', 'abc12345', false], // erwartet ist länger als die laufende ID
  ['abc1234', 'abc12345-dirty-101530', false], // Präfix passt nie auf einen Dirty-Build
  ['abc12345', 'abc12345-dirty-101530', false], // auch nicht der volle Kurz-SHA
  ['abc12345-dirty-101530', 'abc12345-dirty-101530', true], // Dirty-Build nur exakt
  ['abc1234', 'HTTP 404', false], // Fehlertext aus wait-for-deploy ist keine Build-ID
  ['', '', true], // exakt gleich – der Aufrufer filtert leere Erwartungen vorher aus
  ['', 'abc12345', false],
];

describe('matchesBuildId', () => {
  it.each(CASES)('erwartet „%s", live „%s" → %s', (expected, live, matches) => {
    expect(matchesBuildId(expected, live)).toBe(matches);
  });
});
