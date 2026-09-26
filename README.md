# Mäusebau

Kooperatives 3D-Mäuse-Abenteuer im Browser – offline spielbar, für Handy, Tablet und PC.
**Status:** Meilenstein M5 (Graybox am Desktop: Babylon.js mit WebGL2, feste 30-Hz-Schleife mit Interpolation, Kasten je Kollider und Boden je Raum aus dem Level, Kapsel-Figuren, Kamera-Boom mit Wandklemmung und Diorama-Blick, F3-Overlay – dazu weiter die Entwickler-Ansicht `?view=2d`. Noch kein Spielgefühl, keine Touch-Eingabe, kein Start-Gate). Live: https://codecrafter-wizard.github.io/mouseraid/

## Entwickeln
Voraussetzung: Node ≥ 22.18 (`scripts/wait-for-deploy.mjs` lädt ein TypeScript-Modul direkt).

    npm install
    npx playwright install chromium
    npm run dev          # Desktop, http://localhost:5173
    npm run verify       # alle Prüfungen (inkl. E2E-Tor)
    npm run e2e:local    # nur lokal: echter WebRTC-Ablauf, Selbsttest, Tooling-Spike

### Am Android-Handy testen (USB)
1. Einmalig: `winget install Google.PlatformTools`, am Handy USB-Debugging aktivieren.
2. `npm run phone` und in einem zweiten Terminal `adb reverse tcp:4173 tcp:4173`.
3. Am Handy in Chrome `http://localhost:4173/` öffnen.

Offline-Installation, iPhone und Zwei-Handy-Tests laufen immer über die Live-URL.

## Doku
- Design & Meilensteine: `docs/superpowers/specs/2026-09-21-phase0-phase1-design.md`
- Entscheidungen & Messwerte: `docs/decisions.md`
- Verbindungstests (nur anonymisierte Reports): `docs/connectivity-tests.md`
- Runbook für die Zwei-Geräte-Sitzungen (druckbar): `docs/runbook-zwei-handys.md`
- Ursprüngliche Spezifikation: `Game_Design_Mouse.md`

## Lizenz
Code: [MIT](LICENSE). Fremde Assets (ab Meilenstein M18, z. B. CC0-Packs von Kenney/KayKit) werden mit Quelle und Lizenz in `ASSETS.md` aufgeführt.
