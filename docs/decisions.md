# Entscheidungen & Befunde

## Tooling-Spike (M0, 2026-09-21)

| Frage | Ergebnis | Beleg / Hinweis |
|---|---|---|
| (a) Zwei Seiten mit echter RTCPeerConnection, Fake-Kamera, ohne STUN | grün | DataChannel-Austausch gelungen (`receivedByA = 'hallo von B'`, `receivedByB = 'hallo von A'`). Mit persistierter Kamera-Erlaubnis (`playwright.config.ts`: `use.permissions: ['camera']`) liefert Chrome ausschließlich echte Adressen (harte Assertion grün): 4 Host-Kandidaten: 2× private IPv4, 1× IPv6-ULA, 1× globale IPv6 – konkrete Adressen bewusst nicht protokolliert (öffentliches Repo). Gegenprobe Test (a2) — frischer Kontext mit `browser.newContext({ permissions: [] })`, also ohne persistierte Erlaubnis (Fake-UI-Flag akzeptiert den Dialog dennoch automatisch): 2 Host-Kandidaten, ausschließlich mDNS-Namen (uuid.local) |
| (b) Offline-Emulation per `context.setOffline` | grün | `fetch('version.json')` liefert `ok:true` → `context.setOffline(true)` → `ok:false` → `context.setOffline(false)` → `ok:true`, wie erwartet |
| (c) WebGL2-Screenshot nicht schwarz (Headless) | grün | Renderer (UNMASKED_RENDERER, unmaskiert): `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`; GPU-Timer-Extension `EXT_disjoint_timer_query_webgl2`: nein (headless liefert `null`) |
| (d) Handy-Chrome per adb + CDP fernsteuern | ausstehend – wartet auf adb-Installation durch den Nutzer | `Get-Command adb` findet nichts im PATH. `scripts/spike-adb-cdp.mjs` ist angelegt (genau wie im Plan), aber nicht ausgeführt. Kein Install-Versuch unternommen (Entscheidung des Controllers). |

**Folgen für die Arbeitsweise:**
(a) Gemessene Regel: eine **persistierte** Kamera-Erlaubnis (`use.permissions: ['camera']` im Playwright-Projekt bzw. `context.grantPermissions(['camera'])`/`browser.newContext({ permissions: [...] })`) hebt Chromes mDNS-Verschleierung auf und liefert echte Host-IPs statt `.local`-Namen; das bloße automatische Akzeptieren des Berechtigungs-Dialogs durch `--use-fake-ui-for-media-stream` genügt dafür **nicht** – ohne persistierte Erlaubnis bleibt es bei mDNS-Namen, obwohl `getUserMedia` erfolgreich auflöst (siehe Gegenprobe Test (a2)). Das deckt sich mit der Phase-0-Design-Regel „Kamera-Lauf ohne Status `granted` ≠ Kamera-Lauf": das Lab-A/B-Testing in M1/M2 muss den tatsächlichen Berechtigungs-Status (z. B. `navigator.permissions.query({ name: 'camera' })`) loggen, nicht nur ob `getUserMedia` aufgerufen wurde. Die reine P2P-Verbindung (Offer/Answer ohne STUN, DataChannel-Nachrichtenaustausch) läuft in beiden Fällen zuverlässig headless.
(b) Offline-Emulation per `context.setOffline` funktioniert sauber und ist für Offline-/PWA-Tests ab Task 7 direkt einsetzbar.
(c) WebGL2-Screenshots sind dank `--enable-unsafe-swiftshader` + `--ignore-gpu-blocklist` auch headless nicht schwarz (Software-Renderer SwiftShader); GPU-Timer-Queries stehen in diesem Headless-Pfad nicht zur Verfügung – Performance-Messungen per `EXT_disjoint_timer_query_webgl2` brauchen echte GPU-Hardware bzw. `headless: false`, nicht die Standard-CI-Konfiguration.
(d) Handy-Fernsteuerung per adb/CDP ist bis zur adb-Installation nicht verifizierbar; Nachholtermin: `node scripts/spike-adb-cdp.mjs` sobald adb installiert und ein autorisiertes Gerät per USB verbunden ist.
Netzwerkadressen aus Test-Annotationen/Reports werden nie ins Repo übernommen (nur Art und Anzahl).
