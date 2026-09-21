# Entscheidungen & Befunde

## Tooling-Spike (M0, 2026-09-21)

| Frage | Ergebnis | Beleg / Hinweis |
|---|---|---|
| (a) Zwei Seiten mit echter RTCPeerConnection, Fake-Kamera, ohne STUN | grün | DataChannel-Austausch gelungen (`receivedByA = 'hallo von B'`, `receivedByB = 'hallo von A'`). Mit persistierter Kamera-Erlaubnis (`playwright.config.ts`: `use.permissions: ['camera']`) liefert Chrome ausschließlich echte Adressen (harte Assertion grün): 4 Host-Kandidaten: 2× private IPv4, 1× IPv6-ULA, 1× globale IPv6 – konkrete Adressen bewusst nicht protokolliert (öffentliches Repo). Gegenprobe Test (a2) — frischer Kontext mit `browser.newContext({ permissions: [] })`, also ohne persistierte Erlaubnis (Fake-UI-Flag akzeptiert den Dialog dennoch automatisch): 2 Host-Kandidaten, ausschließlich mDNS-Namen (uuid.local) |
| (b) Offline-Emulation per `context.setOffline` | grün | `fetch('version.json')` liefert `ok:true` → `context.setOffline(true)` → `ok:false` → `context.setOffline(false)` → `ok:true`, wie erwartet |
| (c) WebGL2-Screenshot nicht schwarz (Headless) | grün | Renderer (UNMASKED_RENDERER, unmaskiert): `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`; GPU-Timer-Extension `EXT_disjoint_timer_query_webgl2`: nein (headless liefert `null`) |
| (d) Handy-Chrome per adb + CDP fernsteuern | ausstehend – wartet auf adb-Installation durch den Nutzer | `Get-Command adb` findet nichts im PATH. `scripts/spike-adb-cdp.mjs` ist angelegt (genau wie im Plan), aber nicht ausgeführt. Bewusst kein Install-Versuch ohne den Nutzer. |

**Folgen für die Arbeitsweise:**
(a) **Beide Kamera-Regeln gelten – sie sind nicht dieselbe:**
1. Design-Regel (wörtlich aus der Spec, Abschnitt `diagnostics`): **„Kamera aus"-Lauf mit Status `granted` = ungültig.** Wer einen Lauf als „Kamera aus" protokolliert, obwohl der Permission-Status `granted` ist, misst etwas anderes als er behauptet.
2. Gemessene Umkehrung (Test (a2)): ein „Kamera an"-Lauf zählt ebenfalls **nur** mit Status `granted` – das bloße Akzeptieren des Dialogs durch `--use-fake-ui-for-media-stream` genügt nicht, obwohl `getUserMedia` erfolgreich auflöst.

Gemessene Regel: eine **persistierte** Kamera-Erlaubnis (`use.permissions: ['camera']` im Playwright-Projekt bzw. `context.grantPermissions(['camera'])`/`browser.newContext({ permissions: [...] })`) hebt Chromes mDNS-Verschleierung auf und liefert echte Host-IPs statt `.local`-Namen; das bloße automatische Akzeptieren des Berechtigungs-Dialogs durch `--use-fake-ui-for-media-stream` genügt dafür **nicht** – ohne persistierte Erlaubnis bleibt es bei mDNS-Namen, obwohl `getUserMedia` erfolgreich auflöst (siehe Gegenprobe Test (a2)). Das deckt sich mit der Phase-0-Design-Regel „Kamera-Lauf ohne Status `granted` ≠ Kamera-Lauf": das Lab-A/B-Testing in M1/M2 muss den tatsächlichen Berechtigungs-Status (z. B. `navigator.permissions.query({ name: 'camera' })`) loggen, nicht nur ob `getUserMedia` aufgerufen wurde. Die reine P2P-Verbindung (Offer/Answer ohne STUN, DataChannel-Nachrichtenaustausch) läuft in beiden Fällen zuverlässig headless.
(b) Offline-Emulation per `context.setOffline` funktioniert sauber und ist im Offline-Smoke (`tests/e2e/offline-smoke.spec.ts`) direkt einsetzbar.
(c) WebGL2-Screenshots sind dank `--enable-unsafe-swiftshader` + `--ignore-gpu-blocklist` auch headless nicht schwarz (Software-Renderer SwiftShader); GPU-Timer-Queries stehen in diesem Headless-Pfad nicht zur Verfügung – Performance-Messungen per `EXT_disjoint_timer_query_webgl2` brauchen echte GPU-Hardware bzw. `headless: false`, nicht die Standard-CI-Konfiguration.
(d) Handy-Fernsteuerung per adb/CDP ist bis zur adb-Installation nicht verifizierbar; Nachholtermin: `node scripts/spike-adb-cdp.mjs` sobald adb installiert und ein autorisiertes Gerät per USB verbunden ist.
Netzwerkadressen aus Test-Annotationen/Reports werden nie ins Repo übernommen (nur Art und Anzahl).

