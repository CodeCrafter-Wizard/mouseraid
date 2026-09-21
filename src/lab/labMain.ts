import { BUILD_ID } from '../platform/buildInfo';
import { S } from '../ui/strings';

const app = document.getElementById('app');
if (app) app.textContent = `${S.shell.subtitleLab} – ${S.shell.build} ${BUILD_ID}`;
