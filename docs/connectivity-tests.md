# Verbindungstests – Ergebnisse aus dem Testlabor

## Zweck
Sammelstelle für alle Messläufe des Verbindungs-Testlabors (`lab.html`): Selbsttests auf einem Gerät (M1), Sitzung A mit PC-Webcam + Android (M2) und die Zwei-Handy-Matrix F. Aus diesen Einträgen entsteht die Go/No-Go-Notiz für Phase 2 (Mehrspieler). Die Bedeutung der Fehlercodes F1–F9 steht in `docs/decisions.md` („M1 – Testlabor I").

## Regeln
1. **Nur anonymisierte Reports.** Hier landet ausschließlich Text aus den Knöpfen mit dem Zusatz „(anonymisiert)" – z. B. „Beide Reports kopieren (anonymisiert)" oder „Alle Reports kopieren (JSON, anonymisiert)". Dahinter steckt `redactReport` (`src/lab/report.ts`): jede Kandidaten-Adresse wird durch `<familie>/<scope>#n` ersetzt. Reports mit echten Adressen bleiben im `localStorage` des Geräts.
2. **Roh-SDP nie.** „Roh-SDP kopieren" und „Einzel-Report als JSON mit echten Adressen kopieren (nie öffentlich posten)" dienen nur der Fehlersuche am eigenen Gerät. Beide enthalten Adressen, ufrag, pwd und Fingerprint – sie werden nie hier eingefügt und nie committet.
3. **Spitzname statt Gerätename.** Das Feld „Gerät" ist ein frei gewählter Spitzname (1–24 Zeichen, z. B. „Android-Handy", „PC-Webcam") – keine Klarnamen, keine Seriennummern.
4. **Wächter.** Nach jedem Eintrag `npm test` ausführen: `tests/node/privacy-guard.test.ts` schlägt an, falls doch eine echte Adresse hineingeraten ist. Dann den Eintrag korrigieren – nie den Wächter lockern.
5. **Gültigkeit.** Ein Lauf „Kamera aus" mit Berechtigungsstatus `granted` ist **ungültig**; ein Lauf „Kamera an" zählt nur mit Status `granted`. Der Report rechnet das selbst aus (`valid`, `invalidReason`). Ungültige Läufe werden trotzdem eingetragen und als ungültig markiert, damit sichtbar bleibt, was versucht wurde.
6. **Build-ID.** Jeder Eintrag nennt die Build-ID aus dem Report; für die Matrix zählen nur Läufe mit der erwarteten Build-ID.
7. **Handbeobachtungen gehören dazu.** System- und Browser-Dialoge sieht der Report nicht – die testende Person trägt sie von Hand ein, mit Zeitpunkt und Häufigkeit.
8. **Schnellläufe zählen nicht.** Läufe mit `?quick=1` (20 statt 200 Pings je Kanal) sind Testläufe der Entwicklung und gehören nicht in diese Tabellen.

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

## Selbsttest-Ergebnisse
Ein-Gerät-Selbsttest aus `lab.html` („Selbsttest starten"): zwei Verbindungen in einer Seite, zuerst ohne, dann mit Kamera – also zwei Zeilen je Durchgang (Rolle `selbsttest`, Pfad `loopback`, 50 Pings je Kanal).

| Datum | Build-ID | Gerät | Rolle | Hotspot-Besitzer | Kamera | Pfad | gültig? | Kandidaten Familie | Kandidaten Scope | gewähltes Paar | Ping `state` | Ping `events` | Fehlercodes | Dialoge gesehen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