## Entscheidungen des Nutzers (2026-09-21)
- Umfang dieses Zyklus: Phase 0 + Phase 1.
- Die Zwei-Handy-Matrix (Phase 0) blockiert Phase 1 **nicht**; nur die Planung von Phase 2 wartet darauf.
- Testgeräte: ein Android-Handy, PC mit Webcam, zweites Handy nur gelegentlich geliehen. adb wird genutzt.
- Grafik: Hybrid (Maus, Katze, Raumhülle prozedural; CC0-Props von Kenney/KayKit).
- Hosting: GitHub Pages, öffentliches Repo `CodeCrafter-Wizard/mouseraid`.
- Tag/Nacht: 5 min / 5 min, beides manuell beendbar (ersetzt den Wert aus Spec §9).

## Abweichungen von der Spec (mit Begründung)
1. **Core ohne Babylon:** eigene 2.5D-Kollision + Wegpunkt-A* statt `moveWithCollisions`/Havok/`RecastJSPlugin` – diese sind Babylon-gebunden, Havok ist nicht geräteübergreifend deterministisch, RecastJSPlugin V1 wird abgekündigt.
2. **Determinismus ab Tag 1:** `Math.sin` & Co. sind laut ECMAScript engine-abhängig → eigenes Trig-Modul, Seeded-PRNG, Integer-Ticks, ESLint-Verbote, Golden-Hash.
3. **Babylon 9.27.x, WebGL2 explizit:** `EngineFactory` würde still WebGPU wählen (auf Android noch instabil). Kein KTX2/Draco/Meshopt – deren Decoder lädt Babylon vom CDN (Offline-Bruch).
4. **Kamera-Berechtigung ist Plan A:** Chrome liefert damit echte IPs statt mDNS; Safari ohne sie gar keine Host-Kandidaten. Text-Kopieren ist gleichwertiger Pfad.
5. **PWA:** `display: standalone` + `display_override`; kein `plugin-basic-ssl` (Service Worker registrieren nicht über selbstsigniertes HTTPS).
6. **Spielkamera:** eigener Spring-Arm mit Raycast gegen Core-Geometrie; kein `camera.checkCollisions`. `cameraMode: follow | diorama` pro Raum.
7. **Schleichen ohne Button:** analoge Joystick-Auslenkung = Tempo + Lautstärke (Schleichen als Skill kommt laut §8.9 später).
8. **TypeScript 6.0.x:** typescript-eslint unterstützt TS 7 noch nicht.
9. **Phase-0-Matrix:** nicht testbare Zellen werden als „nicht testbar" dokumentiert; iPhone-Zellen je einmal im Safari-Tab und in der installierten App.
10. **Flucht unter Regale** schon in Phase 1; Katze bekommt den Zustand „lauern". Wird am Spaß-GATE überprüft.

## Abweichungen vom M0-Plan (mit Begründung)

