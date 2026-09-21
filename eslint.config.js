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
const RENDER_IMPORT = { group: ['**/render', '**/render/**'], message: 'Diese Schicht darf render/ nicht importieren.' };
const NON_CORE_IMPORT = {
  group: ['**/render', '**/render/**', '**/ui', '**/ui/**', '**/net', '**/net/**', '**/platform', '**/platform/**',
    '**/input', '**/input/**', '**/audio', '**/audio/**', '**/modes', '**/modes/**', '**/lab', '**/lab/**'],
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
const NO_NEW_DATE = { selector: "NewExpression[callee.name='Date']", message: DETERMINISM_MSG };

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT] }],
      'no-restricted-syntax': ['error', NO_BABYLON_NAMESPACE, NO_AUDIO_CONTEXT],
    },
  },
  {
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
        'sessionStorage', 'indexedDB', 'fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'crypto'],
      'no-restricted-syntax': ['error', NO_BABYLON_NAMESPACE, NO_AUDIO_CONTEXT, NO_NEW_DATE],
    },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.mjs', 'tests/node/**/*.ts', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
