import '../ui/shell.css';
import { installErrorPanel } from '../platform/errorPanel';
import { initPwa } from '../platform/pwa';
import { mountShell } from '../ui/shell';
import { S } from '../ui/strings';

const root = document.getElementById('app');
if (root === null) throw new Error('#app fehlt');

const yesNo = (value: boolean): string => (value ? S.labInfo.yes : S.labInfo.no);

const shell = mountShell(root, {
  subtitle: S.shell.subtitleLab,
  note: S.shell.stageNoteLab,
  links: [{ href: import.meta.env.BASE_URL, label: S.shell.linkGame }],
  info: [
    { label: S.labInfo.secureContext, value: yesNo(isSecureContext) },
    { label: S.labInfo.rtc, value: yesNo('RTCPeerConnection' in window) },
    { label: S.labInfo.camera, value: yesNo(navigator.mediaDevices !== undefined) },
  ],
});
installErrorPanel(shell.getSwState);
initPwa(shell);
