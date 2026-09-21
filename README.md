# Mäusebau

Kooperatives 3D-Mäuse-Abenteuer im Browser – offline spielbar, für Handy, Tablet und PC.
**Status:** Meilenstein M0 (Gerüst). Live: https://codecrafter-wizard.github.io/mouseraid/

## Entwickeln
Voraussetzung: Node ≥ 22.12.

    npm install
    npx playwright install chromium
    npm run dev          # Desktop, http://localhost:5173
    npm run verify       # alle Prüfungen

### Am Android-Handy testen (USB)
1. Einmalig: `winget install Google.PlatformTools`, am Handy USB-Debugging aktivieren.
2. `npm run phone` und in einem zweiten Terminal `adb reverse tcp:4173 tcp:4173`.
3. Am Handy in Chrome `http://localhost:4173/` öffnen.

Offline-Installation, iPhone und Zwei-Handy-Tests laufen immer über die Live-URL.

## Doku
- Design & Meilensteine: `docs/superpowers/specs/2026-09-21-phase0-phase1-design.md`
- Entscheidungen & Messwerte: `docs/decisions.md`
- Ursprüngliche Spezifikation: `Game_Design_Mouse.md`

## Lizenz
Code: [MIT](LICENSE). Fremde Assets (ab Meilenstein M18, z. B. CC0-Packs von Kenney/KayKit) werden mit Quelle und Lizenz in `ASSETS.md` aufgeführt.
