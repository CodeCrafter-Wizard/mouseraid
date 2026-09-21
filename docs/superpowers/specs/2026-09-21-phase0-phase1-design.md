# Plan: „Mäusebau" – Phase 0 (Verbindungs-Testlabor) + Phase 1 (Solo Vertical Slice)

## Context

Das Projektverzeichnis enthält nur die Spezifikation `Game_Design_Mouse.md` (3D-Koop-Survival im Browser, offline-fähige PWA, 7 Phasen). Das Gesamtprojekt ist zu groß für einen Plan – jede Phase bekommt einen eigenen Zyklus. **Dieser Plan deckt Phase 0 + Phase 1 ab.** Ausdrücklicher Wunsch: Das Spiel soll **optisch ansprechend** sein und einfach auf dem Handy laufen.

Grundlage: adversarial geprüfte Web-Recherche (8 Agenten), Design-Panel (3 Architekten-Entwürfe × 3 Juroren, praktisch Gleichstand) und eine Kritiker-Runde über diesen Plan (3 Kritiker, keine Blocker, alle „major"-Einwände eingearbeitet). Der Plan kombiniert **Reihenfolge & Scope-Disziplin** (Spaß früh beweisen), **Core-Architektur & Prüfwerkzeuge** (deterministisch, agent-verifizierbar) und **Figuren-/Welt-/UI-Design** (Look früh und überprüfbar).

## Entscheidungen des Nutzers (2026-09-21) – final

| Thema | Entscheidung |
|---|---|
| Umfang | Phase 0 + Phase 1 |
| Phase-0-Gate | Zwei-Handy-Matrix ist **nicht blockierend**; nur die **Planung von Phase 2** wartet darauf |
| Testgeräte | 1 Android-Handy; zweites Handy (evtl. iPhone) gelegentlich geliehen → Sitzungen bündeln. Entwicklungs-PC **hat Webcam** |
| adb | Wird installiert (`winget install Google.PlatformTools`, USB-Debugging) |
| Grafik | Hybrid: Maus, Katze, Raumhülle prozedural; ausgewählte CC0-Props (Kenney, KayKit) |
| Hosting | GitHub Pages, öffentliches Repo `https://github.com/CodeCrafter-Wizard/mouseraid` → `https://codecrafter-wizard.github.io/mouseraid/` |
| Tag/Nacht | Nacht 5 min / Tag 5 min, beides manuell beendbar; Werte in `src/data/balance.json` |

**GitHub-Stand:** Repo (öffentlich, leer, `main`) und PAT (User-Variable `GITHUB_PERSONAL_ACCESS_TOKEN`) per API verifiziert. Token nie in Chat/Dateien/Logs.

## Abweichungen von der Spec (→ `docs/decisions.md` + Abschnitt „Änderungen nach Recherche" in der Spec, inkl. der Nutzerentscheidungen oben)

1. **`core` wirklich ohne Babylon:** statt `moveWithCollisions`/Havok/`RecastJSPlugin` eigene 2.5D-Kinematik-Kollision + Wegpunkt-Graph-A* in reinem TypeScript. Eskalation später: `navcat` (Rattenwellen), `rapier3d-deterministic` (Fahrzeuge).
2. **Determinismus ab Tag 1:** Integer-Tick (30 Hz), Seeded-PRNG im State, eigenes Trig-Modul, ESLint-Verbote in `src/core/**`, Golden-Hash-Test.
3. **Babylon 9.27.x** exakt gepinnt, „pure"-Importe, **WebGL2-Engine explizit** (kein `EngineFactory`; WebGPU später Opt-in). **Kein KTX2/Draco/Meshopt** in Phase 1 (CDN-Decoder → Offline-Bruch).
4. **Kamera-Berechtigung = Plan A** (Chrome: echte IPs statt mDNS; Safari: ohne sie keine Host-Kandidaten). **Text-Pfad gleichwertig**, gleicher Codec.
5. **PWA:** `display: standalone` + `display_override`; kein `plugin-basic-ssl`. Dev-Loops: Desktop `vite dev` · Android `adb reverse` · Offline/iOS/Zwei-Handy über Pages.
6. **Spielkamera:** eigener Spring-Arm mit Raycast gegen Core-Geometrie, kein `camera.checkCollisions`; pro Raum `cameraMode: follow | diorama` (enger Bau = Puppenhaus-Ansicht).
7. **Schleichen** ohne eigenen Button (laut §8.9 später ein Skill): analoge Joystick-Auslenkung = Tempo + Lautstärke; Sprint ist laut.
8. **Toolchain:** `typescript` **6.0.x** (typescript-eslint kann TS 7 noch nicht), `vite` 8, `vitest` 5, `eslint` 10, `vite-plugin-pwa` 1.3 (`generateSW`, `registerType: 'prompt'`), `idb` 8 – bei M0 gegen npm/Doku (context7) prüfen.
9. **Phase-0-Matrix:** nicht testbare Spec-Zellen werden als „nicht testbar" dokumentiert. Pflichtzellen für Phase-2-Go: gemischtes Paar, beide Hotspot-Rollen, Kamera an/aus, QR + Text; **auf iPhone jede Pflichtzelle einmal im Safari-Tab und einmal in der installierten App**.
10. **Flucht unter Regale** (Mäuse passen drunter, Katze nicht) schon in Phase 1 – macht die Jagd fair. Katze bekommt Zustand **„lauern"** an der Regalkante (N s, dann suchen → zurück) + kurze Pfoten-Reichweite unter die Kante; Beibehalten/Begrenzen/Entfernen steht auf der Spaß-GATE-Checkliste.

## Architektur (Zielbild Phase 1, Phase-2-fähig)

```
index.html (Spiel)   lab.html (Testlabor, OHNE Babylon; aus der Spiel-Hülle verlinkt)
src/
  core/      KEIN DOM, KEIN Babylon; eigenes tsconfig ohne DOM-Lib
    math/    trig.ts  vec.ts  rng.ts (sfc32)  hash.ts (FNV-1a)
    world/   levelTypes  levelLoad (validierend)  generateColliders  collision  nav  queries
    systems/ clock  playerIntent  playerMove  interaction  noise  catPerception  catBrain  catMove  catch  colony
    sim/     state (WorldState)  step  events  input (InputFrame, 8-Byte-Pack)  views (Fast/Slow)  clone  bots (Skript-Bots)
    save/    schema  migrate  serialize
  data/      balance  items  lootTables  lighting  palette  perfBudget  levels/feinkost.json
  net/       transport  rtcTransport  broadcastTransport  connector  protocol  sdpCodec  sdpTemplate  compress
             diagnostics  failureCodes  pingTest  signaling/{qr,text,share}Provider  scannerAdapter
  modes/     session (GameSession: solo|host|client)  soloSession  fixedLoop (injizierbare Uhr)
  input/     inputSource  keyboard  touch (reiner Reducer über Pointer-Events)  merge
  render/    engine  babylonRegistry  sceneRoot  roomShell  lightingRig  cameraRig  occluders  quality  stations
             debugOverlay  tuningPanel  view2d  characters/{characterView,pose,rig,proceduralMouse,proceduralCat,springs,blobShadow}
             props/{propLibrary,proceduralProps,lightCards,motes,azulejo}
  audio/     audioBus (Babylon AudioV2, einziger AudioContext)  sfx (reine Synthese-Funktionen)
  ui/        strings.ts (ALLE sichtbaren Texte)  tokens.css  hud/…  menus/…  gate  rotateOverlay
  platform/  pwa  wakeLock  storage (idb)  device  errorPanel
  lab/       labMain  labUi  report  selfTest
tests/  core/  golden/ (eingefrorene Fixtures)  net/ (SDP-Fixtures)  save/  e2e/ (Playwright)
scripts/ check-dist.mjs  build-atlas.mjs
docs/   decisions.md  art-direction.md  perf-log.md  connectivity-tests.md  runbook-zwei-handys.md  refs/ (git-ignoriert)
```

**Kernverträge:**
- `step(state, inputs[], ctx, outEvents[])` – einzige Mutationsstelle; Events in aufrufer-eigenen Puffer. `cloneState`, `hashState` (NaN-Guard), exportiertes `stepPlayerMovement(p, input, ctx, modifiers)` für spätere Client-Vorhersage.
- `WorldState` koop-förmig: `players[]` nach Slot, Katze mit `awareness[]` pro Slot + `targetSlot`, `clock.skipVotes`, Raum-IDs als Daten, RNG im State; „geschwächt" ist ein Flag, kein Modus.
- `InputFrame {seq, tick, mx, mz (int8, Welt), buttons}`; Flanken aus `prevButtons` im State. Buttons Phase 1: `SPRINT`, `INTERACT`.
- `Collider {cx,cz,hx,hz,y0,y1,rot, blocks: MOUSE|CAT|SIGHT|CAMERA, occluderGroup}`; eine Query-API (`moveCircle`, `segmentBlocked`, `sweepCircle`, `rayCast3`, `checkSupport`) für Bewegung, Sichtlinie, Kamera-Boom.
- **Level-JSON ist einzige Quelle:** Wände, Regale, Theke, Vitrine, Pflanzen erzeugen Kollider **und** Meshes (Test: Bounds identisch). Laden + Bau in einem Koordinatenraum, Portal „Mauseloch". Nav-Kanten beim Laden per `sweepCircle` (keine abgeleitete Datei). `scenery` (Thin Instances) vs. `loot` (Einzelobjekte).
- Render/UI lesen nur `RenderView {prev, curr, alpha, slow}` + `GameEvent[]`. `CharacterView` erlaubt späteren glTF-Tausch.
- Netz: `Transport` (Kanäle `state` unzuverlässig / `events` zuverlässig, `negotiated:true`, feste IDs, `iceServers: []`), `Connector` (RTC-Handshake, **mehrere Peers/Slots**) getrennt von `SignalingProvider` (QR, Text, Share, BroadcastChannel). SDP-Umschlag `{codecV, protoV, role, slot, nonce, ufrag, pwd, fp, setup, cands}`; `protocol.ts`: `PROTOCOL_VERSION`, `Hello{protoV, buildId}`.
- Weltmaßstab **1 Einheit = 10 cm**.
- **Test-Infrastruktur ab dem ersten 3D-Meilenstein:** `?clock=manual` + `window.__mb.advance(nTicks)`, `?autostart=1` (Dev-Bypass fürs Start-Gate), Befehlsregister `__mb.cmd`, `__mb.stats()`. Regel: Playwright treibt die Simulation über Ticks, nie über Wartezeiten. Debug-Befehle entstehen jeweils mit ihrem System.

**Grafik-Leitlinien:** warme, flach schattierte Miniaturwelt aus 5 cm Höhe. Palette ~24 Töne (Terrakotta, Fayence-Creme, Azulejo-Kobalt, Olive, Portwein, Kork, Sardinendosen-Gold, Nacht-Indigo, Laternen-Bernstein); **Nacht ist nie schwarz**. Nebel (EXP2) als Haupthebel, genau 1 Directional + 1 Hemispheric Light per Keyframes in `lighting.json` (eigenes Set pro Raum), emissive Lampen, Blob-Schatten statt Echtzeit-Schatten, Vertex-AO gegen Core-Boxen, additive Lichtkarten nach **Bildschirmfläche** budgetiert (≤ ~1,5× Screen), Staub nur am Laternenkegel. Farben gamma-kodiert an `StandardMaterial`. Figuren: ein verschmolzenes Mesh, code-gebautes Skelett, **1 Bone pro Vertex** (1 Draw Call); Fallback CPU-Rigid-Skinning in dynamischen Vertex-Buffer – nie lose TransformNode-Teile. Posen = reine TS-Funktionen. HUD = **eine** HTML/CSS-Ebene (Kachel-Buttons, Sardinendosen-Slots, Azulejo-Windrose als Sonar mit Katzenauge, Kachel-Uhr), OFL-Fonts ≤ 60 kB, Touch-Ziele ≥ 48 px, innerhalb `env(safe-area-inset-*)` + Top-Offset.

**Budget & messbares Performance-Gate (60 fps ist Hypothese):** ≤ 60 Draw Calls, ≤ 60k Dreiecke, Maus ≤ 1,5k, Katze ≤ 2,5k, ≤ 8 MB Texturen, JS ≤ ~900 kB gzip (nach Messung justieren). Render-Kadenz: Panel-Rate messen (rAF-Median); 120 Hz → jedes 2. rAF, 90 Hz ungedrosselt, 60 Hz → 60; Option 30 fps. **Gate (in `perfBudget.json`):** Anteil Frames > 1,5 × Zielperiode ≤ 5 %, CPU-Frame p95 ≤ ~8–10 ms, Hardware-Scaling-Sweep (1,0 vs. 1,5) zeigt GPU-Reserve; `gpuMs` nur falls Timer verfügbar. Qualitätsstufen in **Gerätepixeln** (niedrig 1,0 CSS-px · mittel ≈ 1,5 · hoch min(DPR, 2)); Rückfallziel laut Spec 30 fps.

## Meilensteine

Jeder Meilenstein endet lauffähig, mit Git-Tag und Deploy (nur `push` auf `main` deployt). **A** = prüft der Agent, **N** = Nutzer. Headless-Meilensteine (M3, M4, M7, Core-Teile von M16/M17) sind nie durch ausstehendes N-Feedback blockiert – der Agent arbeitet dort weiter. Der Agent nennt bei jeder N-Bitte die erwartete Build-ID.

**M0 – Gerüst, CI, Deploy, PWA-Hülle**
- N-Vorbereitung in einem Rutsch: adb installieren + USB-Debugging, `git config --global user.name/email` (noreply), **dann** VS Code einmal neu starten (PATH + GitHub-MCP).
- Tooling-Spike zuerst (→ `decisions.md`): Playwright (a) zwei Tabs mit echter `RTCPeerConnection` + Fake-Media-Flags, (b) Offline-Emulation, (c) WebGL2-Screenshot nicht-schwarz, (d) **Handy-Chrome per adb/CDP fernsteuern** (`adb forward` + `connectOverCDP`; max. 1 h, sonst Copy-Report-Weg).
- `git init`, `CLAUDE.md` (Schichten, Determinismus, alle Texte in `strings.ts`, Tick-getriebene Tests, „nie fertig ohne frische Ausgabe", Token-Hygiene), `docs/decisions.md`, Spec-Nachtrag.
- Vite 8 + TS 6 strict, zwei Einträge, `base` aus `VITE_BASE`, `__BUILD_ID__`; ESLint: Import-Grenzen, Determinismus-Verbote in `core`, Verbot `Legacy`/`import *`/`new AudioContext` außerhalb `audioBus`.
- PWA: `generateSW`, `prompt`, `globPatterns`, `maximumFileSizeToCacheInBytes`, `ignoreURLParametersMatching: [/.*/]`, `navigateFallbackDenylist` (lab), handgemachte Icons, Manifest (`orientation: landscape`). Hülle: „Offline bereit ✓", „Nach Update suchen", Build-ID (rot bei Abweichung von `?expect=`), **Fehler-Panel** mit „Diagnose kopieren", Link „Verbindungs-Testlabor", Touch-Härtung, `viewport-fit=cover`.
- `npm run phone` = Build mit `selfDestroying`-SW für den adb-Loop (kein veralteter Cache); `npm run phone:pwa` für seltene lokale SW-Tests.
- CI: lint → vitest → build → `check-dist.mjs` (Decoder-Signaturen `draco_`/`ktx2Decoder`/`meshopt_decoder`/`basis_transcoder`/`/Legacy/` und `stun:`/`turn:` = Fehler; Allowlist für Babylons `Tools`-CDN-Defaults; Lab-Chunk ohne Babylon; Precache vollständig; Größen) → Offline-Smoke gegen den `/mouseraid/`-Build via `vite preview` inkl. `lab.html?x=1` und `index.html?view=2d` → `deploy-pages`.
- Erster `git push -u origin main` durch **N** (Browser-Login des Git Credential Managers), danach pusht der Agent. Pages **nach** dem ersten Push aktivieren (API; Fallback N: Settings → Pages → Source „GitHub Actions").
- **A:** Build-ID auf der Pages-URL erscheint, Smoke grün. **N:** am Handy öffnen, installieren, „Offline bereit", Flugmodus-Start; `npm run phone` einmal ausprobieren.

**M1 – Testlabor I (ohne QR/Scanner)**
- `sdpCodec` (minimise/rebuild/encode/decode, `deflate-raw` + base64url, Fallback unkomprimiert, Byte-Größen je Stufe; **filtert keine Kandidaten** – IPv6/link-local/`.local` bleiben, Report zeigt „gesammelt vs. übertragen"; Assertion: typischer Umschlag ≤ 800 Zeichen), `rtcTransport` (DataChannels vor `createOffer`, Gathering `complete` oder 2,5-s-Timeout, `alwaysNegotiateDataChannels` nur feature-detecten), `broadcastTransport`, `connector` (**Host verwaltet Slots 1–3**, „Weiteren Spieler hinzufügen" bei laufenden Pings), Text-/Share-Provider (teilt reinen Text, nie Deep-Links), `protocol.ts`, `pingTest` (200 Pings @ 30 Hz je Kanal und Peer).
- `diagnostics`: Kandidaten wörtlich, Timeline, gewähltes Paar, `sctp.maxMessageSize`, Kamera-Permission-Status + „getUserMedia in dieser Sitzung ja/nein" zum Zeitpunkt von `createOffer` (**„Kamera aus"-Lauf mit Status `granted` = ungültig**), `local-network`/`loopback-network`, Feature-Block (SecureContext, WakeLock, BarcodeDetector + Formate, CompressionStream, Storage), UA, Display-Mode, SW, Build-ID. Fehlercodes **F1–F9** (F1 mit Safari-Variante „Kamera erlauben oder Text-Pfad"); Texte in `strings.ts`.
- Reports: Pflicht-Zellenlabel vor dem Lauf (Rolle, Hotspot-Besitzer, Kamera, Pfad, Gerät), Auto-Speichern in `localStorage`, Verlauf + „Alle Reports teilen/kopieren", „Roh-SDP kopieren". **Selbsttest** (zwei PeerConnections in einer Seite; zuerst ohne, dann mit nacktem `getUserMedia`-Toggle) – ein Freund mit iPhone kann ihn in 2 min ausführen.
- **A:** Codec-Roundtrip gegen Fixtures (Chrome/Firefox per Playwright erfasst, Safari synthetisch gekennzeichnet; inkl. IPv6- und mDNS-Kandidat), Protokoll-Tests, E2E Zwei-Tab über BroadcastChannel **und** echte RTC per Text-Pfad (mit Fake-Media-Flags; nur lokal, falls im CI unzuverlässig). **N:** Selbsttest-Report vom Handy.

**M2 – Testlabor II (Kamera + QR) und Sitzung A**
- Kamera-zuerst-Ablauf (Stream bei Lobby-Eintritt auf **beiden** Seiten, offen halten, kein `location.hash`-Wechsel), Wake Lock im Lab, `scannerAdapter` (nativ → `qr-scanner`-Fallback auch bei leerem `getSupportedFormats()`/`detect()`-Fehler; Backend + Decode-Latenz + Retries loggen; akzeptiert auch `ImageData`), QR-Anzeige (dunkel auf hell, Ruhezone, ECC M, Tippen-zum-Vergrößern, Helligkeits-Hinweis), `qrcode`-Lib-Audit, Pass-Kriterium „Host-Kandidaten > 0 **und** keine `.local`", Sperrbildschirm-Test 10/30/60 s mit „Neu verbinden", Scan-Reserve-Sweep bis ~1100 Byte, Messung **Paarungsdauer je Richtung + „Zeit bis Lobby voll"** (Hochrechnung 6 Scans).
- `docs/runbook-zwei-handys.md`: eigenständig, druckbar, feste Zellen-Priorität mit Zeitangaben; **A/B-Reihenfolge: zuerst ohne Kamera (Website-Berechtigung vorher zurücksetzen, Text-Pfad), dann mit**; Push-Freeze + Build-ID-Abgleich; iOS: installieren → **installierte App** online öffnen → „Offline bereit" → Hotspot, notieren ob der Precache neu lädt; manuelle Felder „System-/Browser-Dialoge gesehen (Kamera, Lokales Netzwerk/LNA)"; Schluss: „Internet an → Alle Reports teilen → in `connectivity-tests.md`". Release-Check-Notiz: chromestatus 5065884686876672 / 5068298146414592, Bugzilla 1969916.
- **A:** Payload → `sdpCodec` → `qrcode` → `scannerAdapter` identisch (Größen-Sweep, ECC M); **ein** Fake-Kamera-Smoke mit statischem QR-Video; `check-dist` prüft Scanner-Worker im Precache; **kein** QR-Handshake-E2E mit Fake-Kamera (Handshake-E2E bleibt auf dem Text-Pfad). **N – Sitzung A (PC-Webcam + Android):** Heim-WLAN und Handy-Hotspot (mobile Daten aus), beide Rollen, Kamera aus/an, QR + Text, 3er-Lobby (Android = Host, zwei PC-Profile).

**F – Zwei-Handy-Matrix (schwebend; blockiert nur die Phase-2-Planung)**
Runbook abarbeiten; „Hotspot-Besitzer = Host" prüfen (iPhone-Hotspot Client↔Client als erwarteter Fehlschlag); 3er-Lobby mit Host-Handy + Leihhandy + PC (Kamera bei jedem Join ohne Nachfrage? iOS standalone!); echte SDP-Fixtures sichern; falls ein Spiel-Build ≥ M6 existiert: 5-min-Spiel-Smoke (Gate, Audio inkl. Frame-Zeit mit Klingelschalter aus/an, Safe-Area, Standalone-Balken) – sonst in die M20-Leihe verschieben; Go/No-Go-Notiz für Phase 2.

**M3 – Core I: Mathe, Simulation, Kollision (headless)**
`math/*`, State/Step-Skelett (clock → intent → move → interaction → noise → catPerception → catBrain → catMove → catch → colony), Input/Views/Clone/Hash, Kollisions-Queries (OBB, y-Bereiche, Masken; ohne Grid-Broadphase), Spielerbewegung (analog → Tempo + Lautstärke, Sprint), validierende Loader **nur** für Balance + Level (jede spätere Daten-Datei bekommt Loader + NaN-Guard mit ihrem Meilenstein). **A:** Golden-Hash gegen eingefrorene Fixtures (`test-balance.json`, Mini-Level) + Re-Baseline-Verfahren, 10k-Tick-Kollisions-Fuzz.

**M4 – Core II: 2D-Ansicht, Level, Navigation (headless)**
**Zuerst** `?view=2d` (Kollider nach Maske, Unter-Regal-Zonen, Nav-Graph, später Sichtkegel/Geräusche/Pfade), dann Level-Typen, `generateColliders`, `feinkost.json` (Laden + Bau, iterativ mit 2D-Screenshots), Nav-Kanten, Level-Validator als Test (Graph zusammenhängend, Kanten mit Katzenradius frei, Spawns/Loot/Verstecke frei + erreichbar). **A:** Tests + 2D-Screenshots.

**M5 – Graybox am Desktop**
`engine.ts` (WebGL2, `babylonRegistry`, `CheckMissingImports()`, `alpha:false`, DPR-Politik, Render-Kadenz), `fixedLoop` (injizierbare Uhr, 250-ms-Clamp, max. 5 Steps, Interpolation, `visibilitychange`), `soloSession`, Graybox aus Level-Defs inkl. Bau, Kapsel-Maus, Tastatur, Kamera: reine unit-getestete Boom-Funktion (Wände klemmen, Okkluder per `mesh.visibility` ausblenden – Dither-Upgrade später, niedrige Props weder noch), `diorama`-Modus, Debug-Overlay (F3 / 3-Finger-Tipp: fps, Panel-Hz, Frame-/CPU-Zeiten, GPU ms falls verfügbar, Draw Calls, Dreiecke, Tickrate, Steps, Stufe, Build-ID), `__mb`-Testhaken, `platform/storage.ts` (nur `settings`). **A:** Boom-/Loop-Tests, Screenshots 844×390; Playwright prüft: **alle Requests same-origin**, danach offline → Reload → Szene rendert.

**M6 – Graybox am Handy – Checkpoint „Gefühl"**
`touch.ts` als reiner Reducer (Vitest: Multi-Pointer, Hit-Priorität, Außenring-Sprint), Joystick links mit Rand-Abstand, Kamera-Drag rechts, Sprint = Außenring **und** Button, Zurück-Taste → Pause, Start-Gate (AudioV2-Unlock, Wake Lock, `persist()`, Android Fullscreen + Orientation-Lock), „Bitte drehen", Safe-Area-Tokens, **Tuning-Panel** mit „Werte kopieren", **Budget-Last-Schalter** (Dummy-Geometrie ~60 DC/60k Dreiecke + Vollbild-Additivkarten) + **„Leistungsbericht kopieren"** (Panel-Hz, Zielkadenz, Anteil langer Frames, CPU p95, Scaling-Sweep). **N: „Kamera-Parcours"** über URL-Stationen (unter dem Regal, Theken-/Wandecke, Wandlauf, Mauseloch, Bau): je Station bewerten, Tuning-Werte + ersten Leistungsbericht zurückgeben.

**M7 – Katzen-Gehirn (headless) + Graybox-Katze**
Wahrnehmung (Sichtkegel + Sichtlinie `SIGHT`, Hören über Noise), Awareness pro Slot, FSM: schlafen → patrouillieren → aufmerksam → verfolgen → **angekündigter Sprung** (Ausweichfenster) → **lauern** (Ziel wahrgenommen, aber unerreichbar; Pfoten-Reichweite) → suchen → zurückkehren (`distracted` reserviert); A* mit ID-Tie-Break, direkte Verfolgung bei Sichtlinie, Drehraten-Limit, Stuck-Detektor; Fangen → `caught`, getragene Items verloren, Stub-Respawn am Mauseloch. Skript-Bots (`flieh-zum-Versteck`, `naiver Läufer`, Spawn-Sweep) statt aufgezeichneter Traces. Kapsel-Katze, nach FSM-Zustand eingefärbt, mit „?"/„!"; Overlay zeigt Katzen-Zustand/Awareness; `__mb.cmd`: Katze teleportieren/Zustand erzwingen. **A:** Flucht-Bot überlebt, naiver Bot wird gefangen, Fairness-Property (sprintende Maus mit Vorsprung erreicht Versteck), Unter-Regal-Fall terminiert deterministisch; Fairness zusätzlich als Bericht gegen die echten Daten; 2D-Review.

**M8 – Performance-Harness + Rig-Spike – PERFORMANCE-GATE & Vor-Spaß-Check**
URL-Stationen `?station=&phase=&tier=&freeze=1`, `perfBudget.json` + rotes Overlay, Qualitätsstufen + Kurz-Benchmark, **Rig-Spike**: eine ~1,5k-Dreieck-Blob-Maus mit ~20 code-gebauten Bones (`numBoneInfluencers=1`, Sinus-Pose) als Figuren der Budget-Last; **Freeze-Beweis** (eingefrorene Szene + Loot-Sichtbarkeit + Okkluder + Raumwechsel + animierte Skinned-Figur); GPU- vs. CPU-Skinning in `perf-log.md`. **A:** Budget-Checks je Station. **N:** Leistungsbericht unter Volllast + **„Ist die Graybox-Jagd spannend und fair?"** → Layout-/Balance-Korrekturen landen **vor** dem Look-Dev. **Gate:** Frame-Ziel gehalten – sonst Stufe/Budget anpassen.

**M9 – Look-Dev – Checkpoint „Look"**
Vorab **N:** 3–5 Referenzbilder des Wunsch-Looks nach `docs/refs/`. `palette.json`, Raumhülle (Azulejo-Sockel-Generator – später auch fürs UI, Terrakotta-Boden mit Jitter, Schaufenster, Mauseloch), Nebel, 2 Lichter, `lighting.json` je Raum (inkl. gemütlichem Bau-Set), emissive Laterne/Vitrine/Kühlschrank, Image-Processing (auf „niedrig" weglassen, falls > 1 ms), prozedurale Fallback-Props im Mausmaßstab als Thin Instances, Dither-Okkluder (Fallback `visibility`), Shader-Warm-up + gestalteter Ladebildschirm, `docs/art-direction.md`, **2–3 umschaltbare Paletten-/Licht-Varianten**. **A:** Screenshots 4 Tageszeiten × 3 Stationen gegen die Checkliste, Budget. **N:** Variante wählen.

**M10 – Maus I: Werkzeuge + Gestalt**
**Zuerst** Galerie `?view=char` (Drehteller) und Kontaktbogen-Capture mit deterministischer Uhr; dann statische Maus im gewählten Look, **2–3 Proportions-Varianten**: birnenförmiger Körper, spitze Schnauze, rosa Nase, große dünne Ohren (rosa innen), Glanzaugen mit Lichtpunkt, rosa Pfoten, 6-Segment-Schwanz, Bauchverlauf, weiche Normalen + dezenter Rim. **N:** Variante anhand von Standbildern wählen. Zeitbox: nach 2 Runden ohne akzeptierte Variante → Stopp, Nutzer entscheidet über das weitere Vorgehen.

**M11 – Maus II: Animation – Checkpoint „Bewegung"**
`pose.ts` (reine Funktionen → TRS-Buffer): distanzgetriebener Gang (Trab/Sprung, Phasenversatz, 120-ms-Blend), Feder-Neigung/-Wippen, Feder-Schwanz/-Ohren, Idles (Schnuppern, Ohrzucken, Blinzeln), One-Shots, volumenerhaltendes Squash & Stretch, getragene Beute auf dem Rücken, Blob-Schatten, Gang-Regler in der Galerie. **A:** Pose-Tests (kein NaN, begrenzte Winkel, identisch bei 30/60/120 Hz), Kontaktbögen. **N:** Bewegung am Handy beurteilen.

**M12 – Katzen-Körper, Sonar, Minimal-Audio**
Prozedurale Katze (Backen, Schnauze, dicker Bauch, rote Flecken, Augenleuchten; Posen je Zustand: eingerollt + „Zzz", Schleichgang, Ohren zum Reiz, Galopp, Po-Wackeln vor dem Sprung, Lauern an der Regalkante). Sonar: Azulejo-Windrose, weltfest N/O/S/W je Raum, Katzenauge öffnet sich mit Verdacht, Puls per WAAPI-`playbackRate` bzw. sim-getriebenen Einzelpulsen, nur nachts. Audio: **ein** AudioContext; SFX als reine Synthese-Funktionen, beim Laden per `OfflineAudioContext` in Buffers gerendert und über AudioV2 räumlich abgespielt (Schnurren/Fauchen, Alarm-Akzent, Trippeln, fröhlicher „Erwischt"-Jingle); Dev-Seite `?view=sfx` mit Reglern + „Werte kopieren"; dieselben Slots nehmen CC0-Samples, falls ein Klang zweimal abgelehnt wird. **A:** SFX-Tests (Dauer, Peak < 1, RMS, kein NaN, Spektrogramm-PNG), Zustands-Screenshots via `__mb.cmd`. **N:** „spannend, aber fair"; Ton mit Klingelschalter an/aus.

**M13 – Verstecken, Kontext-Button, HUD-Stil**
Topfpflanzen-Verstecke, core-aufgelöstes Interaktionsziel; freundliche Regel: Katze verliert die Spur → schnuppert → gibt auf; hart nur: kein Einstieg in Sprungreichweite bei Sichtkontakt. Pflanzen-Squash, Augen lugen heraus, Versteck-Kamera (`diorama`). Kontext-Button, `tokens.css`, Fonts, Pinsel-Icons (Inline-SVG), Kachel-Buttons, HUD-Skalierung, Linkshänder-Tausch (Skill `frontend-design`). **A:** Core-Tests der Versteck-Regeln, HUD-Screenshots 844×390 + 667×375 mit Safe-Area-Insets. **N:** Versteck-Gefühl, Button-Erreichbarkeit mit einem Daumen.

**M14 – Looten (leicht)**
Loot-Spawns + Tabellen (`items.json`, `lootTables.json` + Loader), Halten-zum-Looten (Fortschrittsring, erzeugt Geräusch), 3 Slots, Dosen als gesperrter Teaser („Skill fehlt"), Abgabe am Mauseloch als einfacher Zähler; `__mb.cmd`: Loot geben. **A:** Core-Tests, Bot-Lauf „looten und heimkehren".

**GATE – Spaß-Check (Stop/Go mit dem Nutzer)**
„Macht **Schleichen–Looten–Verstecken–Gejagt-Werden** auf dem Handy Spaß?" Checkliste u. a.: Unter-Regal-Zuflucht behalten/begrenzen/entfernen, Katzen-Tempo/-Wahrnehmung, Layout. Anpassungen **vor** dem Ausbau der Ökonomie.

**M15 – Bau & Lager**
Bau-Raum mit eigenem Licht-Set und `diorama`-Kamera, Portal mit Iris-Blende, Lager-Abgabe + Lager-UI (gemeinsames Lager), sichtbar wachsender Vorratshaufen, Pickup-Bogen ins HUD. **A:** Station `bau` gegen `art-direction.md`. **N:** Bau-Look („gemütlich") freigeben.

**M16 – Tag/Nacht-Regeln**
Uhr (5/5 min); Morgengrauen: Zurückziehen + Item-Verlust, Loot-Respawn, täglicher Nahrungsverbrauch; **geschwächt = Tempo-Multiplikator + Slots 3 → 2**; Portal **tagsüber gesperrt** (Kontext-Button zeigt den Grund); **Tag überspringen** (`skipVotes`) **und Nacht manuell beenden** (im Bau schlafen, §8.2); gefangen → Items verloren, schläft bis zur nächsten Nacht (Zeitraffer + Nacht-Zusammenfassung); Tageszähler, Kachel-Uhr mit Hahn-Warnung, Zeitraffer-Licht; Overlay: Phase, Restzeit, Tag, Nahrung; `__mb.cmd`: Zeit vorspulen/Phase überspringen/Nahrung setzen. **A:** mehrtägige Headless-Bot-Simulation prüft alle Regeln; Zeitraffer-Screenshots.

**M17 – Speichern/Laden + Menüs**
Stores `saves` (**3 Slots**) + `meta`, `SaveFile v1`, `migrate()`-Kette + `SaveTooNewError`; Autosave bei Morgengrauen, Bau-Eintritt, `pagehide` (ein Schreibvorgang gleichzeitig); Export (`<a download>`, `navigator.share`), Import (`<input type=file>` + Validierung), Backup-Hinweis bei verweigertem `persist()`. Hauptmenü, Slots, Einstellungen (Qualität, Empfindlichkeit, HUD, Vibration, fps-Limit), Pause, Install-Button (Android; feuert `beforeinstallprompt` nicht → Hinweis „Browser-Menü ⋮ → App installieren") + iOS-Hinweis, Onboarding „einmal online öffnen → Offline bereit", Debug-Menü sammelt die `__mb.cmd`-Befehle. **A:** Migrations-Tests, Save/Reload mitten im Lauf → gleicher Hash, Playwright Save → Reload. **N:** Export/Import am Handy.

**M18 – Laden-Ausstattung (CC0-Pipeline) – Checkpoint „Ausstattung"**
`npm run assets` (`build-atlas.mjs`: glTF-Transform `palette()`/`join()`, Maßstabs-Pass, **ohne** Draco/KTX2/Meshopt), Packs von den Urheber-Seiten (Kenney Food/Furniture/Mini Market, KayKit Restaurant Bits; Download ggf. durch N), `ASSETS.md` (Lizenz nie vom Aggregator ablesen), `@babylonjs/loaders` mit **nur** den benötigten glTF-Extensions, Vertex-AO; prozedurale Fallback-Props bleiben. **A:** `__mb.stats()` innerhalb `perfBudget.json`, Same-Origin-Check. **N:** CC0- vs. prozedurale Stations-Screenshots vergleichen, Leistungsbericht gegen die M8-Basis.

**M19 – Atmosphäre, Audio, Qualitätsstufen**
Lichtkegel-Karten (Flächenbudget), Staubpartikel, Ambiente-Audio, Laufzeit-Watchdog (eine Stufe runter bei Budget-Überschreitung), „hoch"-Extras (GlowLayer 256 **oder** LUT – nur nach Messung), Juice: Kamera-Vorausblick, Sprint-FOV-Kick, Staubwölkchen, Verdachts-Vignette, Sprung-Shake, Haptik. **N:** Audio/Haptik + Leistungsbericht.

**M20 – Härtung, Release v0.1.0**
`webglcontextlost` → Pause + Neuladen; **30-min-Dauerlauf** unbeaufsichtigt per `?autoplay=1` (Bot-Eingaben) mit Zeitreihe (fps, p95, Heap) im Leistungsbericht (**N**); Flugmodus-Nacht (**N**); iOS-Checkliste (mit Sitzung F zusammenlegen, falls offen); Balance-Pass; Cross-Engine-Hash (Chromium/Firefox/WebKit) + **Phase-2-Naht-Test** (Loopback-Transport mit Latenz/Verlust, Fake-Client sagt mit `stepPlayerMovement` voraus und gleicht ab → Fehler beschränkt); Doku/Spec-Nachtrag; Tag `v0.1.0`; Übergabenotizen Phase 2.

**Bewusst verschoben:** Gamepad (InputFrame trägt es bereits), Binär-SDP-Codec + Kandidatenfilter (erst nach Matrix F, gemessen), Web NFC, WebGPU, KTX2, Host-/Client-Modus, Lernstationen/Skills, Wollknäuel, Ausdauer-System, Titel-Kamerafahrt.

## Arbeitsweise bei der Umsetzung

- Nach Freigabe: Design als `docs/superpowers/specs/2026-09-21-phase0-phase1-design.md` ins Repo (erster Commit), dann je Meilenstein Detailplan (`writing-plans`) → TDD für `core`/`net`/`save` → `verification-before-completion`. Ultracode: Umsetzung und adversariales Review je Meilenstein per Workflow.
- Ehrliche Grenzen: Der Agent **hört nichts** und sieht nur **Standbilder** → Audio- und Bewegungs-QA macht der Nutzer; dafür gibt es Galerie, Kontaktbögen, Spektrogramme, Tuning-/SFX-Panel und Leistungsbericht (Feedback als Zahlen statt Beschreibungen).
- Handy-Loop: `npm run phone` + `adb reverse tcp:4173 tcp:4173` (Sekunden, ohne SW-Cache, mit Konsole); Pages für alles Offline-/Installations-/iOS-Relevante (`max-age=600` → „Nach Update suchen" + erwartete Build-ID).

## Verifikation (Ende-zu-Ende)

1. `npm run lint && npm test` – Core/Net/Save inkl. Golden-Hash, Level-Validator, Bots, Codec-Fixtures, Migrationen, Pose-/SFX-Tests.
2. `npm run build && node scripts/check-dist.mjs` – keine Decoder-/STUN-Signaturen, kein Legacy-Chunk, Lab ohne Babylon, Precache vollständig, Budgets.
3. Playwright lokal (tick-getrieben): Zwei-Tab-Lab-Flow, QR-Roundtrip, Offline-Smoke mit parametrisierten URLs, Same-Origin-Check der Spielseite, Stations-Screenshots + `__mb.stats()` gegen `perfBudget.json`, 2D-Ansicht der Katzen-KI.
4. CI grün → erwartete Build-ID auf `https://codecrafter-wizard.github.io/mouseraid/`.
5. Nutzer am Android: installieren → „Offline bereit" → Flugmodus → komplette Nacht (schleichen, looten, verstecken, gejagt werden, Beute ins Lager, schlafen, speichern, App schließen, fortsetzen); Leistungsbericht erfüllt das Gate auf der gewählten Stufe.
6. Phase 0: Sitzung A in `docs/connectivity-tests.md`; Matrix F, sobald ein zweites Handy verfügbar ist.
