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
16. **E2E-Gate bleibt in M0 eine Positivliste** (`npm run e2e:smoke` in der CI, Tooling-Spike nur lokal). Ob es dabei bleibt oder auf `@local`-Tags umgestellt wird, wird entschieden, **sobald in M1 der erste CI-taugliche Spec dazukommt** – vorher gäbe es nichts zu tagen. **Entschieden in M1:** Ausschlussliste per Tag `@local`, siehe „M1 – Testlabor I" → „E2E-Tor".

**Laufzeit**
17. **Update-Fluss ehrlich gemacht:** `registration.update()` löst auch bei GEFUNDENEM Update auf, deshalb entscheidet `updateCheckOutcome()` (rein, unit-getestet) anhand von `installing`/`waiting` zwischen „wird geladen", „bereit" und „kein Update"; ein Fehlschlag meldet „offline?" statt eines Registrierungsfehlers. Chip und Knopf sagen dasselbe. „Jetzt aktualisieren" lädt auch ohne wartenden Worker neu (unkontrollierte Seite), und „Nach Update suchen" lädt neu, wenn es gar keinen Service Worker gibt (Modus `phone`, Browser ohne SW-Unterstützung).
18. **Build-ID:** 8-stelliger Kurz-SHA; `?expect=` und `wait-for-deploy` akzeptieren zusätzlich ein **≥ 7-stelliges Präfix** (`git rev-parse --short HEAD` liefert per Voreinstellung 7 Stellen). Dirty-Builds heißen `<sha>-dirty-<HHmmss>` (UTC) und werden **nur exakt** verglichen – sonst gälte ein alter Handy-Build als die erwartete saubere Version.

**Datenschutz**
19. **SDP-Fixtures und Laborberichte werden vor dem Commit anonymisiert:** IP-Adressen durch Dokumentationsadressen nach RFC 5737 (IPv4) bzw. RFC 3849 (IPv6) ersetzt, `uuid.local`-Namen neu gewürfelt, `ice-ufrag`/`ice-pwd`/`fingerprint` ausgetauscht. Durchgesetzt von `tests/node/privacy-guard.test.ts`, das bei jedem `npm test` alle getrackten Textdateien scannt und nur Art und Anzahl der Befunde meldet.
20. **Auch lokale Benutzerpfade sind Datenschutz** (Abschluss-Review M3): `C:\Users\<name>`, `/home/<name>` und `/Users/<name>` nennen das Konto auf dem Entwicklungsrechner. Pläne und Runbooks schreiben stattdessen `$repo = '<Pfad zum lokalen Checkout>'`; seit M3 hat der Wächter dafür ein eigenes Muster (Befund wieder nur als Art, nie als Wert). Der Platzhalter selbst passt nicht darauf – hinter dem Trenner steht `<`, kein Namenszeichen. Gefunden hat das Muster beim Einbau genau eine Datei: den M2-Plan (3 Nennungen), im selben Commit geschwärzt.

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

## M1 – Testlabor I (2026-09-23)

### Fehlercodes F1–F9 (verbindliche Definition)

