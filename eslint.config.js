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
// M5/Abweichung 4: die drei SAMMEL-Einstiege sind überall verboten – und zwar als `paths`
// (WÖRTLICHER Vergleich des Spezifizierers), NICHT als `patterns`. GEMESSEN: als `group`-Muster
// trifft '@babylonjs/core' gitignore-artig AUCH jeden tiefen Pfad darunter; `npx eslint .` meldete
// damit 41 Fehler an genau den erlaubten Importen.
const BABYLON_BARREL_PATHS = [
  { name: '@babylonjs/core', message: 'Kein Barrel – nur gezielte tiefe Importe.' },
  {
    name: '@babylonjs/core/pure',
    message: 'Kein `pure`-Barrel (51 `export *`) – es überlässt das Tree-Shaking dem Bundler, statt es zu erzwingen.',
  },
  {
    name: '@babylonjs/core/Engines/engine',
    message: 'Nur `…/engine.pure` plus die Einzel-Erweiterungen aus src/render/babylonRegistry.ts – der Sammel-Import holt KTX2/Basis ins Bundle (gemessen).',
  },
];
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
// M5/Abschlussreview (quality MAJOR-2): `src/platform` liegt UNTER render/ und modes/ – `quality.ts`
// leitet `QualityTier` aus dem Einstellungs-Schema ab, und ein Import in der anderen Richtung baute
// den Zyklus platform → render → platform.
const RENDER_MODES_IMPORT = {
  regex: layerImportRegex(['render', 'modes']),
  message: 'Diese Schicht liegt unter render/ und modes/ und darf sie nicht importieren.',
};
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
const INPUT_FOREIGN_LAYERS = ['render', 'ui', 'net', 'platform', 'audio', 'modes', 'lab'];
const INPUT_FOREIGN_IMPORT = {
  regex: layerImportRegex(INPUT_FOREIGN_LAYERS),
  message: 'src/input darf nur src/core importieren.',
};

/**
 * Dieselbe Schichtgrenze für den DYNAMISCHEN Weg: `no-restricted-imports` sieht nur statische
 * Importe und `export … from`, ein `await import('../../lab/report')` kam vorher durch. Gefangen
 * hätte das erst `findLabSignatures` im gebauten Bundle – und auch nur, wenn die gesuchte
 * Zeichenkette das Tree-Shaking überlebt.
 *
 * `/` muss im Selektor als `\u002F` stehen, sonst beendet es das Regex-Literal des esquery-Ausdrucks
 * (dieselbe Schreibweise wie in NO_BABYLON_NAMESPACE).
 * @param {string[]} layers
 * @param {string} message
 */
function dynamicImportBan(layers, message) {
  return {
    selector: `ImportExpression[source.value=/${layerImportRegex(layers).replaceAll('/', '\\u002F')}/]`,
    message,
  };
}
const NO_NET_LAB_DYNAMIC = dynamicImportBan(['net', 'lab'], NET_LAB_IMPORT.message);
const NO_INPUT_FOREIGN_DYNAMIC = dynamicImportBan(INPUT_FOREIGN_LAYERS, INPUT_FOREIGN_IMPORT.message);
const NO_RENDER_DYNAMIC = dynamicImportBan(['render'], RENDER_IMPORT.message);
const NO_RENDER_MODES_DYNAMIC = dynamicImportBan(['render', 'modes'], RENDER_MODES_IMPORT.message);

