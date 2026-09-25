import './ui/shell.css';
import { installErrorPanel } from './platform/errorPanel';
import { initPwa } from './platform/pwa';
import { mountShell, type ShellHandles } from './ui/shell';
import { S } from './ui/strings';

const root = document.getElementById('app');
if (root === null) throw new Error('#app fehlt');

// Fehler-Panel VOR der Hülle: Wirft `mountShell`, sieht der Nutzer am Handy trotzdem eine
// Diagnose statt einer leeren Seite. Der Getter greift die Hülle erst beim Lesen ab.
let shell: ShellHandles | undefined = undefined;
installErrorPanel(() => shell?.getSwState() ?? '');

shell = mountShell(root, {
  subtitle: S.shell.subtitleGame,
  note: S.shell.stageNoteGame,
  links: [{ href: `${import.meta.env.BASE_URL}lab.html`, label: S.shell.linkLab }],
});
initPwa(shell);

// Entwickler-Ansicht `?view=2d` (Canvas 2D, kein Babylon). NACH `mountShell`, nicht davor: die
// Hülle ruft `root.replaceChildren()` und löschte ein früher eingehängtes Element. Der Import ist
// DYNAMISCH – so bleiben Kern und Level aus dem Einstiegs-Chunk der Spielseite.
const params = new URLSearchParams(location.search);
if (params.get('view') === '2d') {
  const stage = document.createElement('div');
  stage.className = 'shell-stage';
  root.append(stage);
  void import('./render/view2d/main').then((module) => { module.mountView2d(stage, params); });
}
