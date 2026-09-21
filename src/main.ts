import './ui/shell.css';
import { installErrorPanel } from './platform/errorPanel';
import { initPwa } from './platform/pwa';
import { mountShell } from './ui/shell';
import { S } from './ui/strings';

const root = document.getElementById('app');
if (root === null) throw new Error('#app fehlt');

const shell = mountShell(root, {
  subtitle: S.shell.subtitleGame,
  note: S.shell.stageNoteGame,
  links: [{ href: `${import.meta.env.BASE_URL}lab.html`, label: S.shell.linkLab }],
});
installErrorPanel(shell.getSwState);
initPwa(shell);