**CI/Deploy**
1. **Action-Versionen v7/v7/v5/v5** statt der im Plan genannten: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`. Zusätzlich `actions/upload-artifact@v7` (aktueller Major laut öffentlicher Releases-API) für die Playwright-Artefakte bei rotem Lauf (`if: failure()`, 7 Tage). Der Plan nannte ältere Majors; jeweils der aktuelle Major wird verwendet, damit keine veralteten Node-Runtimes im Runner landen.
2. **Job-Timeouts** (15 min Build, 10 min Deploy) sind im Plan nicht vorgesehen – ein hängender Runner soll nicht 6 h Kontingent verbrauchen.
3. **`concurrency` bricht auf `main` nie ab** (`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`): ein abgebrochener Pages-Deploy kann die Seite in einem halben Zustand hinterlassen. Überholte PR-Läufe werden weiterhin abgebrochen.

**check-dist (Gate härter als geplant)**
4. **Konservativer JS-Graph-Lauf:** jede gequotete `.js`-Zeichenkette gilt als mögliche Referenz und wird nur behalten, wenn sie auf eine existierende dist-Datei zeigt. Über-Erkennung ist gewollt – ein False Positive fällt in der Fehlerliste auf, ein False Negative (übersehene Babylon-Datei im Lab-Bundle) bliebe unsichtbar.
5. **`NOT_A_PAGE_MODULE`:** `sw.js` und `workbox-<hash>.js` sind keine Graph-Knoten. Sonst „importieren" beide Seiten über das Precache-Manifest transitiv den ganzen Build und die Grenze zwischen Spiel- und Lab-Bundle – der eigentliche Zweck des Graphen – verschwindet.
6. **`REQUIRED_FILES`:** fehlt eine Pflichtdatei, degradieren die übrigen Prüfungen unbemerkt zum Leerlauf. Ebenso ist ein **leerer JS-Graph** einer Seite jetzt ein Fehler, und eine im HTML referenzierte, aber fehlende Skriptdatei wird gemeldet statt mit ENOENT abzustürzen.
7. **Precache-Kandidaten per Ausnahmeliste** statt per Endungsliste: **jede** dist-Datei muss vorgecacht sein, außer `sw.js`, `registerSW.js`, `version.json`, `workbox-<hash>.js` und `*.map`. Die Liste ist bewusst **keine** Kopie von `globPatterns` – ein neuer Dateityp (`.jpg`, `.gltf`, `.bin` …) fällt so laut auf, statt still offline zu fehlen.
8. **Precache-Treffer in Manifest-Form** (`url:"<pfad>"`) statt als beliebige gequotete Zeichenkette: das echte `sw.js` nennt `"index.html"` ein zweites Mal in `createHandlerBoundToURL("index.html")` – ein fehlender Manifest-Eintrag für `index.html` wäre mit reiner Teilstring-Suche unsichtbar.

**ESLint-Leitplanken**
9. **Zusätzliche verbotene Globals im Core** über den Plan hinaus: `self`, `globalThis`, `location`, `history`, `screen` – sonst sind `self.Math.random()` & Co. ein offener Umweg um die Determinismus-Regeln.
10. **Zweiter AudioContext-Selektor** für Member-Expressions (`new self.AudioContext()`), den der reine `callee.name`-Selektor nicht sieht.
11. **Schichtgrenzen als Regexe über Pfad-Segmente** (`(?:^|/)(?:\.\.|src)/+(?:\./+)*(?:render|ui|net|…)(?:/|$)`, gebaut von `layerImportRegex()` in `eslint.config.js`) statt gitignore-artiger Gruppen (`**/input`). Die Gruppen hätten ab M3 auch core-**interne** Module wie `./input` oder `../sim/input` verboten, obwohl `src/core/sim/input.ts` laut Design zum Core gehört. Die erste Fassung war am Pfadanfang verankert (`^(?:\.\./)+…`) und ließ `./../render/…`, `..//render/…` und `../../../src/render/…` durch; seit M1 gilt: direkt hinter einem Segment `..` oder `src` darf kein Schichtname stehen.
12. **`**` und `**=` im Core verboten** – der Potenz-Operator ist laut ECMAScript genauso „implementation-approximated" wie `Math.pow`.
13. **Flat Config ersetzt Regel-Optionen pro Block, sie summiert sie nicht.** Ein nur im `src/**`-Block ergänzter Selektor fehlte im core-Block still. Deshalb bauen alle `no-restricted-syntax`-Listen auf gemeinsamen Konstanten auf (`SYNTAX_BANS`, `CORE_SYNTAX_BANS`); der Block für `src/audio/audioBus.ts` ersetzt sie absichtlich.

