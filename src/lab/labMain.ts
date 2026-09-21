import '../ui/shell.css';
import { installErrorPanel } from '../platform/errorPanel';
import { initPwa } from '../platform/pwa';
import { mountShell, type ShellHandles } from '../ui/shell';
import { S } from '../ui/strings';
import { installLabHook } from './labHook';

const root = document.getElementById('app');
if (root === null) throw new Error('#app fehlt');

const yesNo = (value: boolean): string => (value ? S.labInfo.yes : S.labInfo.no);

// Fehler-Panel VOR der Hülle: Wirft `mountShell`, sieht der Nutzer am Handy trotzdem eine
// Diagnose statt einer leeren Seite. Der Getter greift die Hülle erst beim Lesen ab.
let shell: ShellHandles | undefined = undefined;
installErrorPanel(() => shell?.getSwState() ?? '');

shell = mountShell(root, {
  subtitle: S.shell.subtitleLab,
  note: S.shell.stageNoteLab,
  links: [{ href: import.meta.env.BASE_URL, label: S.shell.linkGame }],
  info: [
    { label: S.labInfo.secureContext, value: yesNo(isSecureContext) },
    { label: S.labInfo.rtc, value: yesNo('RTCPeerConnection' in window) },
    { label: S.labInfo.camera, value: yesNo(navigator.mediaDevices !== undefined) },
  ],
});
initPwa(shell);

// Test-Haken für tests/e2e/lab-rtc.spec.ts: die Netz-Schicht ohne UI. Nur mit ?hook=1, nie im Normalbetrieb.
if (new URLSearchParams(location.search).get('hook') === '1') installLabHook();
