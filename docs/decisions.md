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
| F9 | Kamera-/QR-Problem (in M1 nur: Kamera-Anforderung im Selbsttest fehlgeschlagen) |

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
| `?hook=1` | hängt `window.__mbLab` ein (`src/lab/labHook.ts`): die Netz-Schicht ohne UI (`createHostLobby`, `createClientJoin`, `createMessageRouter`, `createTimeline`, `runPingSeries`, `attachPongResponder`, `PROTOCOL_VERSION`) für `tests/e2e/lab-rtc.spec.ts`. Ohne den Parameter existiert der Haken nicht. |

### Gemessene Befunde (nur Art und Anzahl)
- **Chromium meldet einen nie verbundenen ICE-Lauf nicht als `ice:failed`:** nach ≈ 15 s steht `iceConnectionState` auf `disconnected`, nur `connectionState` wird `failed`. `rtcTransport` setzt `failed` deshalb bei beiden Signalen, `labSession` speist F3 aus beiden.
- **Playwright/Headless: `local-network` und `loopback-network` melden `denied`**, sobald ein Kontext irgendeine Berechtigung gesetzt bekommt – obwohl die Verbindung steht. Specs, die `finishRun`/`classifyFailures` auslösen, erteilen deshalb zusätzlich `local-network-access` (`context.grantPermissions`, additiv). Sonst stünde in jedem Report F6.
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

## Offene Punkte

- **Update-Suche offline:** Headless ist nur der Fall „kein Update" natürlich erreichbar: **gemessen** löst `registration.update()` auch bei `context.setOffline(true)` (und bei abgebrochener `sw.js`-Route) auf – Playwrights Netz-Emulation greift nicht für die Skript-Anfrage des Service Workers, die der Browser selbst stellt. Die beiden anderen Zweige wurden deshalb mit gepatchtem `update()` im echten Chromium geprüft: Ablehnung → „Update-Suche fehlgeschlagen – offline?" (Knopf bleibt verborgen), wartender Worker → „Neue Version bereit." (Knopf sichtbar).
- **Selbsttest-Report vom Handy (M1-Abnahme durch den Nutzer):** nach dem ersten Deploy mit Testlabor am Android-Handy `lab.html` öffnen, „Selbsttest starten", „Beide Reports kopieren (anonymisiert)" – das Ergebnis kommt als erste Zeilen nach `docs/connectivity-tests.md` („Selbsttest-Ergebnisse").
- **Stumme, aber offene Gegenstelle kostet ≈ 20 s:** hört die andere Seite nicht zu, obwohl der Transport offen bleibt, wartet ein Lauf 3 s auf das Hello und danach je Kanal die volle Serie (bei 200 Pings ≈ 6,6 s Senden + 2 s Zeitüberschreitung), bevor der Report erscheint. Die Serie endet nur dann früher, wenn der Transport wirklich schließt.
- **Firefox und WebKit als Empfänger des zusammengebauten SDP ungeprüft:** `rebuildSdp` wurde bisher nur von Chromium angenommen. Erster Versuch bei Problemen: `a=end-of-candidates` ergänzen.
- **`isRunValid` kalibrieren:** nach dem ersten iPhone-Selbsttest (siehe „Gemessene Befunde", WebKit/iOS).
- **Wortlaut des F4-Hinweises** wird nach der Zwei-Handy-Matrix F nachgeschärft.
- **Zwischenablage auf dem Linux-CI-Runner ungeprüft:** die Lese-Pfade der Kopier-Knöpfe sind nur lokal auf Windows-Chromium gemessen – `tests/e2e/lab-broadcast.spec.ts` liest die Zwischenablage aber im Deploy-Tor (`e2e:smoke`), also auch auf dem Linux-Runner. Schlägt sie dort fehl, ist der Ausweg die Prüfung über den abgefangenen `navigator.clipboard.writeText` (wie im Selbsttest-Block von `lab-rtc.spec.ts`), nicht das Abschwächen der Schwärzungs-Prüfung.
- **Aufgeschobener Feinschliff** (nach dem Feinschliff-Commit verbleibend): eine stumme, aber offene Gegenstelle kostet ≈ 20 s (eigener Punkt oben); `?transport=bc` sendet ohne Gegenstelle für immer `syn` (nur Entwicklung und Tests); `redactReport` ist in Schicht 2 quadratisch in der Kandidatenzahl (bei ≤ 20 belanglos); `trace: 'retain-on-failure'` (playwright.config.ts) legt bei einem gescheiterten `@local`-Selbsttest ungeschwärzte Reports in das git-ignorierte `test-results/` – nur lokal, nie im Repo.

## Beobachten (vor jedem Release prüfen)
- Chrome „Local Network Access" für WebRTC: chromestatus.com/feature/5065884686876672 und /5068298146414592
- Firefox: bugzilla.mozilla.org/show_bug.cgi?id=1969916
- WebKit-Bug 301994 (Statusleisten-Balken in installierten iOS-Web-Apps)