**Tests**
14. **Zusatztest (a2)** (Gegenprobe ohne persistierte Kamera-Erlaubnis) und **`permissions: ['camera']`** im Playwright-Projekt sind Ergebnisse des Spikes, nicht des Plans – ohne sie liefert Chrome nur mDNS-Namen und die harte Kandidaten-Assertion wäre nicht messbar.
15. **Testordner-Konvention** weicht vom Baum im Design ab: Vitest findet `tests/**/*.test.ts` (Node-only in `tests/node`), Playwright `tests/e2e/*.spec.ts`. Die Endung trennt, nicht eine handgepflegte `exclude`-Liste – ein neuer Testordner wird dadurch nie still übersehen.
16. **E2E-Gate bleibt in M0 eine Positivliste** (`npm run e2e:smoke` in der CI, Tooling-Spike nur lokal). Ob es dabei bleibt oder auf `@local`-Tags umgestellt wird, wird entschieden, **sobald in M1 der erste CI-taugliche Spec dazukommt** – vorher gäbe es nichts zu tagen.

**Laufzeit**
17. **Update-Fluss ehrlich gemacht:** `registration.update()` löst auch bei GEFUNDENEM Update auf, deshalb entscheidet `updateCheckOutcome()` (rein, unit-getestet) anhand von `installing`/`waiting` zwischen „wird geladen", „bereit" und „kein Update"; ein Fehlschlag meldet „offline?" statt eines Registrierungsfehlers. Chip und Knopf sagen dasselbe. „Jetzt aktualisieren" lädt auch ohne wartenden Worker neu (unkontrollierte Seite), und „Nach Update suchen" lädt neu, wenn es gar keinen Service Worker gibt (Modus `phone`, Browser ohne SW-Unterstützung).
18. **Build-ID:** 8-stelliger Kurz-SHA; `?expect=` und `wait-for-deploy` akzeptieren zusätzlich ein **≥ 7-stelliges Präfix** (`git rev-parse --short HEAD` liefert per Voreinstellung 7 Stellen). Dirty-Builds heißen `<sha>-dirty-<HHmmss>` (UTC) und werden **nur exakt** verglichen – sonst gälte ein alter Handy-Build als die erwartete saubere Version.

**Datenschutz**
19. **SDP-Fixtures und Laborberichte werden vor dem Commit anonymisiert:** IP-Adressen durch Dokumentationsadressen nach RFC 5737 (IPv4) bzw. RFC 3849 (IPv6) ersetzt, `uuid.local`-Namen neu gewürfelt, `ice-ufrag`/`ice-pwd`/`fingerprint` ausgetauscht. Durchgesetzt von `tests/node/privacy-guard.test.ts`, das bei jedem `npm test` alle getrackten Textdateien scannt und nur Art und Anzahl der Befunde meldet.

## Erster Deploy und Update-Fluss (2026-09-21, gemessen)

