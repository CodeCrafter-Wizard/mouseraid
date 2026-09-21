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

const corePropertyBans = [
  ...BANNED_MATH.map((property) => ({ object: 'Math', property, message: DETERMINISM_MSG })),
  { object: 'Date', property: 'now', message: DETERMINISM_MSG },
  { object: 'performance', property: 'now', message: DETERMINISM_MSG },
];

const LEGACY_IMPORT = {
  group: ['@babylonjs/core/Legacy', '@babylonjs/core/Legacy/**'],
  message: 'Kein Legacy-Barrel – nur gezielte (pure) Importe, sonst explodiert das Bundle.',
};
const BABYLON_IMPORT = {
  group: ['@babylonjs/*', '@babylonjs/**'],
  message: 'Diese Schicht darf Babylon nicht kennen.',
};
// Eine fremde Schicht erreicht man nur über den Weg nach oben (`../…`) – daran wird sie erkannt.
// Gitignore-artige Gruppen (`**/input`) würden auch core-INTERNE Module wie `./input` oder
// `../sim/input` (src/core/sim/input.ts ist laut Design ein Core-Modul) verbieten.
const RENDER_IMPORT = { regex: '^(?:\\.\\./)+render(?:/|$)', message: 'Diese Schicht darf render/ nicht importieren.' };
const NON_CORE_IMPORT = {
  regex: '^(?:\\.\\./)+(?:render|ui|net|platform|input|audio|modes|lab)(?:/|$)',
  message: 'core/ darf keine andere Schicht importieren.',
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

// ACHTUNG: Flat Config ERSETZT die Optionen einer Regel pro passendem Block, sie summiert sie
// nicht. Ein Selektor, der nur unten im `src/**`-Block stünde, fehlte im core-Block still. Deshalb
// bauen alle drei no-restricted-syntax-Listen auf diesen beiden Konstanten auf.
const SYNTAX_BANS = [NO_BABYLON_NAMESPACE, NO_AUDIO_CONTEXT, NO_AUDIO_CONTEXT_MEMBER];
const CORE_SYNTAX_BANS = [...SYNTAX_BANS, NO_NEW_DATE, NO_EXPONENT, NO_EXPONENT_ASSIGN];

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'node_modules/**'] },
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
