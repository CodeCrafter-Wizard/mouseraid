/**
 * Verdrahtung der Spielseite: Engine -> Szene -> Sitzung -> Schleife -> Kamera -> Overlay -> Haken.
 *
 * Die EINZIGE Stelle, die alles kennt. `src/modes/**` bleibt Babylon-frei und `src/modes/hook.ts`
 * importfrei – deshalb entsteht das `MbHook`-Objekt hier und nicht in der Sitzung: `stats()` trägt
 * die Babylon-Zähler, die Panel-Rate, die Qualitätsstufe und die INJIZIERTE Build-ID.
 *
 * Wie `view2d/main.ts` ist das auch die Stelle, die JSON-Dateien importiert – der Kern tut das nie
 * (D12), er bekommt sie hier als `unknown` in die Loader gereicht.
 */
import balanceJson from '../data/balance.json';
import levelJson from '../data/levels/feinkost.json';
import { loadBalance } from '../core/data/balanceLoad';
import { TICK_RATE } from '../core/sim/tick';
import { createKeyboard } from '../input/keyboard';
import { installGameHook } from '../modes/hook';
import type { MbCommand, MbHook, MbStats } from '../modes/hook';
import { DEFAULT_SEED, assertAdvanceRange, assertInputRange, createSoloSession } from '../modes/soloSession';
import { DEFAULT_SETTINGS, applySearchOverrides, openSettingsStore } from '../platform/storage';
import type { Settings, SettingsBackend, SettingsStore } from '../platform/storage';
import { applyActors } from './actors';
import { createPanelMeter, medianOf, renderDivider } from './cadence';
import { createCameraRig } from './cameraRig';
import { OVERLAY_TOGGLE_CODE, createDebugOverlay, createInstrumentation, createPercentiles } from './debugOverlay';
import { createEngine } from './engine';
import type { QualityTier } from './quality';
import { buildSceneRoot } from './sceneRoot';

/** Kantenlänge des Rasters von `cmd.grid`, wenn der Aufrufer keine nennt: 16 x 16 = 256 Proben. */
export const GRID_STEP = 16;
/** Fenster, aus dem `stats().fps` seinen Median zieht – `engine.getFps()` log gemessen 60 bei 132/s. */
const FPS_WINDOW = 30;
/** Grenze von `cmd.grid(step)`: ein Raster feiner als die Leinwand ist keine Probe mehr. */
const MAX_GRID_STEP = 256;