- **Erster Push/Deploy:** Build-Job auf `ubuntu-latest` komplett grün (Lint, Typecheck, 46 Tests, Pages-Build, `check-dist`, Offline-Smoke). Der Deploy-Job scheiterte erwartungsgemäß, solange Pages nicht aktiviert war. Pages lässt sich mit dem Fine-grained-Token **nicht** per API einschalten (HTTP 403 – dafür wäre zusätzlich „Administration: write" nötig, das bewusst nicht vergeben ist) → einmalig von Hand: Settings → Pages → Source „GitHub Actions". Danach genügt `rerun-failed-jobs` per API; das Build-Artefakt wird wiederverwendet. Vom Neustart bis „live" vergingen rund 6 Minuten.
- **Abnahme M0:** Live-Prüfung im Browser bei 844×390 (offline-bereit, Service Worker im Scope `/mouseraid/`, `?expect=` mit 7-stelligem Präfix → Treffer, keine Fremd-Requests) und auf dem Android-Handy des Nutzers (Installation, Flugmodus-Start, Testlabor mit drei „ja") bestanden. Tag `m0`.
- **Update-Fluss echt durchgespielt (zweiter Deploy, Build `709c01e2` → `4ed36ce0`), Chromium mit installiertem altem Service Worker:** Beim Öffnen liefert der alte Worker weiter den alten Build aus (kein Auto-Reload); die browser-eigene Update-Prüfung findet den neuen Worker sofort → Chip „Neue Version bereit.", Knopf „Jetzt aktualisieren" sichtbar. „Nach Update suchen" bleibt dabei korrekt bei „Neue Version bereit." (wartender Worker). Klick auf „Jetzt aktualisieren" → genau **ein** Reload → neuer Build, Seite kontrolliert, „Offline bereit ✓". Erneutes „Nach Update suchen" → „Kein neues Update gefunden.", Knopf verborgen. Noch nicht am Handy von Hand wiederholt (folgt beim nächsten Deploy nebenbei).

## M1 – Nachzügler aus dem M0-Abschlussreview

1. **Build-ID-Regel genau einmal:** `matchesBuildId` liegt in `src/platform/buildIdMatch.ts` (ohne Importe, ohne `__BUILD_ID__`). `scripts/wait-for-deploy.mjs` importiert diese TypeScript-Datei direkt – Node entfernt die Typen beim Laden (Type-Stripping, ohne Flag ab Node 22.18; deshalb `engines.node >= 22.18.0`), das Skript braucht weiterhin keinen Build-Schritt. Verworfen: eine zweite Kopie unter `scripts/lib` mit gemeinsamer Falltabelle – das Duplikat bliebe bestehen, und `tests/node` kann `buildInfo.ts` wegen `__BUILD_ID__` nicht ohne Kniff importieren.
2. **`pwa.ts` hängt je Worker nur einen `statechange`-Listener an** (Merker per `WeakSet`, getrennt für „lädt" und „wartet", weil derselbe Worker erst `installing` und dann `waiting` ist). `{ once: true }` wäre falsch gewesen: der erste Zustandswechsel (`installed` → `activating`) ist noch nicht `activated`.
3. **Playwright sammelt nur `**/*.spec.ts`** (`testMatch`). Ohne die Zeile nimmt Playwright auch `*.test.ts` mit – gemessen mit `npx playwright test --list` (der Listen-Modus startet keinen Webserver).
4. **Datenschutz-Wächter:** Das positive IPv6-Beispiel stammt aus dem Dokumentationsbereich `3fff::/20` (RFC 9637) statt aus einem real vergebenen Präfix. Der Bereich ist **bewusst nicht freigestellt** – der Wächter stuft weiterhin ganz `2000::/3` außer `2001:db8::/32` als Befund ein; Fixtures benutzen nur `2001:db8::/32`. Ohne Git-Checkout (entpacktes Archiv) wird der Datei-Scan mit einer Meldung auf stderr übersprungen; in der CI (`CI` gesetzt) bleibt das ein Fehler.
5. **ESLint ignoriert `.superpowers/`:** Flat Config überspringt Punkt-Ordner nicht von selbst; liegengebliebene Arbeitsdateien der Agenten hätten `npm run lint` rot gemacht.
6. **Bekannte Grenze:** `no-restricted-imports` prüft nur statische Importe und Re-Exporte, kein dynamisches `import()`.

## Offene Punkte

- **Update-Suche offline:** Headless ist nur der Fall „kein Update" natürlich erreichbar: **gemessen** löst `registration.update()` auch bei `context.setOffline(true)` (und bei abgebrochener `sw.js`-Route) auf – Playwrights Netz-Emulation greift nicht für die Skript-Anfrage des Service Workers, die der Browser selbst stellt. Die beiden anderen Zweige wurden deshalb mit gepatchtem `update()` im echten Chromium geprüft: Ablehnung → „Update-Suche fehlgeschlagen – offline?" (Knopf bleibt verborgen), wartender Worker → „Neue Version bereit." (Knopf sichtbar).

## Beobachten (vor jedem Release prüfen)
- Chrome „Local Network Access" für WebRTC: chromestatus.com/feature/5065884686876672 und /5068298146414592
- Firefox: bugzilla.mozilla.org/show_bug.cgi?id=1969916
- WebKit-Bug 301994 (Statusleisten-Balken in installierten iOS-Web-Apps)