const NO_BABYLON_NAMESPACE = {
  selector: 'ImportDeclaration[source.value=/^@babylonjs\\u002F/] > ImportNamespaceSpecifier',
  message: 'Kein `import * as` aus Babylon – verhindert Tree-Shaking.',
};
// M5: dieselbe Babylon-Grenze für den DYNAMISCHEN Weg. `no-restricted-imports` sieht nur statische
// Importe – ein `await import('@babylonjs/core/Engines/engine.pure')` käme in `src/modes/**` und
// `src/render/view2d/**` sonst durch, und Babylon landete in genau dem Chunk, der schlank bleiben soll.
const NO_BABYLON_DYNAMIC = {
  selector: 'ImportExpression[source.value=/^@babylonjs\\u002F/]',
  message: BABYLON_IMPORT.message,
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

/**
 * Browser-Globals, die eine REINE Schicht nicht anfassen darf. Eine Liste für `src/core`
 * (Determinismus: keine Uhr, kein Timer, kein Zufall von außen) und für `src/input` (reiner
 * Reducer über `InputFrame`, D5) – zwei Kopien liefen auseinander, sobald eine erweitert wird.
 * Die Verdrahtung der Ereignisse steht in `src/render/view2d/main.ts`, ab M5 in `src/modes/`.
 */
const DOM_GLOBALS = ['window', 'document', 'navigator', 'performance', 'localStorage',
  'sessionStorage', 'indexedDB', 'fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'crypto',
  'self', 'globalThis', 'location', 'history', 'screen'];

export default tseslint.config(
  // `.superpowers/` ist git-ignoriert (Arbeitsdateien der Agenten) – Flat Config überspringt Punkt-Ordner NICHT von selbst.
  { ignores: ['dist/**', 'dev-dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'node_modules/**', '.superpowers/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', { paths: BABYLON_BARREL_PATHS, patterns: [LEGACY_IMPORT] }],
      'no-restricted-syntax': ['error', ...SYNTAX_BANS],
    },
  },
  {
    // M5/Abschlussreview (determinism Minor 1): `src/platform/**`, `src/ui/**` und `src/audio/**`
    // trugen GAR KEINE Babylon-Schranke – der allgemeine `src/**`-Block sperrt nur die drei
    // Sammel-Einstiege und das Legacy-Barrel, `SYNTAX_BANS` enthält `NO_BABYLON_DYNAMIC` nicht. Ein
    // TIEFER Babylon-Import war dort also statisch wie dynamisch erlaubt (gemessen). `src/ui/shell.ts`
    // und `src/platform/storage.ts` hängen am EIFRIGEN Einstiegs-Chunk: ein Babylon-Import dort zöge
    // den ~980-kB-Chunk aus dem lazy `gameMain`-Chunk in den Einstieg, und die Code-Teilung, auf der
    // M5 aufbaut, wäre still weg. `src/ui` bekommt die net/lab-Sperre bewusst NICHT (`strings.ts`
    // importiert einen Typ aus `src/net/failureCodes`).
    files: ['src/ui/**/*.ts', 'src/audio/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT, BABYLON_IMPORT] }],
      'no-restricted-syntax': ['error', ...SYNTAX_BANS, NO_BABYLON_DYNAMIC],
    },
  },
  {
    // M5/Abschlussreview (quality MAJOR-2): `src/platform` ist die UNTERSTE Browser-Schicht.
    // `storage.ts:1` und `render/quality.ts:6` nannten „platform kennt render nicht" als Regel, ohne
    // dass sie erzwungen war – und ein solcher Import baute zugleich den Zyklus
    // platform → render → platform, weil `quality.ts` schon `storage.ts` liest. Erlaubt bleibt genau,
    // was die Schicht heute braucht: die eigenen Geschwister, `src/ui` (Texte, Hüllen-Typ), `idb` und
    // `virtual:pwa-register`.
    files: ['src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: BABYLON_BARREL_PATHS,
        patterns: [LEGACY_IMPORT, BABYLON_IMPORT, RENDER_MODES_IMPORT, NET_LAB_IMPORT],
      }],
      'no-restricted-syntax': ['error', ...SYNTAX_BANS, NO_BABYLON_DYNAMIC, NO_RENDER_MODES_DYNAMIC, NO_NET_LAB_DYNAMIC],
    },
  },
  {
    // Ersetzt die Liste oben absichtlich: genau hier darf der eine AudioContext entstehen. Steht NACH
    // dem `src/audio/**`-Block (bei Flat Config gewinnt der spätere) und trägt `NO_BABYLON_DYNAMIC`
    // mit, weil Flat Config die Optionen einer Regel ERSETZT und nicht summiert – sonst wäre genau
    // diese eine Datei das Loch in der neuen Babylon-Schranke.
    files: ['src/audio/audioBus.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_BABYLON_NAMESPACE, NO_BABYLON_DYNAMIC] },
  },
  {
    // T1-Review, Minor 5: `no-restricted-imports` sieht nur den STATISCHEN Weg – ein
    // `await import('@babylonjs/core/Engines/engine.pure')` kam hier bisher durch (GEMESSEN).
    // SYNTAX_BANS steht mit in der Liste: Flat Config ERSETZT die Optionen einer Regel je passendem
    // Block, sie summiert sie nicht – ohne die Wiederholung fiele das Babylon-Namespace-/
    // AudioContext-Verbot für net/lab still weg (dieser Block hatte vorher GAR KEIN
    // `no-restricted-syntax` und erbte es nur vom allgemeinen `src/**/*.ts`-Block).
    files: ['src/net/**/*.ts', 'src/lab/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT, BABYLON_IMPORT, RENDER_IMPORT] }],
      // `NO_RENDER_DYNAMIC` gehört dazu, seit es die Konstante gibt: die statische Sperre stand hier
      // schon, der dynamische Weg nach render/ war offen.
      'no-restricted-syntax': ['error', ...SYNTAX_BANS, NO_BABYLON_DYNAMIC, NO_RENDER_DYNAMIC],
    },
  },
  {
    // Babylon bleibt hier ERLAUBT – M5 braucht es. Verboten sind nur net/ und lab/ und die drei
    // Sammel-Einstiege (BABYLON_BARREL_PATHS).
    // LEGACY_IMPORT steht noch einmal in der Liste: Flat Config ERSETZT die Optionen einer Regel je
    // passendem Block, sie summiert sie nicht – ohne die Wiederholung fiele das Legacy-Verbot für
    // render/ still weg.
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: BABYLON_BARREL_PATHS, patterns: [LEGACY_IMPORT, NET_LAB_IMPORT] }],
      // SYNTAX_BANS steht wieder mit in der Liste: Flat Config ERSETZT die Optionen einer Regel je
      // passendem Block. Ohne die Wiederholung fiele das Babylon-Namespace-Verbot fuer render/ weg.
      'no-restricted-syntax': ['error', ...SYNTAX_BANS, NO_NET_LAB_DYNAMIC],
    },
  },
  {
    // M5/Q4: `src/modes/**` orchestriert core + input + platform – es kennt weder net/ und lab/ noch
    // Babylon. Genau deshalb sind `fixedLoop` und `soloSession` in Vitest ohne DOM prüfbar: die Grafik
    // kommt als Rückruf `render(alpha)` herein.
    // M5/Abschlussreview (quality MAJOR-3): `render/` ist jetzt AUCH gesperrt. `no-restricted-imports`
    // vergleicht nur den Spezifizierer der Datei selbst, ein `import … from '../render/engine'` wäre
    // also lint- und typecheck-grün gewesen – und `engine.ts` ist genau die Datei, die
    // `./babylonRegistry` mit seinen 17 Nebenwirkungs-Importen zieht. Die Richtung ist render → modes
    // (Typ-Import in `debugOverlay`, Wert-Import in `gameMain`), nie umgekehrt.
    // LEGACY_IMPORT und SYNTAX_BANS stehen wieder mit in der Liste (Flat Config ersetzt, summiert nicht).
    files: ['src/modes/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [LEGACY_IMPORT, BABYLON_IMPORT, NET_LAB_IMPORT, RENDER_IMPORT],
      }],
      'no-restricted-syntax': ['error', ...SYNTAX_BANS, NO_NET_LAB_DYNAMIC, NO_BABYLON_DYNAMIC, NO_RENDER_DYNAMIC],
    },
  },
  {
    // M5/D11: die 2D-Ansicht ist der Babylon-FREIE Entwickler- und Rückfallweg; ihr Chunk bleibt
    // klein. Dieser Block VERSCHÄRFT den `src/render/**`-Block und steht deshalb NACH ihm – bei
    // Flat Config gewinnt der spätere Block.
    files: ['src/render/view2d/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT, BABYLON_IMPORT, NET_LAB_IMPORT] }],
      'no-restricted-syntax': ['error', ...SYNTAX_BANS, NO_NET_LAB_DYNAMIC, NO_BABYLON_DYNAMIC],
    },
  },
  {
    // `src/input/**` darf NUR `src/core` sehen – Babylon also auch nicht (anders als render/) – und
    // kein DOM anfassen: die Tastatur ist ein reiner Reducer, die Verdrahtung steht in render/.
    files: ['src/input/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LEGACY_IMPORT, BABYLON_IMPORT, INPUT_FOREIGN_IMPORT] }],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
      // T1-Review, Minor 5: NO_BABYLON_DYNAMIC ergänzt – derselbe dynamische Weg wie in render/modes.
      'no-restricted-syntax': ['error', ...SYNTAX_BANS, NO_INPUT_FOREIGN_DYNAMIC, NO_BABYLON_DYNAMIC],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [BABYLON_IMPORT, NON_CORE_IMPORT] }],
      'no-restricted-properties': ['error', ...corePropertyBans],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
      // T1-Review, Minor 5: NO_BABYLON_DYNAMIC ergänzt – derselbe dynamische Weg wie in render/modes.
      'no-restricted-syntax': ['error', ...CORE_SYNTAX_BANS, NO_BABYLON_DYNAMIC],
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
