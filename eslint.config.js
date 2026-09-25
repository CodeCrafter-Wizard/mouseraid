import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Math-Funktionen, die laut ECMAScript nur "implementation-approximated" sind,
// plus Zufall/Zeit: im deterministischen Core verboten (Spec-Abweichung 2).
const BANNED_MATH = [
  'random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'pow', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'hypot', 'cbrt',
];
const DETERMINISM_MSG = 'Im deterministischen Core verboten – src/core/math/* bzw. den Tick-Zähler benutzen.';

// Reflexion über Feldnamen: `hashState`/`cloneState` laufen über eine handgeschriebene Feldfolge
// (Schema-Ordnung). Käme die Reihenfolge aus `Object.keys`, änderte eine Feldumbenennung still den
// Golden-Hash – ohne dass der Test die Ursache zeigt (M3).
const BANNED_OBJECT = ['keys', 'values', 'entries', 'assign', 'fromEntries'];
const SCHEMA_MSG = 'Im deterministischen Core verboten – Hash und Klon laufen über die handgeschriebene Feldfolge, nicht über Feldnamen.';
// Daten kommen als `unknown` in die Loader; das Lesen und Parsen passiert außerhalb des Kerns (M3, D12).
const JSON_MSG = 'Im deterministischen Core verboten – Daten werden injiziert (`unknown`), nie im Kern geparst oder serialisiert.';

const corePropertyBans = [
  ...BANNED_MATH.map((property) => ({ object: 'Math', property, message: DETERMINISM_MSG })),
  { object: 'Date', property: 'now', message: DETERMINISM_MSG },
  { object: 'performance', property: 'now', message: DETERMINISM_MSG },
  ...BANNED_OBJECT.map((property) => ({ object: 'Object', property, message: SCHEMA_MSG })),
  { object: 'JSON', property: 'parse', message: JSON_MSG },
  { object: 'JSON', property: 'stringify', message: JSON_MSG },
];

const LEGACY_IMPORT = {
  group: ['@babylonjs/core/Legacy', '@babylonjs/core/Legacy/**'],
  message: 'Kein Legacy-Barrel – nur gezielte (pure) Importe, sonst explodiert das Bundle.',
};
const BABYLON_IMPORT = {
  group: ['@babylonjs/*', '@babylonjs/**'],
  message: 'Diese Schicht darf Babylon nicht kennen.',
};
// Eine fremde Schicht erreicht man nur über den Weg nach oben (`../…`) oder über `src/` – daran wird
// sie erkannt. Gitignore-artige Gruppen (`**/input`) würden auch core-INTERNE Module wie `./input`
// oder `../sim/input` (src/core/sim/input.ts ist laut Design ein Core-Modul) verbieten.
/**
 * Trifft jeden Pfad, in dem direkt hinter einem Segment `..` oder `src` eine der Schichten folgt –
 * auch mit `.`-Segmenten oder doppelten Schrägstrichen dazwischen (`./../render`, `..//render`,
 * `.././render`, `../../../src/render`). Ein Schichtname hinter einem anderen Ordner (`../sim/input`)
 * oder hinter `./` bleibt frei.
 * @param {string[]} layers
 */
function layerImportRegex(layers) {
  return `(?:^|/)(?:\\.\\.|src)/+(?:\\./+)*(?:${layers.join('|')})(?:/|$)`;
}
const RENDER_IMPORT = { regex: layerImportRegex(['render']), message: 'Diese Schicht darf render/ nicht importieren.' };
const NON_CORE_IMPORT = {
  regex: layerImportRegex(['render', 'ui', 'net', 'platform', 'input', 'audio', 'modes', 'lab']),
  message: 'core/ darf keine andere Schicht importieren.',
};
// M4: das Labor bleibt aus dem Spiel-Bundle. Bisher fing das erst `findLabSignatures` im gebauten
// Bundle ab – und auch nur, wenn eine der drei gesuchten Zeichenketten das Tree-Shaking überlebt.
const NET_LAB_IMPORT = {
  regex: layerImportRegex(['net', 'lab']),
  message: 'Spiel-Schichten duerfen net/ und lab/ nicht importieren – das Labor bleibt aus dem Spiel-Bundle.',
};
// M4/D5: die Tastatur ist ein reiner Reducer über `InputFrame`. Wer hier ein DOM-Ereignis, einen
// String oder eine Kamera braucht, baut die Verdrahtung an die falsche Stelle (die steht in
// `src/render/view2d/main.ts`, ab M5 in `src/modes/`).
const INPUT_FOREIGN_IMPORT = {
  regex: layerImportRegex(['render', 'ui', 'net', 'platform', 'audio', 'modes', 'lab']),
  message: 'src/input darf nur src/core importieren.',
};

