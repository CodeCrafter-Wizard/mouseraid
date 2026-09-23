# Mäusebau – Arbeitsregeln für Claude Code

Browser-Spiel (3D-Koop-Stealth, offline-fähige PWA). **Quelle der Wahrheit:**
1. `docs/superpowers/specs/2026-09-21-phase0-phase1-design.md` (freigegebenes Design, Meilensteine M0–M20)
2. `docs/decisions.md` (Abweichungen von der Spec + Messergebnisse)
3. `Game_Design_Mouse.md` (ursprüngliche Spec – **Abschnitt 10 überstimmt ältere Abschnitte**)

Sprache: mit dem Nutzer und in UI-Texten **Deutsch**.

## Befehle
- `npm run dev` – Desktop-Entwicklung (kein Service Worker)
- `npm run verify` – Lint + Typecheck + Tests + Pages-Build + check-dist + E2E-Tor (vor jedem „fertig")
- `npm run phone` + `adb reverse tcp:4173 tcp:4173` – Handy-Loop ohne Service-Worker-Cache → am Handy `http://localhost:4173/?expect=<Build-ID>`
- `npm run e2e:smoke` – das E2E-Tor: alle Specs **ohne** Tag `@local` (Offline-Smoke, Zwei-Tab-Labor über BroadcastChannel); läuft in `verify` und in der CI vor jedem Deploy
- `npm run e2e:local` – nur die `@local`-Specs (Tooling-Spike, echter WebRTC-Ablauf, Selbsttest); nur auf dem Entwicklungsrechner, nie in der CI
- `npm run e2e` – alle Playwright-Tests (Tor + `@local`). Direktaufruf in PowerShell mit Anführungszeichen: `npx playwright test --grep '@local'` – sonst deutet die Shell `@local` als Splatting
- `npm run check-dist` – prüft den vorhandenen `dist/`-Ordner (Offline-Fallen, Schichtgrenzen im Bundle, Precache, Budgets)
- `npm run build:pages` – Pflicht vor `check-dist` **und vor jedem Playwright-Lauf**: beide prüfen immer den vorhandenen `dist/`-Ordner, nie den Quelltext
- `Get-NetTCPConnection -LocalPort 4173` – nach Playwright-/Preview-Läufen prüfen: lokal wird ein laufender Preview **wiederverwendet** (`reuseExistingServer`). Stammt er aus `npm run phone`/`phone:pwa`, hat er die falsche `base` und die Tests scheitern an 404-/MIME-Fehlern → diesen Prozess vorher beenden.

## Harte Regeln
- **Schichten:** `src/core` kennt weder DOM noch Babylon noch andere Schichten. `src/net` und `src/lab` kennen weder `src/render` noch Babylon. ESLint erzwingt das – Regeln nie lockern, sondern den Code umbauen.
- **Determinismus in `src/core`:** nur Integer-Ticks (30 Hz), Seeded-PRNG aus dem State, Trig nur über `src/core/math`. Verboten: `Math.random|sin|cos|tan|atan2|pow|exp|log*|hypot|cbrt…`, `Date`, `performance`, Timer. Iteration nur über Arrays; Sortier-Gleichstände per ID auflösen.
- **Texte:** alle sichtbaren Texte in `src/ui/strings.ts`. Ausnahmen – alles Entwickler-Rückkanal, keine Spiel-UI: `<title>` in den HTML-Dateien, das Web-Manifest (`vite.config.ts`), der Diagnose-Text in `src/platform/errorLog.ts`, die technischen `Error.message`-Texte aus `src/net/**` und `src/lab/**` (`ProtocolError`, `CodecError`, `HandshakeError` …), die Zeitleisten-Details (`timeline.push(kind, detail)`) und die Report-Daten des Testlabors (`src/lab/report.ts` mit `reportToText` und den Gründen aus `isRunValid`, `labSession.ts`, `selfTest.ts` mit `DEFAULT_DEVICE`) – sie stehen im Report und werden in der Labor-Oberfläche nur zitiert.
- **Offline:** keine Fremd-Hosts zur Laufzeit. Kein KTX2/Draco/Meshopt, keine STUN/TURN-Server, kein Babylon-Legacy-Barrel, kein `import * as` aus Babylon. `check-dist` und der Offline-Smoke sind Gates.
- **Audio:** genau ein `AudioContext`, nur in `src/audio/audioBus.ts`.
- **Testablage:** Vitest findet `tests/**/*.test.ts` (Node-only-Tests, die `git`/`dist` anfassen, liegen in `tests/node`), Playwright nur `tests/e2e/*.spec.ts`. Endung `.test.ts` vs. `.spec.ts` ist die Trennlinie.
- **E2E-Tor:** **Jeder neue Spec gehört zum Deploy-Tor** (`e2e:smoke`), außer jeder seiner Tests trägt `{ tag: '@local' }` – nur für Tests, die echte Netzwerkschnittstellen, eine persistierte Kamera-Erlaubnis oder die Grafik des Entwicklungsrechners brauchen. Specs, die einen Labor-Lauf (`finishRun`) auslösen, erteilen zusätzlich `local-network-access` (`context.grantPermissions`, additiv); Specs mit echten Kandidaten prüfen Zwischenablage und Report **in der Seite** und lassen nur Wahrheitswerte/Anzahlen heraus (Playwright druckt bei Fehlschlag das geprüfte Objekt). E2E-Specs importieren aus `src/` nur Module, die `src/platform/buildInfo.ts` nicht erreichen.
- **Tests:** Playwright treibt die Simulation über Ticks (`window.__mb.advance(n)`), nie über Wartezeiten. Golden-Tests laufen gegen eingefrorene Fixtures, nicht gegen die echten Balance-Daten. Playwright-RTC-Tests brauchen eine **persistierte Kamera-Erlaubnis** (`permissions: ['camera']` bzw. `context.grantPermissions`) – das Fake-UI-Flag allein liefert nur mDNS-Namen (siehe `docs/decisions.md`, Tooling-Spike).
- **Nie „fertig" melden ohne frische Ausgabe** der zugehörigen Prüfung. Fehlgeschlagene Prüfungen ehrlich berichten; Tests nicht abschwächen, damit sie grün werden.
- **Geheimnisse:** Das GitHub-Token (`GITHUB_PERSONAL_ACCESS_TOKEN`) nie ausgeben, loggen oder in Dateien schreiben.
- **Datenschutz (öffentliches Repo):** echte Netzwerkadressen (IPs, mDNS-Namen, IPv6-Präfixe) aus Tests, Reports oder Logs werden nie committet – dokumentiert werden nur Art und Anzahl. `tests/node/privacy-guard.test.ts` scannt bei jedem `npm test` alle getrackten Textdateien darauf.
- **Unsichtbare Zeichen** (Zero-Width, NBSP …) in Quelltext und Tests nur als `\u`-Escape schreiben, nie wörtlich – der Schreibweg des Agenten hat Escapes schon in echte Zeichen verwandelt. `no-irregular-whitespace` (ESLint-Empfehlung) ist die Rückfalllinie.
- **Grenzen des Agenten:** kein Gehör, nur Standbilder → Audio- und Bewegungs-Qualität beurteilt der Nutzer. Bei jeder Test-Bitte an den Nutzer die erwartete Build-ID nennen.

## Testlabor (`lab.html`)
- **Code:** Netz in `src/net/**` (reine Logik: Protokoll, SDP-Codec, Kandidaten, Fehlercodes, Ping-Statistik; Browser-Schichten: `rtcTransport`, `connector`, `environment`, `signaling/textShare`), Labor in `src/lab/**` (`report`, `labSession`, `labUi`, `selfTest`, `labMain`). Definition der Fehlercodes F1–F9: `docs/decisions.md` („M1 – Testlabor I").
- **Reports:** Reports mit echten Adressen bleiben auf dem Gerät (`localStorage`, Schlüssel `maeusebau.lab.reports.v1`). Nach `docs/connectivity-tests.md` kommen nur anonymisierte Reports (`redactReport` bzw. die Knöpfe „… (anonymisiert)"); Roh-SDP wird nie committet. Kandidaten-Ereignisse in der Zeitleiste enthalten nie Adressen.
- **URL-Parameter (nur Entwicklung/Tests):** `?transport=bc&room=<name>&role=host|client&slot=<1–3>` (BroadcastChannel statt WebRTC, zwei Tabs), `?quick=1` (kurze Ping-Serie), `?hook=1` (Test-Haken `window.__mbLab` für Playwright). Details: `docs/decisions.md`.

## Deploy
Nur `push` auf `main` deployt (GitHub Actions → Pages: https://codecrafter-wizard.github.io/mouseraid/).
Build-ID = 8-stelliger Kurz-SHA (`git rev-parse --short=8 HEAD`); `?expect=` und `wait-for-deploy` akzeptieren auch ein ≥ 7-stelliges Präfix. Dirty-Builds heißen `<sha>-dirty-<HHmmss>` (UTC) und werden nur exakt verglichen.
`node scripts/wait-for-deploy.mjs <sha>` wartet, bis die Build-ID live ist. Pages liefert mit `max-age=600` aus → am Handy „Nach Update suchen".
