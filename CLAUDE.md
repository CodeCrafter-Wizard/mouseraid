# Mäusebau – Arbeitsregeln für Claude Code

Browser-Spiel (3D-Koop-Stealth, offline-fähige PWA). **Quelle der Wahrheit:**
1. `docs/superpowers/specs/2026-09-21-phase0-phase1-design.md` (freigegebenes Design, Meilensteine M0–M20)
2. `docs/decisions.md` (Abweichungen von der Spec + Messergebnisse)
3. `Game_Design_Mouse.md` (ursprüngliche Spec – **Abschnitt 10 überstimmt ältere Abschnitte**)

Sprache: mit dem Nutzer und in UI-Texten **Deutsch**.

## Befehle
- `npm run dev` – Desktop-Entwicklung (kein Service Worker)
- `npm run verify` – Lint + Typecheck + Tests + Pages-Build + check-dist + Offline-Smoke (vor jedem „fertig")
- `npm run phone` + `adb reverse tcp:4173 tcp:4173` – Handy-Loop ohne Service-Worker-Cache → am Handy `http://localhost:4173/?expect=<Build-ID>`
- `npm run e2e` – alle Playwright-Tests (Tooling-Spike läuft nur lokal)
- `npm run check-dist` prüft nur den vorhandenen `dist/`-Ordner – vorher immer `npm run build:pages` laufen lassen, sonst wird ein veralteter oder fehlender Build geprüft.
- Nach Playwright- oder Preview-Läufen unter Windows prüfen, ob Port 4173 noch belegt ist (`Get-NetTCPConnection -LocalPort 4173`) – ein hängengebliebener `vite preview`-Prozess blockiert den nächsten Lauf.

## Harte Regeln
- **Schichten:** `src/core` kennt weder DOM noch Babylon noch andere Schichten. `src/net` und `src/lab` kennen weder `src/render` noch Babylon. ESLint erzwingt das – Regeln nie lockern, sondern den Code umbauen.
- **Determinismus in `src/core`:** nur Integer-Ticks (30 Hz), Seeded-PRNG aus dem State, Trig nur über `src/core/math`. Verboten: `Math.random|sin|cos|tan|atan2|pow|exp|log*|hypot|cbrt…`, `Date`, `performance`, Timer. Iteration nur über Arrays; Sortier-Gleichstände per ID auflösen.
- **Texte:** alle sichtbaren Texte in `src/ui/strings.ts` (Ausnahme: `<title>`).
- **Offline:** keine Fremd-Hosts zur Laufzeit. Kein KTX2/Draco/Meshopt, keine STUN/TURN-Server, kein Babylon-Legacy-Barrel, kein `import * as` aus Babylon. `check-dist` und der Offline-Smoke sind Gates.
- **Audio:** genau ein `AudioContext`, nur in `src/audio/audioBus.ts`.
- **Tests:** Playwright treibt die Simulation über Ticks (`window.__mb.advance(n)`), nie über Wartezeiten. Golden-Tests laufen gegen eingefrorene Fixtures, nicht gegen die echten Balance-Daten. Playwright-RTC-Tests brauchen eine **persistierte Kamera-Erlaubnis** (`permissions: ['camera']` bzw. `context.grantPermissions`) – das Fake-UI-Flag allein liefert nur mDNS-Namen (siehe `docs/decisions.md`, Tooling-Spike).
- **Nie „fertig" melden ohne frische Ausgabe** der zugehörigen Prüfung. Fehlgeschlagene Prüfungen ehrlich berichten; Tests nicht abschwächen, damit sie grün werden.
- **Geheimnisse:** Das GitHub-Token (`GITHUB_PERSONAL_ACCESS_TOKEN`) nie ausgeben, loggen oder in Dateien schreiben.
- **Datenschutz (öffentliches Repo):** echte Netzwerkadressen (IPs, mDNS-Namen, IPv6-Präfixe) aus Tests, Reports oder Logs werden nie committet – dokumentiert werden nur Art und Anzahl.
- **Grenzen des Agenten:** kein Gehör, nur Standbilder → Audio- und Bewegungs-Qualität beurteilt der Nutzer. Bei jeder Test-Bitte an den Nutzer die erwartete Build-ID nennen.

## Deploy
Nur `push` auf `main` deployt (GitHub Actions → Pages: https://codecrafter-wizard.github.io/mouseraid/). Build-ID = Git-Kurz-SHA; `node scripts/wait-for-deploy.mjs <sha>` wartet, bis sie live ist. Pages liefert mit `max-age=600` aus → am Handy „Nach Update suchen".
