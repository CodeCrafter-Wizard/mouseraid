import { createClientJoin, createHostLobby } from '../net/connector';
import { createMessageRouter } from '../net/messageRouter';
import { attachPongResponder, runPingSeries } from '../net/pingTest';
import { PROTOCOL_VERSION } from '../net/protocol';
import { createTimeline } from '../net/timeline';

/** Test-Haken des Labors: die Netz-Schicht ohne UI, für `tests/e2e/lab-rtc.spec.ts`. */
export interface LabHook {
  createHostLobby: typeof createHostLobby;
  createClientJoin: typeof createClientJoin;
  createMessageRouter: typeof createMessageRouter;
  createTimeline: typeof createTimeline;
  runPingSeries: typeof runPingSeries;
  attachPongResponder: typeof attachPongResponder;
  PROTOCOL_VERSION: number;
}

/** Hängt den Haken als `window.__mbLab` ein. `labMain.ts` ruft das NUR bei `?hook=1` auf. */
export function installLabHook(): void {
  const hook: LabHook = {
    createHostLobby,
    createClientJoin,
    createMessageRouter,
    createTimeline,
    runPingSeries,
    attachPongResponder,
    PROTOCOL_VERSION,
  };
  (window as unknown as { __mbLab?: LabHook }).__mbLab = hook;
}
