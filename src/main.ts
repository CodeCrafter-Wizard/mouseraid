import { BUILD_ID } from './platform/buildInfo';
import { S } from './ui/strings';

const app = document.getElementById('app');
if (app) app.textContent = `${S.appName} – ${S.shell.build} ${BUILD_ID}`;
