import './ui/shell.css';
import { BUILD_ID } from './platform/buildInfo';
import { installErrorPanel } from './platform/errorPanel';
import { initPwa } from './platform/pwa';
import { mountShell, type ShellHandles } from './ui/shell';
import { S } from './ui/strings';

const root = document.getElementById('app');
if (root === null) throw new Error('#app fehlt');

// Fehler-Panel VOR der Hülle: Wirft `mountShell`, sieht der Nutzer am Handy trotzdem eine
// Diagnose statt einer leeren Seite. Der Getter greift die Hülle erst beim Lesen ab.
let shell: ShellHandles | undefined = undefined;
const errors = installErrorPanel(() => shell?.getSwState() ?? '');

// EINMAL entschieden: entweder die Entwickler-Ansicht `?view=2d` (Canvas 2D, kein Babylon) ODER die
// Graybox. Beide hängen `window.__mb` ein, stehen aber nie zusammen auf einer Seite.
const params = new URLSearchParams(location.search);
const isView2d = params.get('view') === '2d';

shell = mountShell(root, {
  subtitle: S.shell.subtitleGame,
  note: S.shell.stageNoteGame,
  links: [{ href: `${import.meta.env.BASE_URL}lab.html`, label: S.shell.linkLab }],
  // Nur die Spielseite bekommt den Klapp-Knopf: `?view=2d` zeigt die Hülle in voller Höhe.
  collapsible: isView2d
    ? undefined
    : { collapsed: true, collapseLabel: S.shell.stripCollapse, expandLabel: S.shell.stripExpand },
});
initPwa(shell);

if (isView2d) {
  // Die Spielleinwand wird auf diesem Weg AUS DEM BAUM GENOMMEN, nicht nur verborgen. GEMESSEN:
  // `tests/e2e/view2d.spec.ts:102` greift mit `page.locator('canvas')` zu, und Playwrights Strict
  // Mode bricht bei ZWEI Treffern ab („resolved to 2 elements") – auch wenn einer `hidden` ist. Der
  // Spec bleibt damit wortgleich, und die 2D-Ansicht behält ihre einzige Leinwand.
  document.getElementById('game-canvas')?.remove();
  // NACH `mountShell`, nicht davor: die Hülle ruft `root.replaceChildren()` und löschte ein früher
  // eingehängtes Element. Der Import ist DYNAMISCH – so bleiben Kern und Level aus dem
  // Einstiegs-Chunk der Spielseite.
  const stage = document.createElement('div');
  stage.className = 'shell-stage';
  root.append(stage);
  void import('./render/view2d/main').then((module) => { module.mountView2d(stage, params); });
} else {
  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#game-canvas fehlt');
  root.classList.add('game-strip');
  canvas.hidden = false;
  // Die Build-ID wird INJIZIERT: `src/modes/hook.ts` und `src/render/debugOverlay.ts` dürfen
  // `src/platform/buildInfo.ts` nicht erreichen (Haken-Wächter). `mountGame` steht im try/catch, weil
  // ein fehlendes WebGL2 am Handy sonst nur eine schwarze Seite wäre – das Panel ist der Rückkanal.
  void import('./render/gameMain').then((module) => {
    try {
      module.mountGame(canvas, document.body, params, {
        buildId: BUILD_ID,
        report: (value) => { errors.report('error', value); },
      });
    } catch (error) {
      errors.report('error', error);
    }
  });
}