| Code | Bedeutung |
|---|---|
| F1 | keine Host-Kandidaten |
| F1S | dasselbe auf WebKit ohne Kamera-Erlaubnis („Kamera erlauben oder Text-Pfad") |
| F2 | nur mDNS-Kandidaten |
| F3 | ICE fehlgeschlagen |
| F4 | iPhone-Hotspot-Isolation (Adresse 192.0.0.2) |
| F5 | Code ungültig / Versionskonflikt / falsche Rolle |
| F6 | Umgebung ungeeignet (kein sicherer Kontext, kein WebRTC, Local-Network verweigert) |
| F7 | ICE verbunden, Kanäle nach 10 s nicht offen |
| F8 | Verbindung verloren (war offen) |
| F9 | Kamera-/QR-Problem (M1: Kamera-Anforderung fehlgeschlagen; ab M2 zusätzlich jeder Zeitleisten-Eintrag `qr:error`. **Nicht** F9: `qr:skipped` – ein übersprungener fremder QR-Code) |

Diese Tabelle ist ab M1 **die** Definition des Projekts. Im Code: `classifyFailures` in `src/net/failureCodes.ts` (stabile Reihenfolge F1…F9, leere Liste = kein Befund); die Texte für Nutzer stehen unter `S.failures` in `src/ui/strings.ts`. Die Spec nennt nur „F1–F9 (F1 mit Safari-Variante)" ohne Einzelbedeutungen, und die beiden Entwurfslisten aus der Recherche- und der Design-Runde wichen in Nummerierung und Zuschnitt voneinander ab – Reports, UI-Texte und `docs/connectivity-tests.md` beziehen sich deshalb ausschließlich auf diese Tabelle, nicht auf die Entwürfe.

**Warum es F1S gibt:** WebKit liefert ohne Kamera-Erlaubnis grundsätzlich keine Host-Kandidaten (Spec-Abweichung 4). Das ist erwartetes Verhalten mit eigener Abhilfe („Kamera erlauben oder Text-Pfad") und kein Netzproblem wie ein echtes F1. Ein eigener Code hält beide Fälle in der Auswertung getrennt, ohne die Nummern F2–F9 zu verschieben.

### Payload-Format und gemessene Größen
Der Signalisierungs-Text hat die Form `MB1.<d|p>.<base64url>`: `MB1` = Formatkennung, `d` = mit `deflate-raw` komprimiert, `p` = unkomprimiert (Fallback ohne `CompressionStream`), danach base64url des kompakten JSON `{v,p,r,s,n,u,w,f,t,k,m,c}` (siehe `src/net/sdpCodec.ts`). Leerraum und Zeilenumbrüche in eingefügtem Text werden ignoriert. Der Codec filtert **keine** Kandidaten – IPv6, link-local, `.local` und TCP bleiben in ihrer Reihenfolge erhalten.

Gemessen am 2026-09-23 mit echten Chromium-SDPs auf dem Entwicklungsrechner (zwei DataChannels, `iceServers: []`; festgehalten sind nur Anzahlen und Größen, keine Adressen). „Kamera an" = persistierte Kamera-Erlaubnis + `getUserMedia` vor der PeerConnection:

| Lauf | Kandidaten (davon mDNS / TCP) | SDP-Bytes | minimiert (JSON-Bytes) | gepackt (Bytes) | Payload-Zeichen | Modus |
|---|---|---|---|---|---|---|
| Kamera aus – Angebot | 2 (2 / 0) | 716 | 400 | 276 | 374 | d |
| Kamera aus – Antwort | 2 (2 / 0) | 715 | 400 | 277 | 376 | d |
| Kamera an – Angebot | 12 (0 / 6) | 2061 | 1625 | 523 | 704 | d |
| Kamera an – Antwort | 6 (0 / 0) | 1228 | 859 | 386 | 521 | d |

Größter gemessener Payload: 704 Zeichen bei 12 Kandidaten (Kamera an – Angebot). Zielwert der Spec: typischer Payload (≤ 4 Kandidaten) ≤ 800 Zeichen – gegen die Fixtures sichern ihn die Unit-Tests des Codecs ab.

Lab-Bundle nach M1: 29.3 kB gzip (Budget 150 kB, `npm run check-dist`).

### Zeitleiste ohne Adressen
**Kandidaten-Ereignisse in der Zeitleiste enthalten nie Adressen.** Das Ereignis `candidate` trägt als Detail nur Typ und Familie. Die wörtlichen Kandidaten stehen ausschließlich in `gather.gathered` des Reports – genau dem Feld, das `redactReport` durch `<familie>/<scope>#n` ersetzt. So bleibt die Zeitleiste in jedem Report ohne Nachbearbeitung teilbar.

### Entwicklungs- und Test-Parameter von `lab.html`
Nur für Entwicklung und Playwright; die Oberfläche verlinkt sie nirgends.

| Parameter | Wirkung |
|---|---|
| `?transport=bc&room=<name>&role=host\|client&slot=<1–3>` | `BroadcastChannel` statt WebRTC (`src/net/broadcastTransport.ts`, Kanal `maeusebau-lab-<name>`): zwei Tabs desselben Browsers verbinden sich ohne Netz und ohne Codes. Grundlage von `tests/e2e/lab-broadcast.spec.ts`. |
| `?quick=1` | 20 statt 200 Pings je Kanal (der Selbsttest misst ohne den Parameter 50 je Kanal, der BroadcastChannel-Modus immer 20) – für schnelle Testläufe. Reports aus solchen Läufen zählen nicht für `docs/connectivity-tests.md`. |
| `?hook=1` | hängt `window.__mbLab` ein (`src/lab/labHook.ts`) – seit M2 **20 Mitglieder**: die 7 der Netz-Schicht aus M1 (`createHostLobby`, `createClientJoin`, `createMessageRouter`, `createTimeline`, `runPingSeries`, `attachPongResponder`, `PROTOCOL_VERSION`) und 13 aus M2 – QR-Anzeige (`renderQr`, `qrModuleCount`, `MAX_QR_PAYLOAD_CHARS`), Scanner (`detectScanBackend`, `scanImage`, `scanVideo`), Kamera (`openLobbyCamera`, `cameraStream`, `attachCamera`, `restartCamera`), Austausch (`createQrExchange`, `createPairingTracker`) und der Zähler `liveExchangeCount`. Verbindlich ist die Liste in `src/lab/labHook.ts`. Ohne den Parameter existiert der Haken nicht. |

### Gemessene Befunde (nur Art und Anzahl)
- **Chromium meldet einen nie verbundenen ICE-Lauf nicht als `ice:failed`:** nach ≈ 15 s steht `iceConnectionState` auf `disconnected`, nur `connectionState` wird `failed`. `rtcTransport` setzt `failed` deshalb bei beiden Signalen, `labSession` speist F3 aus beiden.
- **Playwright/Headless: `local-network` und `loopback-network` melden `denied`**, sobald ein Kontext irgendeine Berechtigung gesetzt bekommt – obwohl die Verbindung steht. Specs, die `finishRun`/`classifyFailures` auslösen, erteilen deshalb zusätzlich `local-network-access` (`context.grantPermissions`, additiv). Sonst stünde in jedem Report F6.
- **Android-Chrome 153 ohne Kamera-Erlaubnis liefert KEINE mDNS-Namen, sondern einen echten Host-Kandidaten** (Selbsttest am Android-Handy, 2026-09-25, Build 89c959d1): Lauf A (`permissions.camera = prompt`, kein `getUserMedia`) sammelte genau **1** Kandidaten – private IPv4, UDP, `network-cost 999`, also nur die Standardroute; Lauf B (nach `getUserMedia`, `granted`) sammelte **6**: private IPv4 + zwei globale IPv6, je UDP und TCP, beide Läufe gültig, 50/50 Pings, Median ≈ 1,4–1,5 ms. Folgen: (1) die Desktop-Messung aus M0 („ohne Erlaubnis nur mDNS") gilt am Handy nicht – dort beschneidet Chrome ohne Erlaubnis die Schnittstellen (nur Standardroute), verschleiert aber nicht; das Pass-Kriterium „QR-tauglich" (echte IP > 0, kein mDNS) ist auf diesem Handy schon ohne Kamera erfüllt; (2) die Kamera-Erlaubnis bringt IPv6 und TCP dazu – für den Hotspot-Fall (Matrix F) bleibt sie deshalb Plan A; (3) die Gültigkeitsregel funktioniert am Gerät wie vorgesehen (Lauf A gültig bei `prompt`); (4) `BarcodeDetector` mit `qr_code`, Wake Lock und `local-network`-Berechtigung (Status `prompt`, für Loopback nicht nötig) sind vorhanden. Sitzung A muss zeigen, ob die Standardroute allein für die Verbindung zum PC reicht.
- **Persistierte Kamera-Erlaubnis liefert echte Host-Kandidaten schon ohne `getUserMedia`** (auf dem Entwicklungsrechner 12: je 6 UDP und TCP). Ohne Erlaubnis sind es 2 mDNS-Kandidaten. Im Selbsttest ist Lauf A auf so einem Profil deshalb korrekt **ungültig**.
- **Auf einer geschlossenen PeerConnection bleiben `createOffer`/`setLocalDescription` für immer unentschieden.** `RtcPeer` bricht sie mit `AbortError` ab; die Oberfläche ignoriert `AbortError`.
- **F3 und F8 können gemeinsam auftreten** (war offen, ICE `failed`); F6 steht immer allein.
- **Fixtures:** Die Chromium-Zeilenstruktur ist erfasst; Firefox ist handgeschrieben (Playwright-Firefox ist nicht installiert), Safari synthetisch. Echte Mitschnitte folgen nach Sitzung A/B.
- **Firefox kennt `permissions.query({name:'camera'})` nicht** → Status `unsupported` → „Kamera an"-Läufe gelten dort als ungültig. In der Matrix sind sie „nicht testbar" (Spec-Abweichung 9).
- **WebKit/iOS ungemessen:** Meldet Safari nach dem Erlauben der Kamera weiter `prompt` oder `unsupported`, markiert die Gültigkeitsregel einen echten „Kamera an"-Lauf als ungültig. Der Report enthält dann trotzdem alles Nötige (Berechtigungsstatus, „getUserMedia in dieser Sitzung", Kandidaten nach Art). Die Regel wird nach dem ersten iPhone-Selbsttest-Report kalibriert (mögliche Verfeinerung: auf WebKit zählt ein laufender Kamera-Stream statt des Berechtigungsstatus).
- **`alwaysNegotiateDataChannels`** wird weder benutzt noch erfasst. Die Kanäle sind `negotiated: true` und werden vor `createOffer` angelegt.
- **TypeScript 6:** `Uint8Array<ArrayBufferLike>` ist nicht an `BlobPart`/`RTCDataChannel.send` zuweisbar → Kopie `new Uint8Array(bytes)`.

### Abweichungen vom M1-Plan (aus den Task-Reviews)
Die Reviews der Tasks 2–9 haben den Plantext an diesen Stellen überholt. Maßgeblich ist der Code.

**Codec (Task 3)**
- `decodeDesc` riegelt vor dem Entpacken ab: eingefügter Text über 4096 Zeichen (nach Entfernen von Leerraum) → `CodecError 'shape'`; entpackter Rumpf über 16384 Bytes → `'inflate'` (im unkomprimierten Modus `p`: `'shape'`). Das begrenzt die Aufblähung durch deflate-raw (bis ≈ 1000:1) auf wenige MB. `minimise` lehnt `a=sctp-port` über 65535 und `a=max-message-size` über `Number.MAX_SAFE_INTEGER` ab.
- Payload-Größen der Fixtures mit dem echten Codec: chromium-offer 369, chromium-answer 300, firefox-offer 330, firefox-answer 257, safari-synthetisch 265 Zeichen; vier mDNS-Kandidaten 488 Zeichen (Modus `d`) bzw. 860 (Modus `p`).

**Transport (Task 5)**
- Der BroadcastChannel-Umschlag trägt eine Instanz-Kennung `inst` (`crypto.randomUUID()` je Transport). Nur `syn` (immer) und das **erste** `ack` führen die Instanz der Gegenstelle ein; `data` wird nur aus der aktuellen Instanz zugestellt, `bye` nur aus ihr befolgt – ein Nachzügler-`bye` eines neu geladenen Tabs schließt keine frische Verbindung mehr. Ein `syn` mit neuer `inst` heißt „Gegenstelle neu gestartet": die Verbindung bleibt offen und wird neu bestätigt.
- `messageRouter` kapselt jeden Handler-Aufruf einzeln: Handler-Fehler gehen an `onProtocolError`, ohne Callback asynchron per `queueMicrotask` weiter; ein selbst werfendes `onProtocolError` ist genauso abgesichert. `runPingSeries` ordnet Pongs über `seq` **und** `sentAtMs` zu – Nachzügler einer früheren Serie zählen nie mit.

**WebRTC-Schicht (Task 6)**
- `RtcPeer.close()` räumt ein laufendes Gathering-Warten ab (Timer und Listener); nach außen bleibt es beim `AbortError`.
- `ClientJoin` zählt Generationen: `close()` oder ein neueres `acceptOffer` während des asynchronen Dekodierens bricht den älteren Aufruf mit `AbortError` ab – die Aufrufreihenfolge entscheidet, nicht die Reihenfolge der Dekodier-Ergebnisse. Fehler aus `rebuildSdp` werden auf beiden Seiten zu `HandshakeError('F5')`.

**Report-Modell (Task 7)**
- `redactReport` schwärzt bewusst großzügig: nach der positionsgenauen Kandidaten-Ersetzung läuft es über **jede** Zeichenkette des Reports (Ausnahmeliste, byte-gleich übernommen: `id`, `createdAt`, `buildId`, `environment.userAgent`, `environment.buildId`). Reihenfolge je Zeichenkette: NFKC und Entfernen unsichtbarer Zeichen → Adressmuster (IPv4 = ganzer Punkt-Lauf ab vier Gruppen; IPv6 = jedes Hex-Wort mit mindestens zwei Doppelpunkten außer echten Uhrzeiten `hh:mm:ss`; mDNS ohne Wortgrenzen) samt wörtlicher Ersetzung jeder bekannten gesammelten Adresse (längste zuerst, Groß-/Kleinschreibung egal) → Kandidaten-Geheimnisse (`ufrag`, `usernameFragment`, `a=ice-ufrag`/`ice-pwd`/`fingerprint`, `candidate:<foundation>`) → Payload-Texte (`MB1.<modus>.<base64url>` sowie jeder base64url-Lauf ab 32 Zeichen). Foundations werden zu Ordinalen `f1`, `f2`, … je Report. Alle Quantoren sind begrenzt, es gibt kein Lookbehind (altes Safari), die Eingabe bleibt unverändert. Laufzeit: linear in der Textlänge; Schicht 2 (bekannte Adressen) zusätzlich quadratisch in der Kandidatenzahl (bei den gemessenen ≤ 20 Kandidaten belanglos). Idempotent sind die Adress-Schichten – sie laufen bis zum Fixpunkt; die Geheimnis- und Payload-Regeln laufen je Aufruf nur einmal, weshalb feindlich zusammengeklebte Reste erst nach einem ZWEITEN Durchlauf stillstehen. Lesbarer Adresstext entsteht dabei nie wieder, es ändert sich nur die Lesbarkeit der Schwärzung.
- `looksLikeReport` prüft die Blatttypen jedes Feldes, das die Text- und JSON-Ausgabe anfasst; `add()` halbiert den Verlauf nur, wenn `setItem` wirft, und ersetzt ihn nie, wenn `getItem` wirft. In `src/` steht kein ES2022-Bibliotheksaufruf (Wächter `tests/node/es-library-guard.test.ts`) – altes Safari würde daran scheitern, also genau auf den iPhones, die das Labor vermessen soll.
- Neuer Export `redactText(text)` schwärzt eine freie Zeichenkette mit denselben Schichten (Abbruchgrund des Selbsttests). `reportToText`/`reportsToJson` schwärzen **nicht** von sich aus – jeder Kopier- und Teilen-Weg setzt `redactReport` davor. Ausnahmen sind der ausdrücklich so beschriftete Einzel-Report „mit echten Adressen" und „Roh-SDP kopieren"; beide warnen im Text.

**Labor-Oberfläche (Task 8)**
- `labSession` beantwortet ein empfangenes Hello einmal je Verbindung von selbst (eigener Riegel `answered`, unabhängig davon, ob schon ein eigenes Hello hinausging). Sonst bekäme eine Seite, die ihren Lauf vor dem Anhängen der Gegenstelle abschließt, nie eine Antwort. Die Hello-Wartezeit beträgt höchstens 3 s, danach `hello: null` und Zeitleisten-Eintrag `run:hello` = „keine Antwort"; `versionMatch=false` ergibt F5.
- Das Kästchen „Einzel-Report als JSON mit echten Adressen kopieren (nie öffentlich posten)" schaltet „Report kopieren" auf `reportsToJson([report])` **ungeschwärzt** für genau einen Report um (Voreinstellung aus, wird nie gespeichert und bei jedem neuen Lauf zurückgesetzt); „Alle Reports kopieren (JSON, anonymisiert)" und „Alle teilen" sind immer geschwärzt. „Verlauf löschen" entschärft sich nach 5 s von selbst.
- Knöpfe eines Host-Platzes (Feinschliff-Commit nach dem Abschlussreview): „Verbinden" sperrt sich synchron im Tipp und bleibt danach gesperrt – nur ein Fehlschlag gibt ihn für den nächsten Versuch wieder frei (beim Öffnen verschwindet das Code-Feld ohnehin). „Ping-Test starten" ist schon im Zustand „verbinde …" freigegeben, damit die Diagnose eines nie geöffneten Platzes (F7/F3) überhaupt erreichbar ist; „Platz freigeben" speichert bei so einem Platz erst die Diagnose und schließt dann – genau einmal je Verbindung, und der `pagehide`-Zuhörer des Platzes wird mit abgemeldet.
- Ein Fehlercode aus einem GESPEICHERTEN Report, den dieser Build nicht kennt (neuerer Build im veralteten PWA-Cache), steht in der Report-Liste wörtlich da, statt `mountLab` mit einem Zugriff auf `S.failures[code].title` zu zerlegen.
- Das Diagnose-Panel aus M0 (`installErrorPanel`) bekommt auf `lab.html` `redactText` als Schwärzer für Fehlertext und Stack durchgereicht: ein SDP-Parserfehler zitiert die fehlerhafte Zeile samt Adresse, und „Diagnose kopieren" ist ein Kopierweg wie jeder andere. Auf der Spielseite bleibt das Panel unverändert (dort trägt kein Fehlertext eine Adresse); `src/platform` kennt `src/lab` weiterhin nicht – der Schwärzer ist ein Rückruf-Parameter.

**Selbsttest (Task 9)**
- `pingCountFor('loopback')` = 50 Pings je Kanal – damit bleiben beide Läufe zusammen unter zwei Minuten.
- Lauf A („Kamera aus") ist auf jedem Profil mit persistierter Kamera-Erlaubnis **ungültig** – so gewollt (`isRunValid`); die Oberfläche nennt den Grund und den Ausweg (Kamera-Berechtigung zurücksetzen, Seite neu laden, wiederholen).
- Der Abbruchgrund eines gescheiterten Laufs wird im Teilen-Text mit `redactText` geschwärzt; auf dem Bildschirm zeigt ein bekannter F-Code stattdessen `S.failures[code].title`.

### E2E-Tor: Ausschlussliste per Tag `@local`
Entscheidung zu Punkt 16 der „Abweichungen vom M0-Plan": Mit `tests/e2e/lab-broadcast.spec.ts` gibt es den ersten CI-tauglichen Spec neben dem Offline-Smoke – das Tor wird von der Positivliste auf eine **Ausschlussliste** umgestellt.
- `npm run e2e:smoke` = `playwright test --grep-invert @local` – läuft in `npm run verify` und in der CI vor jedem Deploy. Der Name bleibt, damit Workflow und Doku weiter stimmen.
- `npm run e2e:local` = `playwright test --grep @local` – nur auf dem Entwicklungsrechner: Tooling-Spike (`tooling.spec.ts`), echter WebRTC-Ablauf und Selbsttest (`lab-rtc.spec.ts`). Diese Tests brauchen echte Netzwerkschnittstellen, eine persistierte Kamera-Erlaubnis bzw. Software-WebGL.
- **Folge: Jeder neue Spec gehört zum Deploy-Tor, außer jeder seiner Tests trägt `{ tag: '@local' }`.** Vergessen ist damit laut statt still: ein nicht CI-tauglicher Spec ohne Tag färbt die CI rot, statt – wie bei der Positivliste – unbemerkt nie zu laufen.
- In PowerShell das Tag in Anführungszeichen setzen (`npx playwright test --grep '@local'`), sonst deutet die Shell `@local` als Splatting und der Filter fehlt.
- `check-dist` prüft seit dem M1-Feinschliff auch, dass der JS-Graph der **Spielseite** frei von Labor-/Netz-Signaturen bleibt (`maeusebau-lab-`, `RTCPeerConnection`, `CompressionStream`; `scripts/lib/distChecks.mjs` → `findLabSignatures`). Das gilt für Phase 0+1, in der die Spielseite kein Netz hat. **Phase 2 (Koop-Netzcode auf `index.html`) muss diese Liste auf reine Labor-Marker (`maeusebau-lab-`) verengen**, sonst schlägt das Tor beim ersten `src/net`-Import der Spielseite an.

## M2 – Testlabor II (Kamera + QR) (2026-09-25)

### Bibliotheken, Lizenzen und Audit
Genau drei neue Abhängigkeiten, alle mit exaktem Pin (ohne `^`) und alle **MIT**:

| Paket | Version | Rolle | Lizenz |
|---|---|---|---|
| `qrcode` | 1.5.4 | Laufzeit (QR-Erzeugung) | MIT, „Copyright (c) 2012 Ryan Day" |
| `qr-scanner` | 1.4.2 | Laufzeit (QR-Dekodierung) | MIT, „Copyright (c) 2017 Nimiq, danimoh" |
| `@types/qrcode` | 1.5.6 | nur Typen (dev) | MIT (DefinitelyTyped) |

Der von der Spec verlangte **`qrcode`-Lib-Audit ist damit erledigt**: im gebauten Lab-Chunk steht kein
`Buffer`, kein `process.`, kein `require(` und kein `fs`; es gibt keine Fremd-Hosts. Die einzige URL im
Bundle ist `http://www.w3.org/2000/svg` – der XML-Namensraum des SVG-Renderers, der nie geladen wird.
(Am 2026-09-25 gegen `dist/` nachgemessen; `check-dist` prüft die Signaturen `process.(env|version|platform)`
und `Buffer.(from|alloc)` seitdem bei jedem Lauf.) Der Worker von `qr-scanner` enthält weder WASM noch
eine URL; er entsteht aus einer **Blob-URL** (`new Worker(URL.createObjectURL(...))`). Kein Fremd-Host –
aber eine später ergänzte CSP bräuchte `worker-src blob:`.

Import-Form: `import QRCode from 'qrcode'` (Vite löst das `browser`-Feld auf). **Nie** der tiefe Pfad
`qrcode/lib/browser.js` (byte-identisch dasselbe) und **nie** `QRCode.toFile`/`toBuffer`: die Typen
kennen beide, der Browser-Build hat sie nicht – zur Laufzeit wäre es `undefined`.

### Abweichungen vom Spec-Absatz M2
Der Spec-Absatz (Zeilen 100–103 des Designs) ist älter als die Messungen. Diese vierzehn Punkte weichen
bewusst ab; maßgeblich ist jeweils die gemessene Wirklichkeit.

1. **Keine `QrScanner`-Instanz.** `stop()`/`destroy()`/`pause()` der Instanz beenden **unseren**
   Kamera-Stream (`track.stop()` **und** `stream.removeTrack`), und der Konstruktor hängt einen
   `visibilitychange`-Zuhörer ein, der beim Sperrbildschirm-Test genau das tötet, was gemessen werden
   soll. Benutzt werden nur `QrScanner.createQrEngine()` (einmal je Seitenaufruf) und
   `QrScanner.scanImage(source, { qrEngine, returnDetailedScanResult: true })` mit eigener
   `requestVideoFrameCallback`-Schleife.
2. **Natives `BarcodeDetector` ist hier nicht end-to-end testbar.** In Playwright-Chromium auf Windows
   ist es `undefined` – headless **und** headful. Playwright prüft deshalb immer nur den Worker-Pfad;
   die native Verzweigung sichert ein Unit-Test mit Attrappe (`chooseScanBackend`). Die Spec-Forderung
   „Fallback auch bei leerem `getSupportedFormats()` oder `detect()`-Fehler" bleibt und wird von
   **unserem** Adapter erfüllt – die Bibliothek fängt ein erst zur Laufzeit werfendes `detect()` nicht ab.
3. **Eigener Payload-Deckel auf dem QR-Pfad: `MAX_QR_PAYLOAD_CHARS = 1100`.** Die Codec-Grenze von
   4096 Zeichen passt bei ECC M in **keinen** QR-Code. Längere Payloads werden nicht gerendert: Hinweis
   „Code zu groß für QR – Text-Pfad benutzen." und Zeitleisten-Eintrag `qr:error` = `too-large`. Für den
   Text-Pfad bleibt 4096 unverändert.
4. **Kein Scan-Bereich.** Die Vorgabe der Bibliothek (zentriertes Quadrat von ⅔ · min(Breite, Höhe),
   heruntergerechnet auf 400×400) verfehlte den 1100-Zeichen-Code (125 Module) reproduzierbar, während
   `scanImage` **ohne** `scanRegion` ihn traf.
5. **`scanImage` nimmt kein `ImageData`** (`Unsupported image type.`). Die Spec-Zusage „akzeptiert auch
   `ImageData`" erfüllt unser Adapter, indem er es zuerst per `putImageData` auf ein Canvas zeichnet
   (gemessen 9–12 ms, gleiches Ergebnis).
6. **Sperrbildschirm-Test ist Messung + frisches Angebot.** „Neu verbinden" belebt nichts wieder: eine
   geschlossene `RTCPeerConnection` und eine Spur mit `readyState === 'ended'` sind endgültig. Der Host
   legt auf **demselben Platz** ein neues Angebot an, der Client scannt erneut. Die vorübergehende
   Unterbrechung am Sperrbildschirm ist `mute`/`unmute`, nicht `ended` – beides wird aufgezeichnet.
7. **Wake Lock hat zwei bekannte Löcher** (siehe unten). Headless Chromium lehnt mit `NotAllowedError`
   ab, headful erteilt ihn – E2E prüft deshalb nur, dass der Fehlschlag geschluckt wird.
8. **Eigene Playwright-Projekte für die Fake-Kamera.** `--use-file-for-fake-video-capture` gilt je
   **Browser-Start**, und `test.use({ launchOptions })` **ersetzt** die Projekt-Argumente komplett (die
   vier bestehenden Flags fielen weg). Die Fake-Kamera-Projekte tragen deshalb die volle Liste; das
   Projekt `chromium` schließt beide Specs per `testIgnore` aus.
9. **`facingMode: { ideal: 'environment' }`** statt `exact` – `exact` scheitert ohne Rückkamera mit
   `OverconstrainedError`.
10. **Kein QR-Handshake-E2E mit Fake-Kamera** (so schon in der Spec, hier der Grund): die Datei liefert
    je Browser-Start genau **einen** Code, ein Handshake bräuchte zwei. Der Handshake-E2E bleibt auf dem
    Text-Pfad.
11. **Pass-Kriterium als reine Funktion** `qrPassCriterion` in `src/net/candidates.ts` statt als
    UI-Logik; der Chip „QR-tauglich ✓" zeigt nur ihr Ergebnis.
12. **`cell.path` bleibt `'qr'`**, auch wenn für einen Schritt auf Kopieren/Einfügen ausgewichen wurde –
    das hält die Zellen-Matrix vergleichbar. Der Ausweg steht als `qr:fallback-text` in der Zeitleiste.
13. **Der „`qrcode`-Lib-Audit" der Spec ist erledigt** (siehe oben) – es gab deshalb keinen eigenen
    Audit-Schritt, das Ergebnis steht hier.
14. **`renderQr` ist synchron** (eigene Zeichnung aus `QRCode.create(...).modules`) statt
    `QRCode.toCanvas`: nur so lässt sich die Canvas-Breite als ganzzahliges Vielfaches der Modulzahl
    wählen (sonst verwischen halbe Module beim Hochskalieren), und die Unit-Tests kommen ohne Promise aus.

### Abweichungen während der Umsetzung (aus den Task-Reviews)
Die Reviews der Tasks 1–6 haben den Plantext an diesen Stellen überholt. **Maßgeblich ist der Code.**

- **QR-Lupe (T1).** Der Schließen-Knopf ist ein normaler `btn` mit eigenem `click`-Zuhörer (auf weißem
  Grund war die Variante `secondary` unsichtbar); die Lupe scrollt im Querformat (`overflow: auto`,
  `justify-content: safe center`, Safe-Area-Polsterung). `renderQr` setzt zusätzlich `canvas.style.width/height`
  in CSS-Pixeln (Backing-Store 1:1 in Gerätepixeln); die Lupe gibt diese Maßangabe wieder frei, damit
  dort `90vmin` gewinnt.
- **Scanner (T2).** Ein `detect()`, das erst zur Laufzeit wirft, stuft die Seite **einmalig** auf den
  Worker zurück (`nativeBroken`); ein Fehlschlag der Engine wird zu `ScanError('camera-error')`;
  `stop()` bricht Frame-Anforderung **und** Lücken-Timer ab. Ein **leeres** `detect()`-Ergebnis heißt
  „kein Code im Bild" und gibt **nicht** an den Worker ab.
- **Kamera und Wake Lock (T3).** `openLobbyCamera()` hat einen Riegel: eine laufende Anforderung wird
  zurückgegeben statt eine zweite zu starten (sonst `NotReadableError`/verwaister Stream); `restartCamera`
  wartet darauf. Der Wake Lock wird neu angefordert, wenn der Browser ihn **bei sichtbarer Seite** entzieht
  (Energiesparmodus) – begrenzt auf `MAX_REACQUIRES = 5`; ein Wechsel auf „sichtbar" setzt Zähler und
  `denied`-Riegel zurück. „Kamera neu starten" erscheint erst, wenn die Kamera je lief, und bleibt nach
  einem gescheiterten Neustart stehen.
- **F9-Regel (T3/T4, Endstand).** Lauf-Zeitleiste und Seiten-Puffer werden **getrennt** nach ihrem
  jeweils **letzten** Kamera-Eintrag beurteilt; F9 gilt, wenn einer von beiden auf `camera-error` endet.
  Folge: eine reparierte Kamera löscht F9 für spätere Läufe, ein von der Seite gemeldeter Spurverlust
  ergibt weiterhin F9.
- **QR-Ablauf (T4).** Die Scans starten automatisch **erst**, wenn `openLobbyCamera()` mit laufendem
  Stream aufgelöst hat, der Nutzer den Scan nicht verlassen hat (`userLeftScan`) und der Platz nicht
  freigegeben ist; „Erneut scannen" bleibt immer von Hand verfügbar. Am Host scannt **höchstens ein**
  Platz (`createScanCoordinator`): ein neu scannender Platz überholt die anderen, die `S.lab.qr.overtaken`
  zeigen. Ein abgelehntes `acceptOffer`/`acceptAnswer` gibt „Erneut scannen" wieder frei (keine Sackgasse).
  Neu ist der Knopf **„Auf Text-Pfad wechseln"** (`qr-to-text`): er bricht den Scan ab, schreibt genau ein
  `qr:fallback-text` je Austausch und lässt „Erneut scannen" stehen. Ohne Kamera erscheint die Zeile
  `S.lab.qr.noCamera`. Nach „Neu verbinden" setzen beide Seiten `userLeftScan`/`fellBackToText` zurück,
  der Client verwirft seinen veralteten Antwort-Code und scannt erneut, der Host zeigt sofort ein frisches
  Angebot. `QrExchange.clear()` (räumt beim Neuverbinden den veralteten Antwort-Code weg, schreibt `qr:backend` neu
  und setzt die Zähler `offerChars`/`answerChars`/`attempts`/`decodeLatencyMs` je Austausch zurück) und
  `liveExchangeCount` (Test-Haken) sind Erweiterungen des Vertrags.
- **Fremde QR-Codes (T4, D7 nachgeschärft).** Ein Code, der kein `MB1.`-Payload ist, wird **übersprungen**
  und als `qr:skipped` (Detail `not-a-payload`) notiert – **nie** als `qr:error`, also nie als F9. Sonst
  trüge jeder Lauf in einem Raum mit Werbeplakat ein F9, das über das Labor nichts aussagt. Bewiesen vom
  Fake-Kamera-Smoke mit einem fremden Code.
- **Sperrtest (T5).** `pingAfter` ist `null`, wenn der Transport beim Entsperren nicht offen war. Der
  Spur-Beobachter wird je scharfgestelltem Lauf neu angemeldet (sonst bliebe `trackAfter` nach einem
  Kamera-Neustart für immer `ended`); ein scharfgestellter Lauf lässt sich vor dem Dunkelwerden noch
  ändern; `lock:start` wird genau einmal je gemessenem Lauf geschrieben; „Ping-Test starten" ist während
  der Sperrtest-Ping-Serie gesperrt. Der **Client** hat keinen Ping-Knopf und speichert deshalb nach
  jedem gemessenen Lauf von selbst einen Report (`autoReportLock`, volle Serie ≈ 13 s); solange bleiben
  die Dauer-Knöpfe gesperrt, damit kein zweiter Durchgang in die Serie fällt. Ein „Neu verbinden“ während
  der Messung markiert den entstehenden Lauf als `reconnected` (`pendingReconnect`).
- **Ereignisse (T3–T5).** Genau **ein** Seiten-Puffer (`src/lab/labEvents.ts`, 200 Einträge plus Zähler
  `dropped`) wird in jede Lauf-Zeitleiste kopiert. `createRelayTimeline` gibt jeder **neuen** Zeitleiste
  die volle noch ungesehene Vorgeschichte (ein Wiederholungsversuch behält sie, D7); `reset()` beginnt bei
  „Neu verbinden" einen frischen Puffer, damit der neue Lauf nicht die `qr:error`s des toten erbt.
- **Fake-Kamera (T6).** Zwei Smokes, zwei Projekte (siehe „E2E-Tor in M2").

### Verfügbarkeit von `BarcodeDetector` (Stand der Recherche)

| Browser | Verfügbar? |
|---|---|
| Chrome Desktop 88+ | nur auf ChromeOS und macOS – **nicht** Windows, **nicht** Linux |
| Edge 83+ / Opera 69+ | „macOS only" (vor Chrome 113 auf macOS Ventura still fehlschlagend) |
| **Chrome Android 83+** | ja (WebView und Samsung Internet spiegeln das) |
| Firefox | nein |
| Safari 17+ | nur hinter dem Feature-Flag „Shape Detection API"; auf iOS zusätzlich defekt (WebKit-Bug 281848) |

**Praktisch:** Android-Chrome nativ, iOS-Safari nie, Windows-PC nie. Gemessen ist es in
Playwright-Chromium auf Windows `undefined` (headless und headful) – die erste echte Messung des nativen
Pfads kommt aus Sitzung A vom Android-Gerät.

Unser Report-Feld `qr.backend` ist eine Aussage über **unseren** Pfad: `'native'` steht dort nur, wenn
unser eigener `BarcodeDetector`-Pfad dekodiert hat. Welche Engine `qr-scanner` intern wählt, ist seine
Sache und bleibt bei uns `'worker'`.

### QR-Kapazität bei ECC M und der Payload-Deckel
Gemessen mit `qrcode` 1.5.4 an **base64url**-Payloads der Form `MB1.<d|p>.…`. Wichtig: `qrcode`
kodiert base64url als **ein Byte-Segment** (8 Bit je Zeichen). Die ältere Tabelle im Faktenblatt
wurde mit Groß-/Ziffernfolgen gemessen, die in den **Alphanumerik**-Modus fallen (5,5 Bit) – sie
unterschätzt jede Größe um rund vier Versionen.

| Zeichen | Version | Module | mit Ruhezone | CSS px/Modul @ 390 px |
|---|---|---|---|---|
| 374 (kleinster M1-Payload) | 15 | 77 | 85 | 4,59 |
| 704 (größter M1-Payload) | 21 | 101 | 109 | 3,58 |
| 800 (Spec-Zielwert) | 23 | 109 | 117 | 3,33 |
| 900 | 24 | 113 | 121 | 3,22 |
| 1000 | 26 | 121 | 129 | 3,02 |
| **1100 (Scan-Reserve der Spec)** | **27** | **125** | **133** | **2,93** |

Obergrenzen bei ECC M: reiner Byte-Modus 2331 Byte, mit Auto-Segmentierung auf base64url
3371 Zeichen. Die Codec-Grenze 4096 passt damit **nicht** mehr in einen QR-Code – daher der eigene
Deckel 1100. Bei 1100 Zeichen liegt die Anzeige auf einem 390-CSS-px-Telefon bei 2,93 px je Modul,
also knapp unter dem 3-px-Ziel; `renderQr` rechnet deshalb mit ganzzahligen **Geräte**pixeln
(Untergrenze 2) und die Vollbild-Lupe („Tippen zum Vergrößern", ≥ 90 % der kürzeren Bildschirmkante)
ist der vorgesehene Weg zum Scannen großer Codes. Ob 125 Module am Gerät zuverlässig scannen,
entscheidet Sitzung A – der Rückfallweg ist ein kleinerer Deckel (~700 Zeichen = 101 Module), nicht ein
Absenken von `minModulePx`. (Der Deckel zählt UTF-16-Einheiten; für `MB1.`-Payloads, die nur aus
ASCII bestehen, ist das gleichbedeutend mit Zeichen.)

Renderzeiten (Headless-Chromium, Canvas): 2–7 ms je Code. Dekodier-Latenz mit wiederverwendeter
Worker-Engine: 13–20 ms je Code für 57 bis 125 Module, erster Aufruf je Seitenaufruf 36 ms
(Worker-Start).

### Wake Lock – zwei bekannte Löcher
- **Installierte iOS-Web-Apps unter iOS 18.4:** wirkungslos (WebKit-Bug 254545). Vollständig erst ab
  iOS 18.4. Genau das Szenario dieses Projekts – der Zustand gehört deshalb in die Zeitleiste und ins
  Runbook.
- **Headless Chromium** lehnt `navigator.wakeLock.request('screen')` mit `NotAllowedError` ab; headful
  erteilt ihn (`type: 'screen'`). Ein E2E darf deshalb nur prüfen, dass der Fehlschlag geschluckt wird
  und `wakelock:denied` in der Zeitleiste steht – nie, dass die Sperre gehalten wird.
- Die Sperre wird automatisch freigegeben, sobald das Dokument unsichtbar wird; wieder angefordert wird
  sie bei `visibilitychange` → sichtbar sowie nach einem Entzug bei sichtbarer Seite (höchstens fünfmal
  je Seitenaufruf). `src/platform/wakeLock.ts` meldet jeden Zustand über einen Rückruf, weil
  `src/platform` die Schicht `src/lab` nicht kennen darf.
- **Kein Weg zurück nach `pagehide`** (Zurück-Taste, iOS-Seitencache): die Sperre wird dann nicht erneut
  angefordert. Am Gerät hilft nur ein Neuladen; im Runbook steht der Hinweis.
- Ebenso hat der **Lobby-Kamera-Stream keinen ausdrücklichen Stopp bei `pagehide`**: `src/lab/camera.ts`
  beendet Spuren nur in `restartCamera`. Das ist Absicht – ein `stop()` beim Wegschalten würde genau die
  Unterbrechung erzeugen, die der Sperrtest messen soll; ein verworfenes Dokument gibt der Browser
  ohnehin frei. Sichtbare Folge auf dem Handy: die Kamera-Anzeige kann nach dem Wegschalten noch kurz
  stehen bleiben.

### Fake-Kamera in Playwright (Fakten und Fallen)
- `--use-file-for-fake-video-capture=<absoluter Pfad>` funktioniert mit `.y4m` und ersetzt das
  synthetische Bild. Chromium **wiederholt die Datei in Schleife** – ein einziges Bild genügt
  (640×480 = 460 850 B, 1280×720 = 1 382 451 B). Die Dateien entstehen zur Testlaufzeit in
  `test-results/fakecam/` und werden **nie** committet.
- **Reihenfolge-Falle:** Playwright löscht `test-results/` **vor** `globalSetup`
  (`createRemoveOutputDirsTask` läuft davor). Die Dateien dürfen deshalb nur aus `globalSetup` heraus
  geschrieben werden – aus `playwright.config.ts` heraus wären sie beim ersten Browser-Start wieder weg.
- **Maßfalle:** verlangt man eine Auflösung, die nicht zum Seitenverhältnis der Datei passt, beschneidet
  und **dreht** Chromium (aus 960×960 wurde bei `{ width: 640, height: 480 }` ein 480×640-Video, in dem
  der Code nicht mehr dekodierbar war). Deshalb: **Dateimaße = angeforderte Maße**. Der Smoke mit
  `{ video: true }` bekommt 640×480; der Smoke, der die echte Lobby-Kamera fährt
  (`width/height: { ideal: 1280/720 }`), bekommt eine 1280×720-Datei.
- Gespiegelt wird nichts – die Bilder kommen unverändert an.
- **Datenschutz-Falle:** mit diesem Flag ist `track.label` der **vollständige Dateipfad samt
  Benutzername**. Er wird nie geloggt, annotiert oder in einen Report geschrieben.

### Kamera-zuerst und Sperrbildschirm
- Auf dem QR-Pfad öffnen **beide** Seiten beim Eintritt in die Lobby **einen** Stream
  (`facingMode: { ideal: 'environment' }`, 1280×720 als Wunsch) und halten ihn für die Sitzung offen.
  Der Selbsttest aus M1 bleibt unberührt (`openTemporaryCamera`).
- `track.readyState` kennt nur `'live'` und `'ended'`; **`'ended'` ist endgültig**. Die vorübergehende
  Unterbrechung am Sperrbildschirm ist `track.muted` mit den Ereignissen `mute`/`unmute`. Chrome für
  Android feuert beide beim Aus- und Wiedereinschalten des Bildschirms – der Stream bleibt dieselbe Spur.
  „Neu verbinden" ist deshalb nur bei `'ended'` bzw. nicht mehr offenem Transport nötig.
- Ein offener `getUserMedia`-Stream und eine gleichzeitig sammelnde `RTCPeerConnection` stören sich nicht.

### Report-Felder `pairing`, `qr` und `lockTest`
- `pairing`: `offerShownAt`, `offerScannedMs`, `answerShownAt`, `answerScannedMs`, `connectedMs` (alle in
  ms **relativ zum ersten gezeigten QR-Code**) und `projectedLobbyFullMs`. Die Hochrechnung „Zeit bis
  Lobby voll" rechnet mit 3 Clients × 2 Scans = 6 Scans: `6 × Median der gemessenen Scan-Dauern +
  3 × Rest`, wobei der Rest alles ist, was nicht Scannen war (Sammeln, ICE, Tippen). `pairing` ist
  `null`, wenn in diesem Lauf nie ein Code gezeigt wurde.
- `qr`: `backend`, `offerChars`, `answerChars`, `decodeLatencyMs`, `attempts`. **`decodeLatencyMs` ist
  nicht die Paarungsdauer**, sondern die Dauer des **letzten** `scanVideo`-Aufrufs (also im Wesentlichen
  die Dekodierzeit des Treffers); `attempts` zählt dagegen alle Einzelbilder seit Scan-Beginn. Ein
  Report, der **während** eines laufenden Scans entsteht, zeigt `attempts` = 0.
- `lockTest`: `runs[]` mit `plannedSeconds` (10 | 30 | 60), `hiddenMs`, `transportBefore`/`transportAfter`,
  `trackBefore`/`trackAfter`, `pingAfter` und `reconnected`. In M1 war das Feld ein Platzhalter (`null`).
  **`pingAfter` ist ein Paar** `{ state, events }` – je Kanal eine `PingStats` oder `null` (D9 verlangt
  „20 Pings je Kanal"; eine einzelne Statistik könnte nur einen der beiden tragen). Dieselbe Form hat
  `LabReport['ping']` schon. `pingAfter` ist **ganz** `null`, wenn der Transport beim Entsperren nicht
  offen war. Dazu der neue Export `measureLockPings(transport, now)` in `labSession.ts` (der
  Message-Router liegt dort modul-privat je Transport) und `RunBox.setReconnect(handler)` in
  `connectPanels.ts`.
- **Alte Reports bleiben gültig.** `looksLikeReport` nimmt einen gespeicherten M1-Report **ohne** diese
  drei Schlüssel an – ein fehlender Schlüssel zählt wie `null`. Sonst verlöre beim Update genau das Gerät
  seinen Verlauf, dessen Reports M2 sammeln soll. Preis: die Formprüfung kann nicht mehr unterscheiden,
  ob ein Feld fehlt, weil der Report alt ist, oder weil ein Schreiber es vergessen hat – dagegen hilft
  nur der Typ (`LabReport` verlangt alle drei).
- Der Zustand des Wake Lock hat **kein** eigenes Report-Feld; er steht als Zeitleisten-Eintrag
  `wakelock:<acquired|released|denied|unsupported>` im Report und wird von dort abgelesen.

### Zeitleisten-Einträge in M2
Neu neben den M1-Einträgen (`transport:<state>`, `camera-error`, `camera:running`,
`permissions:handshake`):

| Eintrag | Detail |
|---|---|
| `qr:backend` | `native` \| `worker` |
| `qr:shown` | `<offer\|answer> <Zeichen> Zeichen, <Module> Module, <px> px/Modul` |
| `qr:decoded` | `<backend> <latencyMs>ms <attempts>` |
| `qr:error` | `too-large` \| `scan-timeout` \| `decode-failed` \| `camera-error` |
| `qr:skipped` | `not-a-payload` (fremder Code übersprungen – **kein** F9) |
| `qr:fallback-text` | `offer` \| `answer` |
| `camera:track:<state>` | `live` \| `muted` \| `unmuted` \| `ended` |
| `wakelock:<state>` | `acquired` \| `released` \| `denied` \| `unsupported` |
| `lock:start` / `lock:hidden` / `lock:visible` / `lock:reconnect` | `<Sekunden>s` / – / `<hiddenMs>ms` / `slot <n>` |

**Kein Detail trägt je den gescannten Text, eine Adresse oder `track.label`.**
`lock:reconnect` landet in der Zeitleiste der **alten** Verbindung, die in diesem Moment geschlossen wird –
in einem gespeicherten Report taucht der Eintrag deshalb praktisch nie auf. Ob neu verbunden wurde, steht
statt dessen in `lockTest.runs[].reconnected`.

### F9 ist erweitert
F9 heißt weiterhin „Kamera-/QR-Problem"; ab M2 speist `classifyFailures` den Code aus **zwei** Feldern:
`cameraError || qrError`, wobei `qrError` aus den Zeitleisten-Einträgen `qr:error` kommt. Bewusst ein
eigenes Feld statt einer Umdeutung von `cameraError` – so fällt ein vergessener Aufrufer im Typecheck
auf. `qr:skipped` zählt **nicht** mit. Der Titel bleibt „Kamera nicht verfügbar"; der Hinweistext nennt
zusätzlich den QR-Fall. Die Tabelle oben („Fehlercodes F1–F9") ist entsprechend nachgeführt; Reihenfolge
und Bedeutung der übrigen Codes sind unverändert.

### Budget nach M2
Lab-Bundle: **61.5 kB** gzip (Budget 150 kB, `npm run check-dist`) – gegenüber 29.3 kB nach M1. Davon
entfällt der Worker-Chunk des Scanners allein auf 10,2 kB gzip (43 951 B roh); der Rest sind die beiden
Bibliotheken und die neuen Lab-Module. Das Spiel-Bundle wächst von 9,2 auf **10.1 kB** gzip, weil
`src/ui/strings.ts` geteilt ist (Budget 900 kB). Precache: 16 Dateien, 253,2 kB. `check-dist` prüft seit
M2 zusätzlich, dass der Worker-Chunk des Scanners (1) im Build liegt, (2) zum JS-Graph von `lab.html`
gehört, (3) **nicht** zum Graph von `index.html` und (4) im Precache-Manifest von `sw.js` steht.

### Schichtregel für den Test-Haken (neu in M2)
`tests/e2e/lab-rtc.spec.ts` importiert seit M1 `type { LabHook }`. TypeScript prüft dabei den GANZEN
Typgraphen – erreicht er `src/platform/buildInfo.ts`, fehlt dem Node-Projekt die Vite-Konstante
`__BUILD_ID__` und `npm run typecheck` bricht ab; erreicht er eine `.css`-Datei, bricht er mit TS2882.
Reparatur ist **nie** ein Eintrag in `tsconfig.node.json`, sondern die Modulstruktur:
- neues Leaf-Modul `src/lab/labTypes.ts` **ohne jeden Import** für `ScanBackend`, `TrackState`, `QrFacts`;
  `report.ts` reicht sie per `export type … from './labTypes'` durch;
- `qrRender.ts`, `scannerAdapter.ts`, `camera.ts`, `pairing.ts`, `qrPanels.ts` importieren weder
  `report.ts` noch `labSession.ts` noch `net/environment.ts`;
- CSS wird ausschließlich aus `src/lab/labMain.ts` importiert (`selfTestUi.ts` ist die dokumentierte
  M1-Ausnahme und liegt außerhalb des Haken-Graphen);
- `tests/node/labHook-graph.test.ts` läuft den statischen Importgraphen ab (inklusive dynamischer
  `import()`) und bewacht beides, mit `labMain.ts` als Gegenprobe.

### Abweichung vom Interface Contract: `pingAfter` ist ein Paar
Der Vertrag sah `pingAfter: PingStats | null` vor, D9 verlangt „20 Pings **je Kanal**". Beides zusammen
geht nicht – umgesetzt ist `LockPings = { state: PingStats | null; events: PingStats | null }`, also
dieselbe Form, die `LabReport['ping']` schon hat. Dazu der neue Export
`measureLockPings(transport, now)` in `labSession.ts` (der Message-Router liegt dort modul-privat je
Transport) und `RunBox.setReconnect(handler)` in `connectPanels.ts`.

### Seiten-Ereignisse vor der Zeitleiste
Wake Lock und Kamera-Spuren gehören zum **Seitenaufruf**, nicht zu einer Verbindung; der Client scannt
das Angebot, **bevor** `acceptOffer` seine Zeitleiste anlegt. Beides löst EIN Modul, `src/lab/labEvents.ts`:
`recordLabEvent`/`flushLabEvents` (Seiten-Puffer, den `finishRun` in jede Zeitleiste kopiert) und
`createRelayTimeline` (puffert, bis die echte Zeitleiste existiert, und trägt dann nach). Dokumentierter
Preis: die nachgetragenen Einträge tragen die Uhr des **Laufs**, nicht die des Ereignisses – gemessen
wird die Paarung ohnehin über `PairingMarks`.

### `startCamera` entfällt
Auf dem QR-Pfad öffnet die Kamera-Karte selbst den Lobby-Stream (Rückkamera). Bliebe das nackte
`getUserMedia({ video: true })` aus M1 als Knopf, öffnete es die **Front**kamera und machte
`openLobbyCamera()` danach zum No-op – der Scan liefe auf die falsche Kamera. Die Funktion wurde
deshalb entfernt; `openTemporaryCamera` (Selbsttest) bleibt unverändert. Aus demselben Grund gibt es
**keinen** Knopf „Scan starten": beide Scans starten von selbst, steuerbar über „Erneut scannen" und
„Auf Text-Pfad wechseln".

### E2E-Tor in M2
- `tests/e2e/lab-qr-roundtrip.spec.ts` (Größen-Sweep Payload → QR → Scanner) gehört **zum Tor** – kein
  `@local`.
- **Drei** Playwright-Projekte: `chromium` (alles außer den beiden Fake-Kamera-Specs, per `testIgnore`),
  `chromium-fakecam` (`tests/e2e/lab-fakecam.spec.ts`, 640×480, 1100-Zeichen-Payload) und
  `chromium-fakecam-foreign` (`tests/e2e/lab-fakecam-foreign.spec.ts`, 1280×720 wie die Lobby-Kamera, ein
  **fremder** Code). Der zweite beweist die schreibende Seite von `qr:skipped`. Die `.y4m`-Dateien
  entstehen in `tests/e2e/globalSetup.ts` einmal je Testlauf; `playwright.config.ts` selbst schreibt
  nichts.
- Der Fake-Kamera-Smoke ist nach drei stabilen lokalen Läufen: im Tor (kein Tag, drei stabile Läufe) –
  beide Specs. **Restrisiko:** der fremde Smoke baut eine echte `RTCPeerConnection` auf (nur das
  Angebot). Der realistische Fehlschlag ist deshalb nicht die Verbindung, sondern die **Größe**: ein
  Runner mit vielen Netzwerkschnittstellen sammelt viele Kandidaten, und ab 1100 Zeichen Payload lehnt
  `renderQr` mit `too-large` ab. Gemessen sind 704 Zeichen als größter echter Payload – rund 56 %
  Luft, aber keine Garantie. Fällt einer der beiden Smokes auf dem Linux-CI-Runner um, bekommt er dort
  `{ tag: '@local' }` und der Grund kommt hierher – der Test wird nicht abgeschwächt (C7).

## M3 – Core I (2026-09-25)

Der Spielkern entstand **headless**: keine Seite lädt `src/core/**`, `index.html` bleibt auf dem Stand M2.
Nach dem letzten M3-Commit gemessen (`npm run build:pages` + `npm run check-dist`): **Spiel-JS 10.1 kB
gzip** – genau der Wert vor M3 (Lab-JS 61.5 kB unverändert). Der Kern ist in M3 ausschließlich über Tests
erreichbar (`npx vitest run tests/unit/core`: 22 Dateien, 517 Tests; `npm test` insgesamt 65 Dateien +
1 übersprungener, 1335 Tests + 1 übersprungener – übersprungen ist genau der Messlauf `core-bench` ohne
`MB_BENCH`); angeschlossen wird der Kern erst in M5. Die Zahlen sind der Stand **nach** der
Feinschliff-Runde (ESLint-Verbot `for…in`, Pfad-Wächter, U7); T7 maß 515 bzw. 1330.

### Zahlenmodell: float64 mit eigenem Trig, kein Festkomma (D1)
`+ − × ÷ %`, Vergleiche und `Math.sqrt/floor/ceil/round/trunc/abs/min/max/sign/imul/fround/clz32` schreibt
ECMA-262 **exakt** vor – `Math.sqrt` ist dort als „the square root of n" definiert und korrekt gerundet,
nicht als Näherung. `Math.sin/cos/atan2/pow` und `**` dagegen sind ausdrücklich
„implementation-approximated" – für `Math.pow(10, 208)` liefert Firefox belegbar einen anderen Wert als
Chrome. Deshalb: `number` (float64) und eigenes Trig aus genau den exakten
Operationen. Festkomma wurde verworfen (eigene Multiplikation mit Sättigung, jede Balance-Zahl würde zum
Skalierungsproblem); „Integer-Ticks" der Spec meint den Zeitschritt, nicht die Ortskoordinaten.

Gemessen (Node 24 / V8, Windows 11 x64, je 20 Mio. Aufrufe nach dem Aufwärmen):

| Variante | max. Fehler | Kosten |
|---|---|---|
| `Math.sin` (Referenz) | – | 6,72 ns |
| Tabelle 4096 + lineare Interpolation | 2,94e-7 | 12,24 ns |
| **Polynom Grad 13, Horner, Reduktion `k = Math.round(x/π)`** | **6,63e-10** | **7,73 ns** |
| `atan2`: Oktanten-Reduktion + ungerades Polynom Grad 17 | **≤ 1,36e-8 rad zugesichert, 9,73e-9 gemessen** | 7,59 ns (`Math.atan2`: 8,95 ns) |

Das Polynom ist damit gleichzeitig **~440× genauer und ~1,6× schneller** als die Tabelle – die Tabelle
kostet einen `Float64Array`-Zugriff mit Bereichsprüfung, das Polynom ist reine Registerarbeit. Die
Schranke gilt auch bei ±100 Umdrehungen. Die Tests liegen außerhalb von `src/core` und vergleichen gegen
`Math.sin/cos/atan2` mit der gemessenen Schranke ×2 als Toleranz (1,4e-9 für `sin`/`cos`, 2,0e-8 für
`atan2`). **Keine Tabelle, kein Nachschlagewerk.** `sin` ist auf `[-1, 1]` geklemmt: das Polynom liegt bei
`PI/2` genau um die Schranke **über** 1, und ohne Klemme bekäme ein Aufrufer, der daraus eine Wurzel zieht,
`NaN`. Damit sind `sin(0) = 0` und `cos(0) = 1` **exakt**; `cos(HALF_PI)` ist dagegen `-0` (folgenlos, weil
der Hasher `-0` auf `+0` normalisiert – aber kein `toBe(0)` darauf ansetzen). `normalizeAngle` braucht nach
der Subtraktion zwei Nachkorrekturen: ohne sie fielen an den Nahtstellen (Vielfache von `TAU` bis ±200 000)
121 149 Werte aus `[-PI, PI)` heraus – der Nahttest ist deshalb Teil des Vertrags (T1-Review).

**Die ESLint-Linie ist in M3 enger geworden** (`eslint.config.js`, nur `src/core/**`): zusätzlich zu den 23
`Math.*`-Namen, `Date.now`, `performance.now`, `new Date()`, `**`/`**=` und den Browser-Globals sind jetzt
`Object.keys/values/entries/assign/fromEntries`, `JSON.parse/stringify` und **`for…in`** gesperrt. Grund:
`hashState` und `cloneState` laufen über eine **handgeschriebene** Feldfolge – käme die Reihenfolge aus
`Object.keys`, änderte eine Feldumbenennung still den Golden-Hash, ohne dass der Test die Ursache zeigt;
`for…in` ist derselbe Umweg ohne Aufruf (`ForInStatement` in `CORE_SYNTAX_BANS`, nachgezogen in der
Feinschliff-Runde nach dem Abschluss-Review); `JSON.*` im Kern unterliefe die Injektionsregel (D12).
Verschärfen ist erlaubt, Lockern nie.
`tests/node/eslint-boundaries.test.ts` prüft alle drei Verbote und ausdrücklich, dass
`Math.sqrt/imul/fround/clz32`, `DataView`, Typed Arrays und `for…of` durchkommen. `structuredClone` und
`TextEncoder` scheitern schon am Typecheck (`tsconfig.core.json`: lib `ES2022`, `types: []`) – der ist hier
**schärfer** als ESLint; `tests/node/es-library-guard.test.ts` sperrt `structuredClone` zusätzlich per
Textscan.

**Was ESLint prinzipbedingt NICHT sieht** (gemessen mit der ESLint-API gegen eine Sondendatei, Abschluss-
Review determinism m-4) und deshalb **Review-Regel** bleibt: der Alias-Umweg (`const M = Math; M.sin(1)`),
`Reflect.ownKeys`, `Object.getOwnPropertyNames`, `Date.parse`, `Array#sort` ohne ID-Gleichstand und die
Iteration über `Map`/`Set`. `src/core` hält sie heute sämtlich ein (nachgeprüft: kein `sort`, kein
`Map`/`Set`, kein `Reflect`/`Proxy`/`Symbol`/`Intl`/`BigInt`, kein `toFixed`).

### PRNG: sfc32, vier uint32 im Zustand (D2)
`RngState { a, b, c, d }` liegt **im** `WorldState`, damit `cloneState` und `hashState` ihn automatisch
mitnehmen; `nextU32/nextFloat/nextInt/nextRange` mutieren ihn in place (ein zurückgegebener neuer Zustand
müsste an jeder Aufrufstelle zurückgeschrieben werden – genau das vergisst man einmal). Gemessen: die
JS-Fassung mit `|0`/`>>>` ist **bitgleich** mit einer BigInt-Referenz, die sfc32 exakt in uint32 rechnet
(3 Saaten × 100 000 Werte, kein Unterschied); `nextU32` kostet 1,49 ns. Eingefrorener Testvektor
`sfc32(1, 2, 3, 4)` nach 12 Verwurfrunden (PractRand-Saatregel): `417285410, 1196253302, 123583739,
800524041, 903873393, 3641854082`. `nextInt` verwirft statt Modulo (Sicherheitszähler ≤ 64): die
Verzerrung wäre bei n = 3 nur 2,33e-8 %, aber die faire Fassung kostet nichts und macht die Eigenschaft
beweisbar. Bei `n > 2^32` **wirft** `nextInt` (T1-Review): ohne den Wurf lief der Sicherheitszähler still
aus – 65 verbrauchte Rohwerte und ein Ergebnis nur aus der unteren Bereichshälfte. Die Saat kommt über
FNV-1a-32 aus Zahl oder Text.

### Zustandshash: FNV-1a 32 über einen kanonischen Bytestrom (D3)
Startwert `0x811c9dc5`, Schritt `h = Math.imul(h ^ byte, 16777619) >>> 0`; Testvektoren reproduziert
(`""` = 0x811c9dc5, `"a"` = 0xe40c292c, `"foobar"` = 0xbf9cf968). **Nicht** FNV-1a-64: über BigInt kostet
er für einen `WorldState` mit 2188 Feldern **294 µs** gegen **15,7 µs** – 18,7× teurer, und einem
Golden-Test bringt die doppelte Breite nichts.

Der Strom ist kanonisch, weil drei Dinge sonst plattformabhängig wären:
- **Reihenfolge der Bytes:** Zahlen gehen ausschließlich über `DataView.setFloat64(…, true)` hinein. Die
  Typed-Array-Sicht folgt der **Plattform** (ECMA-262 9.6 nennt `[[LittleEndian]]` „implementation-defined"),
  `DataView` folgt dem **Flag**. Gemessen: `new Uint8Array(new Float64Array([1.5]).buffer)` ergibt hier
  `00 … f8 3f`, big-endian wäre `3f f8 …`.
- **`NaN`/`±Infinity`:** ECMA-262 25.1.3.17 erlaubt für `NaN` „any implementation chosen … encoding" – der
  Hasher **wirft** deshalb `NaNError` mit dem Feldpfad, statt irgendwelche Bytes zu schlucken. Das ist
  zugleich der NaN-Wächter der Spec.
- **`-0`:** hat andere Bytes als `+0` (`… 00 80` gegen `… 00 00`) und wird vor dem Schreiben auf `+0`
  normalisiert.

Strings gehen als Längenpräfix + UTF-16-Code-Einheiten LE hinein (`TextEncoder` fehlt in der Core-lib),
Arrays immer mit `hashLen` davor, Aufzählungen als Byte eines festen Index – nie als Text. Die beiden
Index-Listen `PHASES = ['day','night']` und
`CAT_STATES = ['sleeping','patrol','alert','chase','lurk','search','return']` (in `src/core/sim/hash.ts`)
werden deshalb **nur hinten erweitert, nie umsortiert**: eine Umbenennung des Textes kostet keinen neuen
Golden-Wert, eine Umsortierung ändert **jeden** – dann braucht es eine Re-Baseline mit Begründung.
Der Vertauschungs-Schutz steckt im Typ: `hashEnum` nimmt `value: NoInfer<T>`, sonst verbreitert der
Übersetzer `T` auf `CatState | Phase` und eine vertauschte Liste übersetzt fehlerfrei (gemessen, T4-Review).
Aus demselben Grund tragen leere Lärmproben `tick = -1` **und** `slot = -1` (`0` wäre ein gültiger Slot);
beide Zahlen kleben am Golden-Hash. Array-Löcher werden im **Hash-Lauf** in jedem Blatt gleich behandelt
(übersprungen), damit eine dünn besetzte Liste nicht je nach Blatt anders in den Strom läuft.
**Notiz zur Kodierung** (determinism m-1): ein übersprungenes Loch hinterlässt **keine Positionsspur** –
vor der Liste steht nur ihre Länge. Zwei Zustände, die sich allein in der *Position* eines Lochs
unterscheiden, hashen deshalb gleich (nachgestellt mit `skipVotes`). Praktisch unerreichbar: der Typ kennt
kein Loch, `createInitialState` legt jedes Array voll an, und `cloneState` würde an `copyPlayer(undefined)`
werfen – Klon und `hashNumbers` scheitern also **hart**, wo der Hash-Lauf überspringt. Der Fix wäre ein
Markierungsbyte je Loch (`hashU8(0xff)`); er ändert die Kodierung und käme deshalb nur mit einer echten
Re-Baseline. Gemessen:
eine 1-ULP-Änderung (`12.5` → `12.500000000000002`) und das Vertauschen zweier Felder ändern den Hash,
**die Laufordnung ist also Teil des Vertrags**. Ein **Kodierungs-Vektor-Test**
(`tests/unit/core/sim/stateHash.test.ts`) pinnt den Hash eines handgebauten Zustands für alle sieben
Katzenzustände: ändert sich dort eine Zahl, ist das eine bewusste Re-Baseline mit Grund im Commit, kein
Rauschen. `cloneState` kopiert aus demselben Grund schema-getrieben:
2,92 µs gegen 134 µs für einen `JSON`-Rundlauf (45,8×), und `structuredClone` ist ohnehin gesperrt.

### Kollider-Modell: fünf Kollider je Regal – die Beine blocken `CAT` nicht (D5)
Ein Kollider ist ein gedrehter Kasten im Grundriss mit Höhenband (`cx, cz, hx, hz, y0, y1, rot`) plus
`rc`/`rs` (= `cos`/`sin` des Winkels, **einmal beim Erzeugen** gerechnet – so kommt in keiner Abfrage zur
Laufzeit Trig vor), einer Bitmaske `blocks` (`MOUSE 1 | CAT 2 | SIGHT 4 | CAMERA 8`) und der
`occluderGroup` der Quelle. Ein Regal wird zu **vier Beinen** (`y 0…gapCm`, `blocks = MOUSE|SIGHT`) und
**einem Baldachin** über der ganzen Grundfläche (`y gapCm…topCm`, `blocks = CAT|SIGHT|CAMERA`).

Zwei R7-Konventionen, die **am Golden-Hash kleben** (T7-Review, Minor 5) – sie stehen sonst nur im
Quelltextkommentar von `generateColliders.ts`, und wer sie „vereinheitlicht", verschiebt jede Golden-Zahl:
- **Bei Wänden kommen `rc`/`rs` aus der NORMIERTEN RICHTUNG** (`dx/length`, `dz/length`), nicht aus
  `cos(rot)`/`sin(rot)`. Das ist exakt: eine achsenparallele Wand bekommt `rc = 1`, `rs = 0` ohne den
  Polynomfehler des eigenen Trig. Nur Regale und Kisten rechnen `rc`/`rs` aus dem Winkel.
- **`occluderGroup` läuft ab 1** je Quellobjekt; die 0 bleibt reserviert („keine Gruppe").

Die Beine blocken `CAT` **ausdrücklich nicht**, und das ist keine Feinheit: Bein und Baldachin überlappen
sich zwar nicht in der Höhe, treffen aber beide das Höhenband der Katze – ihre Grundflächen liegen
übereinander und drücken sie in widersprüchliche Richtungen. **Gemessen: 483 eingedrungene Ticks je
10 000; nach der Trennung 0.** Gestoppt wird die Katze vom Baldachin. Die Überlappungsregel gilt also je
**Bewegtem**, nicht je Kollider-Paar. Gemessen am **Struktur-Level des Faktenblatts** (`research.md` §1,
Prototyp-Zahlen: Maus y 0…1,9, Katze y 0…3,0, drei Regalreihen): die Maus läuft geradeaus durch alle drei
Reihen, die Katze bleibt an der Baldachinkante stehen (Kante 2,5 + Katzenradius 1,2 = z 3,70). Mit dem
**ausgelieferten** Stand lautet dieselbe Rechnung `0,6 < 2,0 < 3,0` (Maus `heightCm 6`, Mini-Level
`gapCm 20`, Katze `heightCm 30`) – die Aussage bleibt, die Zahlen sind andere. Dass die Maus unter das
Regal passt und die Katze nicht, prüft ein Test aus
**Level und Balance** zusammen (`mouse.yRange.y1 < gapCm/10 < cat.yRange.y1`); `balance.json` trägt
deshalb kein `shelfGapCm` mehr – die Spalthöhe steht am Regal.

### `moveCircle` ist durchgehend (TOI + Gleiten), nicht „bewegen + herausdrücken" (D5)
Drei Varianten, je 10 000 Ticks gegen ein Struktur-Level aus 71 Kollidern. Die Invariante lautet: nie
**tiefer als `SKIN`** in einen blockierenden Kasten geraten, nie hindurch, nie aus dem Laden.

| Variante | Ergebnis |
|---|---|
| A – bewegen + herausdrücken (3 Iterationen) | **gescheitert**: die Maus ist ab Tick 689 dauerhaft außerhalb (9311 von 10 000 Ticks), die Katze 220 Ticks in Kästen |
| B – Teilschritte (`maxStep = r`) + A | besser, aber weiter ~0,2 u Eindringen, doppelte Kosten |
| C – exakter TOI + Gleiten (≤ 3 Schritte) | **0 Verstöße** in 20 Saaten × 10 000 = 200 000 Ticks |

A scheitert **herleitbar**: sie springt auf `p + d` und drückt zur *nächsten* Fläche heraus – liegt
`p + d` jenseits der Mittelebene, zeigt die Normale auf die falsche Seite. Bedingung `|d| > hz + r`, für
Maus (r 0,4) gegen ein Regalbein (hz 0,3) also ab 0,7 u/Tick: schon der vorgesehene Sprint (0,80 u/Tick)
geht in **einem** Schritt hindurch (gemessene z-Folge `2.200 → 1.400 → 0.700 → −0.700 → −1.500`).
Zweiter Befund: Herausdrücken erzeugt Positionen, die kein Bewegungspfad je erreicht hat – so fiel die
Maus durch einen 0,05 u breiten Spalt zwischen zwei Wänden aus dem Laden. **C hat denselben Spalt in
200 000 Ticks nie gefunden**, weil sein Sweep die Wand sieht, bevor die Position entsteht. Tempo-Sweep
0,80 / 1,60 / 6,40 / **20,0** u/Tick und Wände der Halbdicke 0,05 bis 1,0 gegen Tempo bis **100** u/Tick:
jeweils 0 Verstöße. `MAX_SLIDES = 3` ist gemessen: 1 Gleitschritt hält die Invariante, klemmt aber 4992
von 10 000 Ticks fest; 2 und 3 liefern je 281, 4 bringt nichts mehr.

**Die Invariante lautet „nicht tiefer als `SKIN`", nicht „nie im Kasten"** (T3-Review): `moveCircle` legt
den Bewegten je aufgelöstem Treffer `SKIN` vor **genau eine** Fläche. Drücken beim Gleiten in eine Ecke
zwei Flächen gleichzeitig, bleibt in der jeweils anderen bis zu `SKIN` Eindringung stehen – gemessen
0,988 × `SKIN` als tiefster Wert über 1475 Keil-Konfigurationen, und der Wert wächst über 20 000 Ticks
nicht. Die Toleranz im Fuzz ist deshalb `radius − SKIN − 1e-9`; die Gegenprobe (Eckkreise abgeschaltet)
fällt damit weiterhin um, die Schranke ist also nicht zu weich.

**Falle, die in jedem Test steht:** ein reiner Slab-Test gegen das um `r` aufgeblähte Rechteck liefert
kein `t > 0`, wenn der Start in der **Eckzone** liegt (`|lx| < hx+r` und `|lz| < hz+r`, Abstand trotzdem
> r). Der Kollider würde für den ganzen Schritt ignoriert – das war die Quelle aller Rest-Tunnel
(11–22 je 10 000 Ticks). Deshalb prüft der Sweep 2 Flächen- und 4 Eck-Kandidaten einzeln (Minkowski-Körper
= abgerundetes Rechteck) und liefert bei echter Eindringtiefe `t = 0` mit Herausdrück-Normale.

**Keine Broadphase** (so auch die Spec): brute force kostet bei 196 Kollidern 5,42 µs je `moveCircle`,
bei 200 Kollidern 0,46 µs (`segmentBlocked`), 0,31 µs (`sweepCircle`), 4,11 µs (`rayCast3`) und 0,94 µs
(`checkSupport`) – das trägt weit über 200 Kollider hinaus.

Die Fuzz-Invariante „die Strecke alt→neu kreuzt keinen Kasten" wird nur bei `hits === 0` geprüft: mit
Gleitschritten ist der gelaufene Weg ein Polygonzug, und die Sehne schneidet Außenecken ab (gemessen
5 Fehlalarme in 45 Ticks bei 20 u/Tick, Endlage jedes Mal sauber). Genau der Fall **ohne** Treffer ist aber
der, in dem Tunneln aufträte – ein übersprungener Kasten meldet sich nicht als Treffer. Zusätzlich wird in
JEDEM Tick die Arena-Grenze geprüft.

Fünf Konventionen der Abfragen, die der Vertrag offen lässt (T3 legt sie fest, M4/M5/M9 verlassen sich
darauf): eine Bewegung von genau `(0,0)` fragt **gar nichts** ab – ein stehender Bewegter kostet keine
Rechnung, und eingedrungene Lagen erzeugt der Kern nicht (herausgedrückt wird beim nächsten Schritt **mit**
Bewegung, mit voller Restbewegung danach). `MoveResult.hits` zählt **aufgelöste Treffer je Aufruf**
(0 … `MAX_SLIDES`), nicht berührte Kollider. `blockedX`/`blockedZ` melden, dass in dieser Achse Bewegung
**verworfen** wurde – eine Auskunft, keine Zusicherung über die Endlage; seit Ruling U6 wertet
`playerMove` sie aus (siehe unten). Ein nicht endliches `delta` läuft **still** durch (`hits 0`, nicht
endliche Endlage): der Aufrufer ist verantwortlich, und `hashState` wirft im selben Tick mit dem Feldpfad.
`radius ≤ 0` schaltet die Eckkreise ab – das ist für Punkt-Abfragen gedacht, nicht für Bewegte.

### `InputFrame`: 8 Byte, verifiziertes Layout (D7)
`tick u32 LE (0..3) | mx i8 (4) | mz i8 (5) | buttons u8 (6) | seq u8 (7)`. Das ist die **einzige**
8-Byte-Lösung mit allen fünf Spec-Feldern: `seq u16` ergäbe 9 Byte, also faktisch 12. `tick u32` reicht bei
30 Hz für 4,5 Jahre, `seq u8` deckt 8,5 s Flugzeit ab; vier Spieler kosten roh 960 Byte/s. Die Bytes werden
einzeln geschrieben und gelesen (kein `DataView`), damit die Reihenfolge im Quelltext steht und nicht an
einem Flag hängt; `unpackInput` macht aus Werten > 127 wieder negative. Flanken liegen **nicht** im Frame,
sondern als `player.prevButtons` im Zustand.

### Konventionen der Simulation
- **`step()` erhöht `state.tick` am ENDE**, nach allen Systemen. Innerhalb eines Ticks sehen also alle
  Systeme dieselbe Nummer, und `inputs` sind die Eingaben **zu** diesem Tick. Diese Konvention steht hier,
  weil sie an jedem Golden-Hash klebt: wer sie umdreht, verschiebt jeden Fixture-Wert um einen Tick.
- **Das Spiel beginnt nachts** (`clock.phase = 'night'`, `phaseTick = 0`, `dayCount = 1`): der Beutezug ist
  der Nachtteil, der Tag ist die Kolonie-Phase. Tag und Nacht dauern je 300 s = 9000 Ticks und enden
  vorzeitig, wenn **alle aktiven** Spieler ihre `skipVotes` gesetzt haben.
- **Reihenfolge der zehn Systeme** (gepinnt durch einen Test über `SYSTEMS.map(s => s.name)`):
  clock → playerIntent → playerMove → interaction → noise → catPerception → catBrain → catMove → catch →
  colony. Sechs davon sind in M3 **leere** Stümpfe (M7/M13/M16); ein Stumpf, der die Katze „schon mal
  etwas" bewegte, würde jeden Golden-Hash festschreiben, den M7 sofort wieder umwirft.
- **Ereignisse landen im Puffer des Aufrufers**, nicht im Zustand; M3 kennt genau `phase-changed`,
  `day-started` und `noise` (nur laute Ereignisse; der leise Rest steht im Ringpuffer für M7).
- **Sprint ist Button ODER Außenring** – zwei Wege, keine Bedingung; `cat.targetSlot` ist `-1` statt `null`
  (ein `null` bräuchte im Hash-Lauf eine eigene Kodierungsregel).
- **Spielerbewegung ist beschleunigungsbegrenzt, kein Lerp:** `dv = vZiel − v`; ist `|dv| ≤ accel`,
  wird das Zieltempo **exakt zugewiesen** (nicht `v += dv` – in IEEE-754 ist das nicht bitgleich und ergäbe
  einen 1-ULP-Grenzzyklus statt eines Fixpunkts), sonst geht es um genau `accel` in Richtung Ziel. `accel`
  ist u/Tick² (aus `accelCmPerS2`) – ein Lerp-Faktor hätte diese Einheit zur Lüge gemacht: mit 600 cm/s²
  hätte die Maus ~1,4 s bis Gehtempo gebraucht. Mit den Startwerten unten steht Gehtempo nach 5, Sprint
  nach 9 Ticks. Ohne Eingabe gilt weiter `v *= frictionPerTick` (Faktor je Tick).
- **Ruling U6 – eine blockierte Geschwindigkeitskomponente wird genullt:** nach `moveCircle` setzt
  `playerMove` `vel.x = 0` bei `blockedX` (analog z), und zwar **vor** Tempo, `facing` und Lautstärke.
  Ohne das behielt ein gegen die Wand gedrückter Spieler Sprinttempo: gemessen im T5-Review 40 Lärmproben
  und 38 `noise`-Ereignisse mit Lautstärke 0,9 in 40 Ticks, obwohl er stand. Das **Gleiten** entlang der
  Wand bleibt unberührt – `moveCircle` kappt nur den Anteil, der in die Fläche hineinzeigt, nicht die
  tangentiale Komponente.

### Balance: jede Zahl ist provisorisch (D10/R1) – Spaß-GATE nach M14
Belegt sind nur `tickRate = 30` und „Tag/Nacht je 5 min = 9000 Ticks". **Tempi, Beschleunigung, Reibung und
die Lautstärkekurve stehen in keinem Dokument** – die Werte in `src/data/balance.json` sind geraten und
tragen ihre Einheit im Feldnamen (`walkCmPerS`, `accelCmPerS2`, `frictionPerTick`, `radiusCm`). Startwerte:
Gehen 100 cm/s (0,33 u/Tick), `sprintMul` 1,8 (0,6 u/Tick), Beschleunigung 600 cm/s², `frictionPerTick`
0,85, `sneakBelowRatio` 0,4, `weakenedMul` 0,7, Lautstärke 0,2 / 0,5 / 1,0, Maus r 4 cm / h 6 cm, Katze
r 12 cm / h 30 cm. Der Loader rechnet **einmal** um; die Formeln sind Vertrag und von Tests gepinnt:
`u/Tick = cmPerS / (10 · tickRate)` (60 cm/s → 0,2), `u/Tick² = cmPerS2 / (10 · tickRate²)`,
`u = cm / 10`, `Ticks = s · tickRate` (muss ganzzahlig sein).

**Kein Test pinnt eine dieser Zahlen** (Ruling P1, Abschluss-Review). Golden-Lauf, Determinismus-Naht,
Systemtests und der Bench benutzen `tests/fixtures/core/test-balance.json` mit bewusst anderen Werten
(u. a. 2 s Tag / 3 s Nacht, damit ein Phasenwechsel in 60 bzw. 90 Ticks prüfbar ist). **Ein** Test lädt
die echte Datei (`tests/unit/core/data/balanceLoad.test.ts`), vergleicht aber keinen Wert: er prüft, dass
sie die Roh-Form `BalanceJson` erfüllt (per Typzuweisung, also im Übersetzer), ohne Wurf durch den Loader
läuft, 23 endliche Zahlen ergibt – und sich von der Fixture unterscheidet. Gepinnt sind allein die
**Umrechnungsformeln** oben, und die an der Fixture. Wer am Regler-Panel aus M6 dreht, macht `npm test`
also nicht rot; entschieden wird die Balance am Spaß-GATE nach M14.

### Daten werden injiziert, nicht importiert (D12)
Gemessen: ein `import balance from '../../data/balance.json'` aus `src/core` **wäre erlaubt** – ESLint
listet `data` nicht unter den fremden Schichten, und `resolveJsonModule` greift. Trotzdem ist es verboten:
ein fester Import unterliefe die Regel „Golden-Tests laufen gegen eingefrorene Fixtures, nicht gegen die
echten Balance-Daten". Jeder Loader nimmt `unknown` (`loadBalance`, `loadLevel`), wirft bei jedem Fehler
mit dem **Feldpfad** (`shelves[1].gapCm`) und liefert die normalisierte Form; das Lesen der Dateien und
die Komposition passieren außerhalb des Kerns (M5, `soloSession`). Seit M3 sperrt ESLint zusätzlich
`JSON.parse`/`JSON.stringify` in `src/core/**`, damit der Umweg „Datei als Text hereinreichen und im Kern
parsen" gar nicht erst entsteht. `src/data/balance.json` wird von genau **einer** Datei importiert:
`tests/unit/core/data/balanceLoad.test.ts` – und die pinnt keinen Wert daraus (siehe „Balance").

Zwei Prüfungen des Level-Loaders sind bewusst asymmetrisch (T2-Review): **Spawns** müssen in einem Raum
liegen, geprüft gegen **halboffene** Grenzen (`x0 ≤ x < x1`, `z0 ≤ z < z1`) – dieselbe Regel, nach der
`playerMove` einen Punkt einem Raum zuordnet; sonst gehörte ein Spawn genau auf der oberen Kante zu keinem
Raum und hätte später weder Raum-Maske noch Kamera. Das **Mauseloch** wird dagegen **nicht** gegen Räume
geprüft: es ist ein Portal in der Wand und liegt damit per Bauart auf der Grenze. Die Regel dafür legt M4
fest, zusammen mit dem Level-Validator.

### Golden-Hash, Fixtures und das Re-Baseline-Verfahren (D13)
Die Eingaben kommen nicht aus aufgezeichneten Frames, sondern aus einem **reinen** Generator
(`tests/helpers/scriptedInputs.ts`: Saat × Muster × Tick → `InputFrame[]`, Muster `idle`, `walk-circle`,
`sprint-bursts`, `wall-hugger`). `tests/fixtures/core/golden.json` hält je Fall Name, Saat, Muster,
Tickzahl, Hash und die Endlagen der Spieler – die Endlagen zeigen beim Vergleich, **was** sich geändert
hat, nicht nur **dass** sich etwas geändert hat. Fälle laufen über 1, 30, 300 und 3000 Ticks.

Verfahren, wenn ein Golden-Wert sich ändert:
1. **Erst verstehen.** Ein geänderter Hash ohne geänderte Absicht ist ein Fehler, keine neue Baseline.
2. `npm run core:rebaseline` schreibt die Fixture neu und druckt je Fall alt → neu.
3. In **diesen** Abschnitt kommt eine Zeile der Form `Rebaseline: <Grund>` (Datum, Fall, Ursache).
4. `tests/node/golden-guard.test.ts` erzwingt Schritt 3: er vergleicht den Arbeitsbaum mit
   `git show HEAD:tests/fixtures/core/golden.json` und verlangt bei einer Abweichung, dass
   `docs/decisions.md` **mehr** Zeilen mit diesem Präfix enthält als die `HEAD`-Fassung. Bewusst **keine**
   Commit-Nachricht: die wäre bei Amend und Rebase falsch-rot, und der Index wäre vor `git add` falsch-grün.
   Ohne `git` oder ohne die Datei in `HEAD` meldet der Wächter das und geht durch.

Re-Baselines (chronologisch, jeweils eine Zeile mit dem Präfix aus Schritt 3): bisher keine. Die **erste**
Baseline ist selbst keine Re-Baseline – `golden.json` stand vorher nicht in `HEAD`, der Wächter startet
also bei null Zeilen. Eingefroren wurde sie in T6 gegen den Kern **nach** Ruling U6; die Zahlen des
Plan-Trockenlaufs (vor U6) sind damit Geschichte: `ruhe-1` blieb bei `0x8db4fa20` (im ersten Tick greift
noch keine Wand), `kreis-30` ging von `0x3b2610b0` auf `0x286097f8`, `gemischt-300` von `0x6c59058e` auf
`0x62fcb233` und `gemischt-3000` von `0x95fd841b` auf `0xb539ff54`.

### Gemessene Kosten
Prototyp-Messungen (Node 24 / V8, Faktenblatt): `step()` mit 4 Spielern, Katze und 300 Loot kostet bei
71 Kollidern 6,96 µs, bei 200 Kollidern 21,62 µs, bei 400 Kollidern 44,07 µs; mit `hashState` je Tick
36,6 µs. Ein voller Golden-Lauf über 9000 Ticks (eine Nacht) mit Hash je Tick: 328,5 ms.

Umsetzung, gemessen mit `npm run core:bench` auf dem Entwicklungsrechner:

- `step()`: **38,25 µs je Tick** (4 Spieler, 200 Kollider, 300 Loot)
- `hashState()`: **144,67 µs je Zustand** (`step()` + `hashState()` zusammen 182,92 µs)

Der Aufschlag gegenüber den 15,7 µs des Prototyps ist der Feldpfad je Zahl; Vorbehalt („nur dieser
Rechner") und der mögliche Ausweg stehen unter *Offene Punkte* und werden hier nicht wiederholt.
**In keinem Test steht eine Zeitzusicherung**: „< 2 s" wäre auf fremder Hardware falsch-rot. Die einzige
Zeitschranke ist Vitests globales `testTimeout: 30_000`.

### Bekannte Grenzen von M3
Nur die beiden Punkte, die nirgends sonst stehen – Stümpfe, Mini-Level, Cross-Engine und die Messkosten
stehen unter *Offene Punkte*, der Liste, die vor jedem Meilenstein gelesen wird.

- **Der Hash beweist Gleichheit, nicht Richtigkeit.** Er fängt Drift, sagt aber nichts über richtige
  Bewegung – deshalb hat jedes System eigene Verhaltenstests neben dem Golden-Lauf.
- **Der Golden-Wächter greift nur im Git-Arbeitsbaum** und ersetzt nicht das Lesen des Diffs.

## Offene Punkte

- **Update-Suche offline:** Headless ist nur der Fall „kein Update" natürlich erreichbar: **gemessen** löst `registration.update()` auch bei `context.setOffline(true)` (und bei abgebrochener `sw.js`-Route) auf – Playwrights Netz-Emulation greift nicht für die Skript-Anfrage des Service Workers, die der Browser selbst stellt. Die beiden anderen Zweige wurden deshalb mit gepatchtem `update()` im echten Chromium geprüft: Ablehnung → „Update-Suche fehlgeschlagen – offline?" (Knopf bleibt verborgen), wartender Worker → „Neue Version bereit." (Knopf sichtbar).
- **Selbsttest-Report vom Handy (M1-Abnahme durch den Nutzer):** erledigt am 2026-09-25 mit Build 89c959d1 (beide Läufe gültig, keine Befunde) – Ergebnis in `docs/connectivity-tests.md`, Befund oben unter „Gemessene Befunde".
- **Stumme, aber offene Gegenstelle kostet ≈ 20 s:** hört die andere Seite nicht zu, obwohl der Transport offen bleibt, wartet ein Lauf 3 s auf das Hello und danach je Kanal die volle Serie (bei 200 Pings ≈ 6,6 s Senden + 2 s Zeitüberschreitung), bevor der Report erscheint. Die Serie endet nur dann früher, wenn der Transport wirklich schließt.
- **Firefox und WebKit als Empfänger des zusammengebauten SDP ungeprüft:** `rebuildSdp` wurde bisher nur von Chromium angenommen. Erster Versuch bei Problemen: `a=end-of-candidates` ergänzen.
- **`isRunValid` kalibrieren:** nach dem ersten iPhone-Selbsttest (siehe „Gemessene Befunde", WebKit/iOS).
- **Wortlaut des F4-Hinweises** wird nach der Zwei-Handy-Matrix F nachgeschärft.
- **Zwischenablage auf dem Linux-CI-Runner ungeprüft:** die Lese-Pfade der Kopier-Knöpfe sind nur lokal auf Windows-Chromium gemessen – `tests/e2e/lab-broadcast.spec.ts` liest die Zwischenablage aber im Deploy-Tor (`e2e:smoke`), also auch auf dem Linux-Runner. Schlägt sie dort fehl, ist der Ausweg die Prüfung über den abgefangenen `navigator.clipboard.writeText` (wie im Selbsttest-Block von `lab-rtc.spec.ts`), nicht das Abschwächen der Schwärzungs-Prüfung.
- **Aufgeschobener Feinschliff** (nach dem Feinschliff-Commit verbleibend): eine stumme, aber offene Gegenstelle kostet ≈ 20 s (eigener Punkt oben); `?transport=bc` sendet ohne Gegenstelle für immer `syn` (nur Entwicklung und Tests); `redactReport` ist in Schicht 2 quadratisch in der Kandidatenzahl (bei ≤ 20 belanglos); `trace: 'retain-on-failure'` (playwright.config.ts) legt bei einem gescheiterten `@local`-Selbsttest ungeschwärzte Reports in das git-ignorierte `test-results/` – nie im Repo, aber **nicht nur lokal**: `.github/workflows/deploy.yml` lädt `test-results` bei `if: failure()` als Artefakt `playwright-test-results` hoch (7 Tage Aufbewahrung), und Artefakte eines öffentlichen Repos kann jeder herunterladen. Betroffen wären ausschließlich die Kandidaten des kurzlebigen CI-Runners – nie ein Gerät des Nutzers –, und die `@local`-Specs laufen in der CI gar nicht; ein gescheiterter Tor-Spec kann aber Traces mit Runner-Adressen mitnehmen. Vor dem Herunterladen eines solchen Artefakts das im Kopf behalten.
- **Sitzung A steht aus (M2-Abnahme durch den Nutzer):** die Zellen A1–A8 aus `docs/runbook-zwei-handys.md` sind geplant, aber noch nicht gefahren (dem Nutzer fehlt gerade ein zweites Gerät für die Matrix F). Erst daraus kommen die ersten echten Werte für `qr.backend`, die Paarungsdauer je Richtung und die Hochrechnung „Zeit bis Lobby voll" – bis dahin stehen in `docs/connectivity-tests.md` nur die Vorlagen.
- **iOS in M2 ungemessen:** Wake Lock wirkt in installierten Web-Apps erst ab iOS 18.4 (WebKit-Bug 254545), `BarcodeDetector` steht in Safari nur hinter einem Feature-Flag und ist auf iOS defekt (WebKit-Bug 281848). Auf dem iPhone ist der QR-Pfad also der Worker-Pfad ohne Wake Lock; ob das reicht, entscheidet erst ein Report.
- **Häufigkeit des Rückfalls „Code zu groß für QR" beobachten:** der Deckel `MAX_QR_PAYLOAD_CHARS = 1100` ist aus der Lesbarkeit auf einem Telefon abgeleitet, nicht aus gemessenen Payloads (größter gemessener M1-Payload: 704 Zeichen). Schlägt er in Sitzung A oder in der Matrix F regelmäßig zu, ist die Antwort nicht ein höherer Deckel, sondern weniger Kandidaten im Payload – Kandidaten-Filterung liegt bewusst außerhalb von M2.
- **Sperrbildschirm-Test nur am Handy messbar:** am PC gibt es kein Sperrverhalten, das dem eines Telefons entspricht, und headless lässt sich nur `visibilitychange` auslösen. Die Zahlen in `lockTest.runs[]` sind deshalb erst nach Sitzung A bzw. der Matrix F aussagekräftig.
- **Modulzahl 125 statt 105 bei 1100 Zeichen:** `research.md` §1 und D3/D4 rechneten mit einer Tabelle, die für Groß-/Ziffernfolgen gilt (Alphanumerik-Modus). Ein echter base64url-Payload ist ein Byte-Segment. Der Deckel bleibt bei 1100 (2,93 CSS px je Modul auf 390 px); scannt Sitzung A ihn nicht zuverlässig, sinkt er auf ~700 Zeichen (101 Module) – nicht die Untergrenze `minModulePx`.
- **Wake Lock nach `pagehide` ungeklärt:** wird die Seite weggeschaltet (Zurück-Taste, iOS-Seitencache), fordert `src/platform/wakeLock.ts` die Sperre nicht erneut an – am Gerät hilft nur ein Neuladen. Ob das auf dem iPhone in der Praxis stört, zeigt erst ein echter Sperrtest.
- **`lock:reconnect` erreicht praktisch keinen gespeicherten Report:** der Eintrag landet in der Zeitleiste der gerade geschlossenen Verbindung. Wer auswerten will, ob neu verbunden wurde, liest `lockTest.runs[].reconnected`. Ob der Eintrag überhaupt bleiben soll, wird nach Sitzung A entschieden.
- **Fake-Kamera-Smokes auf dem Linux-CI-Runner ungemessen:** beide Specs laufen bisher nur lokal auf Windows-Chromium (je 3× stabil). Der fremde Smoke baut dabei eine echte `RTCPeerConnection` auf. Fällt einer in der CI um, bekommt er dort `{ tag: '@local' }` und der Grund kommt hierher (C7) – der Test wird nicht abgeschwächt.
- **Balance-Zahlen sind geraten (M3):** Tempi, Beschleunigung, Reibung und die Lautstärkekurve stehen in keinem Dokument. Sie gehen mit dem Regler-Panel aus M6 ans Spaß-GATE nach M14 – Herleitung, Formeln und der Stand der Prüfungen im Abschnitt „Balance: jede Zahl ist provisorisch".
- **In M3 verbraucht kein System Zufall:** `nextU32` & Co. werden nur von `seedRng` und von Testcode gerufen, der `rng`-Anteil des Zustands bleibt nach dem Saaten konstant. Die Golden-Läufe belegen also die **Verankerung** des RNG im Zustand, nicht sein Fortschreiten (das deckt `rng.test.ts` mit einem eingefrorenen sfc32-Vektor ab). Das erste zufallsnutzende System ist M7 – dort ist auch der erste Ort, an dem eine Drift entstehen kann.
- **Cross-Engine-Hash ungeprüft:** lokal ist nur Chromium installiert, Vitest läuft in Node – beides V8. Ob Firefox und Safari denselben Zustandshash liefern, entscheidet M20. Bis dahin behauptet kein Text und kein Testname „cross-engine".
- **`npm run core:bench` misst nur diesen Rechner:** auf dem Handy ist mit dem 4- bis 8-fachen zu rechnen (kein Gerät zum Messen). Die Zahlen im Abschnitt „M3 – Core I" tragen diesen Vorbehalt.
- **`hashState` kostet ~145 µs statt der ~16 µs des Prototyps:** der Unterschied ist der Feldpfad, den die Vertragsfassung je Zahl für die NaN-Diagnose zusammensetzt. In M3 belanglos (der Hash läuft nicht je Tick). Wird er je zum Engpass, ist der Ausweg ein schneller Lauf ohne Pfade plus ein zweiter Lauf mit Pfaden bei `NaN` – nicht eine schwächere Diagnose.
- **Die sechs Katzen-/Kolonie-Systeme sind leere Stümpfe:** jeder Golden-Hash aus M3 gilt nur bis zum ersten echten Verhalten (M7, M13, M16). Der Umbau braucht dann eine Re-Baseline mit Begründung – das ist erwartet, kein Fehler.
- **Level-Validator und `feinkost.json` fehlen (M4):** das Mini-Level prüft nur Loader, Kollider-Erzeugung und Kollision. „Kein Durchgang schmaler als 2r" und „keine zwei wirksamen Kollider überlappen sich im Grundriss" (je Bewegten-Art) sind in M4 fällig – im Entwurfs-Level fand die Probe für die Katze 12 zu enge Paare, also echte Layout-Fehler. Dort fällt auch die Regel für das Mauseloch, das der Loader heute bewusst nicht gegen Raumgrenzen prüft.

## Beobachten (vor jedem Release prüfen)
- Chrome „Local Network Access Restrictions for WebRTC" (WebRTC ins lokale Netz nur noch nach Berechtigungsabfrage): chromestatus.com/feature/5065884686876672
- Chrome „Local Network Access split permissions" (Aufteilung in `local-network` und `loopback-network`, die alte Berechtigung bleibt Alias): chromestatus.com/feature/5068298146414592
- Firefox „Local network access restrictions for webrtc" (Core :: WebRTC: Networking): bugzilla.mozilla.org/show_bug.cgi?id=1969916
- WebKit-Bug 301994 (Statusleisten-Balken in installierten iOS-Web-Apps)