export interface MountGameOptions {
  /** INJIZIERT – `hook.ts` und `debugOverlay.ts` erreichen `platform/buildInfo` nie. */
  buildId: string;
  /** `installErrorPanel().report` aus `src/main.ts` – am Handy der einzige Rückkanal. */
  report?(value: unknown): void;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${path}: endliche Zahl erwartet, bekam ${String(value)}`);
  }
  return value;
}

/**
 * Welcher Overlay-Zustand gilt, wenn der ASYNCHRONE Speicher antwortet?
 *
 * Hat der Nutzer bis dahin schon F3 getippt (`touched`), gewinnt SEIN Zustand – sonst der
 * gespeicherte. Ohne diese Merkzelle nahm der Erfüllungszweig von `openSettingsStore()` die
 * Umschaltung still zurück (Task-6-Review, Minor 4): das Fenster ist schmal, aber ein Test oder ein
 * langsamer privater Modus mit Rückfall trifft es. Die Regel steht als REINE Funktion hier, damit
 * genau sie prüfbar ist – die Verdrahtung darum ist es nicht (sie braucht eine echte Engine).
 */
export function effectiveOverlay(stored: boolean, touched: boolean, current: boolean): boolean {
  return touched ? current : stored;
}

/**
 * Hängt die Graybox an die Leinwand. `host` ist die Stelle, an die das F3-Overlay kommt
 * (`document.body` – eine Leinwand kann kein Kind tragen).
 *
 * URL-Parameter, nur Entwicklung und Tests: `?clock=manual` (kein rAF, gerechnet wird über
 * `__mb.advance`), `?seed=` (Vorgabe '1'), `?tier=low|medium|high` und `?overlay=1` (beide
 * überschreiben den gespeicherten Wert – bei DPR 1,0 ist der Stufen-Sweep am Entwicklungsrechner
 * sonst gar nicht auszulösen). `?autostart=1` ist RESERVIERT und tut nichts: das Gate ist M6.
 */
export function mountGame(
  canvas: HTMLCanvasElement, host: HTMLElement, search: URLSearchParams, options: MountGameOptions,
): void {
  const balance = loadBalance(balanceJson);
  const manual = search.get('clock') === 'manual';
  // EINE Auslegung von `?tier=`/`?overlay=` – die Regel steht in `storage.ts` (T5), nicht hier (R12).
  const wanted: Settings = applySearchOverrides(DEFAULT_SETTINGS, search);
  let tier: QualityTier = wanted.qualityTier;
  let store: SettingsStore | undefined = undefined;

  const gameEngine = createEngine(canvas, tier, window.devicePixelRatio);
  const keyboard = createKeyboard();
  const panelMeter = createPanelMeter();
  const cpuP95 = createPercentiles();
  const frameDeltas: number[] = [];
  /** F3 getippt? Dann darf der nachträglich gelesene Speicher den Zustand nicht zurückdrehen. */
  let overlayTouched = false;

  let steps = 0;
  let frameMs = 0;
  let drawCalls = 0;
  let triangles = 0;
  let gpuMs = 0;
  let lastRenderAt = -1;
  let storage: SettingsBackend = 'memory';

  const session = createSoloSession({
    levelJson,
    balanceJson,
    seed: search.get('seed') ?? DEFAULT_SEED,
    keyboard,
    clock: {
      now: () => performance.now(),
      requestFrame: (run) => window.requestAnimationFrame(run),
      cancelFrame: (handle) => { window.cancelAnimationFrame(handle); },
    },
    render: (alpha) => { drawFrame(alpha); },
    // `onFrame` liefert die ganze `FrameStats` (Vertrag, R9); `stats().steps` ist genau ihr Feld
    // `steps` – die Simulationsschritte des letzten Bildes.
    onFrame: (frame) => { steps = frame.steps; },
    manual,
  });

  // DIESE VIER liest `drawFrame`, und sie entstehen NACH der Sitzung – `buildSceneRoot` braucht
  // `session.runtime`, die Reihenfolge ist also keine Wahl. Die Sitzung startet die Schleife selbst
  // (R9), das erste Bild fällt aber nicht vor dem Ende dieser Funktion: `clock.requestFrame` ist
  // `window.requestAnimationFrame` und ruft NIE synchron zurück, und der einzige synchrone Weg ins
  // Bild ist `session.loop.advance(0)` in der letzten Zeile. Wer die Uhr in einem Test synchron
  // planen ließe, bekäme hier einen TDZ-`ReferenceError` – dann gehört der Aufbau umgebaut, nicht
  // die Uhr.
  const root = buildSceneRoot(gameEngine.scene, session.runtime, balance);
  const rig = createCameraRig(gameEngine.camera, session.runtime, root.meshes);
  const instrumentation = createInstrumentation(gameEngine.engine, gameEngine.scene);
  const overlay = createDebugOverlay(host);
  overlay.setVisible(wanted.overlay);

  /**
   * Ein Bild. Die Reihenfolge ist Vertrag: Figuren setzen, Kamera setzen, zeichnen – und ERST DANN
   * die Zähler lesen, weil Babylon sie je Bild zurückstellt.
   *
   * `alpha` ist der Mischanteil; gelesen wird er von `applyActors` und `rig.update` aus
   * `session.view.alpha`, das die Sitzung unmittelbar vor diesem Aufruf setzt. Die eigene
   * Zeitmessung liefert `dtMs` (Kamera-Glättung), `cpuMs` (vor `scene.render()`) und `frameMs`.
   */
  function drawFrame(alpha: number): void {
    // Das Argument ist nur die NAHT: der Mischanteil kommt aus `session.view.alpha`, das die Sitzung
    // unmittelbar vor diesem Aufruf setzt. Zwei Wahrheiten wären eine zu viel.
    void alpha;
    const started = performance.now();
    const dtMs = lastRenderAt < 0 ? 0 : started - lastRenderAt;
    lastRenderAt = started;
    // Nur die rAF-Schleife liefert eine sinnvolle Bildrate: bei `?clock=manual` liegen zwischen zwei
    // `advance`-Aufrufen Werkzeug-Wartezeiten, und aus denen darf keine Panel-Rate entstehen.
    if (!manual && dtMs > 0) {
      panelMeter.push(dtMs);
      frameDeltas.push(dtMs);
      if (frameDeltas.length > FPS_WINDOW) frameDeltas.shift();
      if (panelMeter.ready()) session.loop.setDivider(renderDivider(panelMeter.hz()));
    }
    applyActors(root.actors, session.view);
    rig.update(session.view, dtMs);
    cpuP95.push(performance.now() - started);
    gameEngine.scene.render();
    drawCalls = instrumentation.drawCalls();
    triangles = instrumentation.triangles();
    gpuMs = instrumentation.gpuMs();
    frameMs = performance.now() - started;
    overlay.update(stats());
  }

  function stats(): MbStats {
    const median = medianOf(frameDeltas);
    return {
      tick: session.tick(),
      fps: median > 0 ? Math.round(1000 / median) : 0,
      panelHz: panelMeter.hz(),
      frameMs,
      cpuMsP95: cpuP95.p95(),
      gpuMs,
      drawCalls,
      triangles,
      tickRate: TICK_RATE,
      steps,
      tier,
      storage,
      buildId: options.buildId,
    };
  }

  /** `{ slot, x, z, facing, visible, room }` aus dem ZUSTAND, nicht aus dem Mesh. */
  function pose(...args: unknown[]): unknown {
    const slot = asNumber(args[0], 'pose(slot)');
    const player = session.state().players[slot];
    if (player === undefined) throw new RangeError(`pose: Platz ${String(slot)} gibt es nicht`);
    return {
      slot,
      x: player.pos.x,
      z: player.pos.z,
      facing: player.facing,
      visible: player.active && !player.caught,
      room: player.room,
    };
  }

  function camera(): unknown {
    const current = rig.pose();
    return {
      mode: current.mode,
      x: current.x, y: current.y, z: current.z,
      targetX: current.targetX, targetY: current.targetY, targetZ: current.targetZ,
      yaw: current.yaw,
      distance: current.distance,
      occluders: rig.occluderCount(),
    };
  }

  /** Schreibt `pos`, nullt `vel` und SCHNAPPT die Kamera; den Raum löst der nächste Tick auf (Q7). */
  function teleport(...args: unknown[]): unknown {
    const slot = asNumber(args[0], 'teleport(slot)');
    const x = asNumber(args[1], 'teleport(x)');
    const z = asNumber(args[2], 'teleport(z)');
    session.teleport(slot, x, z);
    rig.snap();
    return { slot, x, z, room: session.roomOf(slot) };
  }

  /** Wird bei der ersten Probe auf die Bildgröße gebracht und danach wiederverwendet. */
  let pixels = new Uint8Array(0);

  /**
   * Pixelprobe: `scene.render()` und `readPixels` in EINEM synchronen Block. GEMESSEN: aus einem
   * eigenen `page.evaluate` liefert `readPixels` rgb(0,0,0) – ohne `preserveDrawingBuffer` ist der
   * Puffer danach weg. Bei `gl === null` kommt `samples: 0` zurück, damit das Tor LAUT fällt statt
   * still grün zu bleiben. `hash` ist FNV-1a über die RGB-Proben und nur Diagnose (er hängt an
   * Treiber und Fenstergröße), `center` die Probe in der Bildmitte.
   */
  function grid(...args: unknown[]): unknown {
    const step = args[0] === undefined ? GRID_STEP : asNumber(args[0], 'grid(step)');
    if (!Number.isInteger(step) || step < 1 || step > MAX_GRID_STEP) {
      throw new RangeError(`grid erwartet eine ganze Zahl in [1, ${String(MAX_GRID_STEP)}], bekam ${String(step)}`);
    }
    const gl = gameEngine.gl;
    if (gl === null) return { samples: 0, nonBlack: 0, hash: 0, center: [0, 0, 0] };
    const { width, height } = gameEngine.renderSize();
    gameEngine.scene.render();
    const need = width * height * 4;
    if (pixels.length < need) pixels = new Uint8Array(need);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    drawCalls = instrumentation.drawCalls();
    triangles = instrumentation.triangles();

    // `readPixels` zählt y von UNTEN; für ein symmetrisches Raster und die Bildmitte ist das
    // gleichgültig, deshalb wird nicht gespiegelt.
    const at = (px: number, py: number): [number, number, number] => {
      const index = (py * width + px) * 4;
      return [pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0];
    };
    let hash = 0x811c9dc5;
    let nonBlack = 0;
    for (let iy = 0; iy < step; iy += 1) {
      for (let ix = 0; ix < step; ix += 1) {
        const px = Math.min(width - 1, Math.floor(((ix + 0.5) * width) / step));
        const py = Math.min(height - 1, Math.floor(((iy + 0.5) * height) / step));
        const sample = at(px, py);
        hash = Math.imul(hash ^ sample[0], 0x01000193);
        hash = Math.imul(hash ^ sample[1], 0x01000193);
        hash = Math.imul(hash ^ sample[2], 0x01000193);
        if (sample[0] !== 0 || sample[1] !== 0 || sample[2] !== 0) nonBlack += 1;
      }
    }
    return { samples: step * step, nonBlack, hash: hash >>> 0, center: at(width >> 1, height >> 1) };
  }

  // Der Haken ist der AEUSSERE Rand (`cmd.setInput` nimmt `unknown[]`), deshalb prüft er noch
  // einmal – aber aus DERSELBEN Funktion wie die Sitzung. Die beiden Kopien in dieser Datei waren
  // Zeile für Zeile `soloSession.ts` und liefen beim ersten neuen Grenzwert auseinander
  // (Abschlussreview MIN-15).
  function setInput(slot: number, mx: number, mz: number, buttons: number): void {
    assertInputRange(mx, mz, buttons);
    session.setInput(slot, mx, mz, buttons);
  }

  const hook: MbHook = {
    advance(ticks) {
      assertAdvanceRange(ticks);
      // GENAU EIN Bild mit alpha = 1: `session.advance` reicht an `loop.advance(ticks)` weiter, und
      // das rechnet die Ticks UND zeichnet dieses eine Bild (R18). Ein zusätzliches
      // `session.loop.advance(0)` wäre ein ZWEITES Bild je Aufruf – der Vertrag sagt eins.
      return session.advance(ticks);
    },
    tick: () => session.tick(),
    hash: () => session.hash(),
    stats,
    setInput,
    // DASSELBE Funktionsobjekt in `cmd` – der Tor-Spec darf `mb.cmd.setInput === mb.setInput` prüfen.
    // Der Cast ist unvermeidbar: `MbCommand` nimmt `unknown[]`, und `unknown` ist nicht zu `number`
    // zuweisbar; die Argumentprüfung steht deshalb IM Körper von `setInput`.
    cmd: { pose, camera, teleport, setInput: setInput as unknown as MbCommand, grid },
  };
  installGameHook(hook);

  window.addEventListener('keydown', (event) => {
    if (event.code === OVERLAY_TOGGLE_CODE) {
      event.preventDefault();
      const visible = overlay.toggle();
      overlayTouched = true;
      if (visible) overlay.update(stats());
      // Vor dem Öffnen des Speichers ist `store` noch `undefined` – der Schreibvorgang fällt dann
      // weg, und `overlayTouched` ist der Grund, warum der Zustand trotzdem nicht zurückgedreht
      // wird. Der Erfüllungszweig unten holt das Schreiben nach.
      void store?.set('overlay', visible);
      return;
    }
    if (session.keyDown(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (session.keyUp(event.code)) event.preventDefault();
  });
  // Ohne Fokus kommt kein `keyup` mehr an: eine gehaltene Taste bliebe für immer gehalten.
  window.addEventListener('blur', () => { session.resetInput(); });
  // `visibilitychange` feuert an DOCUMENT, nicht an `window` (gemessen: der Hörer an `window` in
  // `view2d/main.ts` feuerte nie). Im Hintergrund läuft KEINE Zeit auf – `resume` setzt die Uhr neu.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      session.resetInput();
      session.loop.pause();
      return;
    }
    session.loop.resume();
    rig.snap();
    panelMeter.restart();
  });
  window.addEventListener('resize', () => { gameEngine.resize(); });

  // Der Speicher ist asynchron und darf das erste Bild nicht aufhalten: die Szene startet mit der
  // Vorgabe bzw. `?tier=`, der gespeicherte Wert wird NACHTRAEGLICH angewendet.
  void openSettingsStore().then((opened) => {
    store = opened;
    storage = opened.backend();
    // Der gespeicherte Wert kommt NACHTRAEGLICH – die URL übersteuert ihn weiterhin, also läuft er
    // durch DIESELBE Funktion (R12).
    const effective = applySearchOverrides(
      { qualityTier: opened.get('qualityTier'), overlay: opened.get('overlay') }, search,
    );
    if (effective.qualityTier !== tier) {
      tier = effective.qualityTier;
      gameEngine.applyTier(tier, window.devicePixelRatio);
    }
    // Hat der Nutzer in der Zwischenzeit F3 getippt, gewinnt SEIN Zustand – und die verlorene
    // Schreiboperation wird nachgeholt, damit der nächste Seitenaufruf sie sieht.
    const wantOverlay = effectiveOverlay(effective.overlay, overlayTouched, overlay.visible());
    overlay.setVisible(wantOverlay);
    if (overlayTouched) void opened.set('overlay', wantOverlay);
  }, (error: unknown) => { options.report?.(error); });

  // Das erste Bild fällt sofort – auch bei `?clock=manual`: ohne es wäre die Leinwand schwarz und
  // `cmd.grid` hätte nichts zu lesen.
  //
  // ACHTUNG, GEMESSEN: dieses erste Bild zeichnet noch KEIN Mesh. Babylon holt die Shader
  // (`default.vertex`/`default.fragment`) per `import()` nachgeladen – bis sie da sind, ist kein
  // `StandardMaterial` bereit, `drawCallsCounter.current` bleibt 0 und die Leinwand zeigt nur
  // `CLEAR_COLOR`. Bei laufender Schleife fällt das nicht auf (das nächste rAF-Bild zeichnet);
  // bei `?clock=manual` treibt der Tor-Spec die Bilder selbst, bis `stats().drawCalls > 0` ist.
  //
  // KEIN `session.loop.start()` danach: `createSoloSession` startet die Schleife selbst, sobald
  // `manual` nicht gesetzt ist (R9, `soloSession.ts`). Der Aufruf hier war ein Leerzug – er traf
  // immer auf `active === true` und kehrte sofort zurück – und ließ die Stelle so lesen, als läge
  // der Start bei `gameMain` (Abschlussreview, contract Minor 3).
  session.loop.advance(0);
}