const NO_BABYLON_NAMESPACE = {
  selector: 'ImportDeclaration[source.value=/^@babylonjs\\u002F/] > ImportNamespaceSpecifier',
  message: 'Kein `import * as` aus Babylon – verhindert Tree-Shaking.',
};
const NO_AUDIO_CONTEXT = {
  selector: 'NewExpression[callee.name=/^(AudioContext|webkitAudioContext)$/]',
  message: 'Genau ein AudioContext: nur src/audio/audioBus.ts darf ihn erzeugen.',
};
const NO_AUDIO_CONTEXT_MEMBER = {
  selector: "NewExpression[callee.type='MemberExpression'][callee.property.name=/^(AudioContext|webkitAudioContext)$/]",
  message: 'Genau ein AudioContext: nur src/audio/audioBus.ts darf ihn erzeugen.',
};
const NO_NEW_DATE = { selector: "NewExpression[callee.name='Date']", message: DETERMINISM_MSG };
// `**` ist laut ECMAScript genau wie Math.pow nur "implementation-approximated".
const NO_EXPONENT = { selector: "BinaryExpression[operator='**']", message: DETERMINISM_MSG };
const NO_EXPONENT_ASSIGN = { selector: "AssignmentExpression[operator='**=']", message: DETERMINISM_MSG };
// `for…in` ist der Umweg um das Object.keys-Verbot: dieselbe namensabhängige Laufordnung, nur ohne
// Aufruf. Iteriert wird im Kern über Arrays (`for…of`), damit die Reihenfolge an der Schemafolge hängt.
const NO_FOR_IN = { selector: 'ForInStatement', message: SCHEMA_MSG };

// ACHTUNG: Flat Config ERSETZT die Optionen einer Regel pro passendem Block, sie summiert sie
// nicht. Ein Selektor, der nur unten im `src/**`-Block stünde, fehlte im core-Block still. Deshalb
// bauen alle drei no-restricted-syntax-Listen auf diesen beiden Konstanten auf.
const SYNTAX_BANS = [NO_BABYLON_NAMESPACE, NO_AUDIO_CONTEXT, NO_AUDIO_CONTEXT_MEMBER];
const CORE_SYNTAX_BANS = [...SYNTAX_BANS, NO_NEW_DATE, NO_EXPONENT, NO_EXPONENT_ASSIGN, NO_FOR_IN];

export default tseslint.config(
  // `.superpowers/` ist git-ignoriert (Arbeitsdateien der Agenten) – Flat Config überspringt Punkt-Ordner NICHT von selbst.
  { ignores: ['dist/**', 'dev-dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'node_modules/**', '.superpowers/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT] }],
      'no-restricted-syntax': ['error', ...SYNTAX_BANS],
    },
  },
  {
    // Ersetzt die Liste oben absichtlich: genau hier darf der eine AudioContext entstehen.
    files: ['src/audio/audioBus.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_BABYLON_NAMESPACE] },
  },
  {
    files: ['src/net/**/*.ts', 'src/lab/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT, BABYLON_IMPORT, RENDER_IMPORT] }] },
  },
  {
    // Babylon bleibt hier ERLAUBT – M5 braucht es. Verboten sind nur net/ und lab/.
    // LEGACY_IMPORT steht noch einmal in der Liste: Flat Config ERSETZT die Optionen einer Regel je
    // passendem Block, sie summiert sie nicht – ohne die Wiederholung fiele das Legacy-Verbot für
    // render/ still weg.
    files: ['src/render/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT, NET_LAB_IMPORT] }] },
  },
  {
    // `src/input/**` darf NUR `src/core` sehen – Babylon also auch nicht (anders als render/).
    files: ['src/input/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT, BABYLON_IMPORT, INPUT_FOREIGN_IMPORT] }] },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [BABYLON_IMPORT, NON_CORE_IMPORT] }],
      'no-restricted-properties': ['error', ...corePropertyBans],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'performance', 'localStorage',
        'sessionStorage', 'indexedDB', 'fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'crypto',
        'self', 'globalThis', 'location', 'history', 'screen'],
      'no-restricted-syntax': ['error', ...CORE_SYNTAX_BANS],
    },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.mjs', 'tests/node/**/*.ts', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // adb/CDP-Spike: läuft in Node, aber page.evaluate() greift auf das Handy-DOM zu.
    files: ['scripts/spike-adb-cdp.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
