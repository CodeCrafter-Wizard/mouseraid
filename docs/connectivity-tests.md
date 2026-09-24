# Verbindungstests – Ergebnisse aus dem Testlabor

## Zweck
Sammelstelle für alle Messläufe des Verbindungs-Testlabors (`lab.html`): Selbsttests auf einem Gerät (M1), Sitzung A mit PC-Webcam + Android (M2) und die Zwei-Handy-Matrix F. Aus diesen Einträgen entsteht die Go/No-Go-Notiz für Phase 2 (Mehrspieler). Die Bedeutung der Fehlercodes F1–F9 steht in `docs/decisions.md` („M1 – Testlabor I").

## Regeln
1. **Nur anonymisierte Reports.** Hier landet ausschließlich Text aus den Knöpfen mit dem Zusatz „(anonymisiert)" – z. B. „Beide Reports kopieren (anonymisiert)" oder „Alle Reports kopieren (JSON, anonymisiert)". Dahinter steckt `redactReport` (`src/lab/report.ts`): jede Kandidaten-Adresse wird durch `<familie>/<scope>#n` ersetzt. Reports mit echten Adressen bleiben im `localStorage` des Geräts.
2. **Roh-SDP nie.** „Roh-SDP kopieren" und „Einzel-Report als JSON mit echten Adressen kopieren (nie öffentlich posten)" dienen nur der Fehlersuche am eigenen Gerät. Beide enthalten Adressen, ufrag, pwd und Fingerprint – sie werden nie hier eingefügt und nie committet. **Dasselbe gilt für ein Foto oder einen Screenshot des QR-Codes** (auch vom Bildschirm, der ihn zeigt): der Code ist eine maschinenlesbare Kopie genau dieses Payloads. Belegbilder zeigen den Zustands-Chip oder die Report-Karte, nie die QR-Fläche.
3. **Spitzname statt Gerätename.** Das Feld „Gerät" ist ein frei gewählter Spitzname (1–24 Zeichen, z. B. „Android-Handy", „PC-Webcam") – keine Klarnamen, keine Seriennummern.
4. **Wächter.** Nach jedem Eintrag `npm test` ausführen: `tests/node/privacy-guard.test.ts` schlägt an, falls doch eine echte Adresse hineingeraten ist. Dann den Eintrag korrigieren – nie den Wächter lockern.
5. **Gültigkeit.** Ein Lauf „Kamera aus" mit Berechtigungsstatus `granted` ist **ungültig**; ein Lauf „Kamera an" zählt nur mit Status `granted`. Der Report rechnet das selbst aus (`valid`, `invalidReason`). Ungültige Läufe werden trotzdem eingetragen und als ungültig markiert, damit sichtbar bleibt, was versucht wurde.
6. **Build-ID.** Jeder Eintrag nennt die Build-ID aus dem Report; für die Matrix zählen nur Läufe mit der erwarteten Build-ID.
7. **Handbeobachtungen gehören dazu.** System- und Browser-Dialoge sieht der Report nicht – die testende Person trägt sie von Hand ein, mit Zeitpunkt und Häufigkeit.
8. **Schnellläufe zählen nicht.** Läufe mit `?quick=1` (20 statt 200 Pings je Kanal) sind Testläufe der Entwicklung und gehören nicht in diese Tabellen.
9. **QR-Läufe bringen zwei weitere Tabellen mit.** Ein Lauf mit Pfad `qr` bekommt zusätzlich zur Hauptzeile eine Zeile in „QR und Paarung" – verknüpft über Datum, Gerät und Rolle. Fehlt im Report das Feld `qr` oder `pairing` (alter Build, Lauf ohne QR), steht in der Zeile `–`.
10. **Sperrtest-Läufe sind eigene Zeilen.** Jeder Eintrag in `lockTest.runs[]` wird eine Zeile in „Sperrbildschirm-Test" – drei Zeilen je Durchgang (10 s, 30 s, 60 s). Ein Report ohne `lockTest` liefert keine Zeile.
11. **Handbeobachtungen aus dem Runbook.** Die Notizblätter aus `docs/runbook-zwei-handys.md` (Abschnitt 7) sind die Quelle der Spalten „Dialoge gesehen" und „QR von Hand". Ohne sie ist eine Zeile unvollständig, nicht falsch – dann steht dort `nicht notiert`.

## Vorlage je Lauf
Ein Lauf = eine Tabellenzeile im passenden Abschnitt. Die Werte stehen im anonymisierten Report; die letzte Spalte kommt aus der eigenen Beobachtung. Der vollständige anonymisierte Report-Text darf unter der Tabelle als Codeblock angehängt werden (Überschrift: Datum + Gerät).

| Spalte | Inhalt | Quelle im Report |
|---|---|---|
| Datum | Tag und Uhrzeit des Laufs | `createdAt` |
| Build-ID | Build-ID der getesteten Seite | `buildId` |
| Gerät | Spitzname | `cell.device` |
| Rolle | `host` · `client` · `selbsttest` | `cell.role` |
| Hotspot-Besitzer | `dieses-geraet` · `gegenstelle` · `router` · `unbekannt` | `cell.hotspotOwner` |
| Kamera | Label `an`/`aus` → tatsächlicher Berechtigungsstatus | `cell.camera` → `permissions.camera` |
| Pfad | `text` · `qr` · `broadcast` · `loopback` | `cell.path` |
| gültig? | `ja` oder `nein (Grund)` | `valid`, `invalidReason` |
| Kandidaten Familie | Anzahl je Familie: `ipv4` / `ipv6` / `mdns` / `other` | `gather.gathered[].family` |
| Kandidaten Scope | Anzahl je Scope, nur vorhandene nennen (z. B. `private 2 · ula 1 · global 1`) | `gather.gathered[].scope` |
| gewähltes Paar | Scope lokal → Scope entfernt (z. B. `private → private`) | `selectedPair.localScope`, `selectedPair.remoteScope` |
| Ping `state` | Median / p95 in ms / Verlust in % | `ping.state.medianMs`, `.p95Ms`, `.lossPct` |
| Ping `events` | Median / p95 in ms / Verlust in % | `ping.events.medianMs`, `.p95Ms`, `.lossPct` |
| Fehlercodes | `keine` oder Liste (z. B. `F2`) | `failures` |
| Dialoge gesehen | Kamera-Dialog: nein / ja – wann, wie oft. Dialog „Lokales Netzwerk": nein / ja – wann, wie oft | Handbeobachtung |

Kopiervorlage für eine Ergebnistabelle (Kopfzeile + eine Zeile je Lauf):

| Datum | Build-ID | Gerät | Rolle | Hotspot-Besitzer | Kamera | Pfad | gültig? | Kandidaten Familie | Kandidaten Scope | gewähltes Paar | Ping `state` | Ping `events` | Fehlercodes | Dialoge gesehen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| … | … | … | … | … | … → … | … | … | ipv4 … / ipv6 … / mdns … / other … | … | … → … | … / … ms / … % | … / … ms / … % | … | Kamera: … · Lokales Netzwerk: … |

### Zusatzspalten für QR- und Paarungsläufe (ab M2)
Nur für Läufe mit Pfad `qr`. Die Werte stehen im selben anonymisierten Report wie die Hauptzeile; sie enthalten ausschließlich Zahlen und Aufzählungswerte, nie Text aus einem gescannten Code.

| Spalte | Inhalt | Quelle im Report |
|---|---|---|
| QR-Backend | `native` (eigener `BarcodeDetector`-Pfad) · `worker` (`qr-scanner`) | `qr.backend` |
| QR-Zeichen | Zeichen im Angebots- bzw. Antwort-Payload (`<angebot> / <antwort>`) | `qr.offerChars` / `qr.answerChars` |
| Dekodier-Latenz | ms des **letzten** Scan-Aufrufs, also im Wesentlichen die Dekodierzeit des Treffers – **nicht** die Zeit vom Hinhalten bis zum Treffer (die steht in den Paarungs-Spalten) | `qr.decodeLatencyMs` |
| Versuche | gezählte Einzelbilder bis zum Treffer (`0`, wenn der Report während eines laufenden Scans entstand) | `qr.attempts` |
| Angebot gezeigt → gescannt | ms (beide Marken relativ zum ersten gezeigten Code) | `pairing.offerShownAt` → `pairing.offerScannedMs` |
| Antwort gezeigt → gescannt | ms | `pairing.answerShownAt` → `pairing.answerScannedMs` |
| verbunden nach | ms ab dem ersten gezeigten QR-Code | `pairing.connectedMs` |
| Lobby voll (Hochrechnung) | ms für 3 Clients × 2 Scans | `pairing.projectedLobbyFullMs` |
| QR-Zwischenfälle | Anzahl je Grund, z. B. `scan-timeout 1 · not-a-payload 2`; `–` wenn keiner | Zeitleisten-Einträge `qr:error` und `qr:skipped` (Detail; `qr:skipped` = übersprungener fremder Code, zählt nicht als F9) |
| Rückfall auf Text | `nein` oder `offer` / `answer` | Zeitleisten-Eintrag `qr:fallback-text` |
| Wake Lock | letzter gemeldeter Zustand | Zeitleisten-Eintrag `wakelock:<acquired\|released\|denied\|unsupported>` |
| QR von Hand | traf der Code beim ersten Hinhalten? Nachführen nötig? | Handbeobachtung (Runbook, Abschnitt 7) |

| Datum | Gerät | Rolle | QR-Backend | QR-Zeichen | Dekodier-Latenz | Versuche | Angebot gezeigt → gescannt | Antwort gezeigt → gescannt | verbunden nach | Lobby voll (Hochrechnung) | QR-Zwischenfälle | Rückfall auf Text | Wake Lock | QR von Hand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| … | … | … | … | … / … | … ms | … | … → … ms | … → … ms | … ms | … ms | … | … | … | … |

### Sperrbildschirm-Test (ab M2)
Eine Zeile je Eintrag in `lockTest.runs[]`, also drei Zeilen je vollständigem Durchgang. Nur am Handy aussagekräftig – am PC misst der Test nichts, was es im Spiel gäbe.

| Spalte | Inhalt | Quelle im Report |
|---|---|---|
| geplant | 10 · 30 · 60 (Sekunden) | `lockTest.runs[].plannedSeconds` |
| dunkel | tatsächlich gemessene Dunkelzeit in ms | `lockTest.runs[].hiddenMs` |
| Transport | Zustand vorher → nachher | `lockTest.runs[].transportBefore` → `.transportAfter` |
| Kameraspur | Zustand vorher → nachher (`live` · `muted` · `unmuted` · `ended`) | `lockTest.runs[].trackBefore` → `.trackAfter` |
| Ping danach | je Kanal Median / p95 / Verlust (20 Pings je Kanal); `–`, wenn der Transport beim Entsperren nicht offen war | `lockTest.runs[].pingAfter.events.*` und `….pingAfter.state.*` (`medianMs`, `p95Ms`, `lossPct`) |
| neu verbunden? | `nein` oder `ja` (frisches Angebot auf demselben Platz) | `lockTest.runs[].reconnected` |
| zurück nach | Sekunden bis wieder „verbunden" – nur bei `ja` | Handbeobachtung (Runbook, Abschnitt 5) |

| Datum | Build-ID | Gerät | geplant | dunkel | Transport | Kameraspur | Ping danach | neu verbunden? | zurück nach |
|---|---|---|---|---|---|---|---|---|---|
| … | … | … | … s | … ms | … → … | … → … | … / … ms / … % | … | … s |

## Selbsttest-Ergebnisse
Ein-Gerät-Selbsttest aus `lab.html` („Selbsttest starten"): zwei Verbindungen in einer Seite, zuerst ohne, dann mit Kamera – also zwei Zeilen je Durchgang (Rolle `selbsttest`, Pfad `loopback`, 50 Pings je Kanal).

| Datum | Build-ID | Gerät | Rolle | Hotspot-Besitzer | Kamera | Pfad | gültig? | Kandidaten Familie | Kandidaten Scope | gewähltes Paar | Ping `state` | Ping `events` | Fehlercodes | Dialoge gesehen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Sitzung A – PC-Webcam + Android (M2)
Zwei Geräte nach `docs/runbook-zwei-handys.md`, Abschnitt 3.1 (Zellen A1–A8). Je Lauf eine Zeile in der Haupttabelle; QR-Läufe zusätzlich eine Zeile in „QR und Paarung", der Sperrtest drei Zeilen in „Sperrbildschirm-Test".

| Datum | Build-ID | Gerät | Rolle | Hotspot-Besitzer | Kamera | Pfad | gültig? | Kandidaten Familie | Kandidaten Scope | gewähltes Paar | Ping `state` | Ping `events` | Fehlercodes | Dialoge gesehen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Sitzung A – QR und Paarung

| Datum | Gerät | Rolle | QR-Backend | QR-Zeichen | Dekodier-Latenz | Versuche | Angebot gezeigt → gescannt | Antwort gezeigt → gescannt | verbunden nach | Lobby voll (Hochrechnung) | QR-Zwischenfälle | Rückfall auf Text | Wake Lock | QR von Hand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Sitzung A – Sperrbildschirm-Test

| Datum | Build-ID | Gerät | geplant | dunkel | Transport | Kameraspur | Ping danach | neu verbunden? | zurück nach |
|---|---|---|---|---|---|---|---|---|---|

## Zwei-Handy-Matrix F
Zellen Z1–Z7 aus `docs/runbook-zwei-handys.md`, Abschnitt 3.2 – erst durchführbar, wenn ein zweites Handy geliehen ist. Aus dieser Tabelle und der Go/No-Go-Liste des Runbooks (Abschnitt 10) entsteht die Notiz für Phase 2.

| Datum | Build-ID | Gerät | Rolle | Hotspot-Besitzer | Kamera | Pfad | gültig? | Kandidaten Familie | Kandidaten Scope | gewähltes Paar | Ping `state` | Ping `events` | Fehlercodes | Dialoge gesehen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Matrix F – QR und Paarung

| Datum | Gerät | Rolle | QR-Backend | QR-Zeichen | Dekodier-Latenz | Versuche | Angebot gezeigt → gescannt | Antwort gezeigt → gescannt | verbunden nach | Lobby voll (Hochrechnung) | QR-Zwischenfälle | Rückfall auf Text | Wake Lock | QR von Hand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Matrix F – Sperrbildschirm-Test

| Datum | Build-ID | Gerät | geplant | dunkel | Transport | Kameraspur | Ping danach | neu verbunden? | zurück nach |
|---|---|---|---|---|---|---|---|---|---|

### Nicht testbare Zellen
Die Begründungen stehen in `docs/runbook-zwei-handys.md`, Abschnitt 3.3. Eine Zelle wird hier erst eingetragen, wenn sie **nicht mehr** „nicht testbar" ist.

| Zelle | Grund | seit wann testbar? |
|---|---|---|
| Kamera aus × QR-Pfad | Bauart: der QR-Pfad öffnet die Kamera selbst | nie (kein Ausweg nötig) |
| nativer `BarcodeDetector` am PC | API auf Windows/Linux nicht vorhanden | offen |
| nativer `BarcodeDetector` in Safari/iOS | nur hinter Feature-Flag, auf iOS defekt | offen |
| Firefox mit „Kamera an" | `permissions.query({ name: 'camera' })` fehlt → Lauf ungültig | offen |
| Wake Lock in installierter iOS-Web-App | wirkungslos unter iOS 18.4 | ab iOS 18.4 |
| alle iPhone-Zellen | kein iPhone im Gerätepark | sobald eines geliehen ist |
