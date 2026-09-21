# Projekt: „Mäusebau“ (Arbeitstitel) – 3D-Koop-Survival im Browser

> Diese Datei ist die Spezifikation für Claude Code. Abschnitt 1–7: Technik und Architektur.
> Abschnitt 8: Spielkonzept. Abschnitt 9: Annahmen, die noch bestätigt werden müssen.

## 1. Ziele & Anforderungen

- **3D-Koop-Spiel in Echtzeit** für **1–4 Spieler** (kooperativ, nicht gegeneinander)
- Läuft auf **möglichst jedem Gerät**: Android, iPhone, Tablet, PC – im Browser, ohne App Store
- **Offline spielbar ist ein Muss**: Unterwegs ohne Internet, z. B. über den Hotspot eines Handys
- Einfacher Start: Webseite öffnen → „Zum Startbildschirm hinzufügen“ → ab dann auch offline startbar
- Spieler verbinden sich per **QR-Code**, ohne Accounts und ohne Server
- Fortschritt (Kolonie, Skills, Bau) wird **lokal gespeichert** und über viele Sitzungen ausgebaut
- **Später:** PC-Modus – der PC zeigt das Spiel, die Handys dienen als Controller

## 2. Tech-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | **TypeScript** (strict) | Typsicherheit, gut für Netzwerk-Nachrichten und Spieldaten |
| Build | **Vite** | Schnell, einfache PWA-Integration |
| 3D-Engine | **Babylon.js** (`@babylonjs/core`, tree-shakable Imports) | Vollständige 3D-Engine, gute Mobile-Unterstützung, Touch-Input, glTF-Loader |
| Charakter-Bewegung | Kinematischer Character-Controller (`moveWithCollisions` oder Havok Character Controller) | Reicht für Maus, Katze, Ratten; deterministischer als Vollphysik |
| Physik (optional) | **Havok** (`@babylonjs/havok`, WASM) | Nur falls für Fahrzeuge/Props nötig; WASM muss für Offline gecacht werden |
| KI-Navigation | **Recast/Detour** (`recast-detour` + Babylon `RecastJSPlugin`) | Navmesh für Katze und Ratten, Crowd-Agents |
| PWA / Offline | **vite-plugin-pwa** (Workbox) | Service Worker, Precaching aller Assets |
| Netzwerk | **WebRTC DataChannels** (native Browser-API) | Direkte Verbindung Gerät↔Gerät, funktioniert im lokalen Netz ohne Internet |
| QR-Code anzeigen | `qrcode` | |
| QR-Code scannen | `qr-scanner` (nimiq) | Läuft auch in iOS Safari (native `BarcodeDetector` fehlt dort) |
| Kompression Signaling | `CompressionStream('deflate-raw')` + Base64URL | SDP muss in einen QR-Code passen |
| Speicherstände | **IndexedDB** (via `idb`) | Größere Saves als localStorage, offline, versioniertes Schema |
| Spieldaten | JSON in `src/data/` (Rezepte, Skilltree, Loot-Tabellen, Balancing) | Datengetrieben, ohne Codeänderung anpassbar |
| Tests | **Vitest** | Für Spiellogik, Serialisierung, Save-Migration |

**Keine** Abhängigkeit von externen Servern im Offline-Modus. Keine Nutzung von Web Bluetooth (Browser können nicht als Bluetooth-Gegenstelle agieren, iOS Safari unterstützt es nicht).

**Assets:** Zuerst Platzhalter (Babylon-Primitive, Farbflächen), dann Low-Poly-glTF-Modelle. Nur Assets mit klarer Lizenz verwenden (z. B. CC0-Packs wie Kenney). Lizenzen in `ASSETS.md` dokumentieren.

## 3. Architektur

### 3.1 Grundprinzip: Strikte Schichtentrennung

```
src/
  core/        # Reine Spiellogik & Simulation (KEIN Babylon, KEIN DOM) – deterministisch, testbar
    world/     # Level, Räume, Plattformen, Verstecke, Lernstationen
    entities/  # Maus (Spieler), Katze, Ratten, NPC-Mäuse, Fahrzeuge
    systems/   # Tag/Nacht, Loot, Inventar, Crafting, Skills, Kolonie, Ratteninvasion
    save/      # Save-Schema, Serialisierung, Migrationen
  data/        # JSON: Rezepte, Skilltree, Loot-Tabellen, Level-Definitionen, Balancing
  net/         # Transport (WebRTC), Signaling (QR / optional online), Nachrichten-Protokoll
  render/      # Babylon.js-Szene, liest nur den Spielzustand
  input/       # Touch, Tastatur, Gamepad, Remote-Controller → einheitliche InputFrames
  ui/          # Menüs, Lobby, QR-Screens, HUD (Sonar, Inventar), Bau-Verwaltung (HTML/CSS über dem Canvas)
  modes/       # Solo, Host, Client, später PC-Host + Controller
```

- `core` weiß nichts von Grafik oder Netzwerk. Es bekommt Inputs pro Tick und liefert einen neuen Zustand.
- Dieselbe Simulation läuft im Solo-Modus, beim Host und (für Vorhersage) beim Client.
- Das macht später den PC-Modus fast gratis: Der PC ist einfach ein Host ohne eigenen lokalen Spieler.
- Balancing-Werte (Zykluslänge, Loot-Mengen, Skill-Kosten) ausschließlich in `src/data/`, nie hartkodiert.

### 3.2 Netzwerk-Topologie

- **Stern-Topologie, Host-autoritativ**: Ein Gerät ist Host und führt die maßgebliche Simulation aus. Bis zu 3 Clients verbinden sich jeweils direkt mit dem Host.
- Pro Client zwei DataChannels:
  - `state` – **unzuverlässig & ungeordnet** (`ordered: false, maxRetransmits: 0`) für schnelle Zustände (Positionen von Spielern, Katze, Ratten, Fahrzeugen) und Inputs
  - `events` – **zuverlässig & geordnet** für Lobby, Spielstart, langsame Zustände (Inventar, Crafting, Skills, Kolonie, Tageswechsel) und Ereignisse (Treffer, gefangen, Invasion)
- Koop: keine Anti-Cheat-Maßnahmen nötig. Verlässt der Host, endet die Sitzung (keine Host-Migration). Der Spielstand liegt beim Host.

### 3.3 Verbindungsaufbau (Signaling) – offline per QR-Code

WebRTC braucht zum Verbindungsaufbau einen Austausch von „Offer“ und „Answer“. Ohne Server geschieht das per QR-Code:

1. Alle Geräte sind im selben WLAN oder im **Hotspot** eines der Handys (Internet nicht nötig).
2. Host tippt „Spiel erstellen“ → „Spieler hinzufügen“ → zeigt **QR-Code A** (komprimiertes Offer).
3. Client scannt QR A → zeigt **QR-Code B** (komprimiertes Answer).
4. Host scannt QR B → Verbindung steht. Für jeden weiteren Spieler wiederholen.

Umsetzungshinweise:
- **Kein STUN/TURN** im Offline-Modus (`iceServers: []`), nur lokale Host-Kandidaten.
- **Vollständiges ICE-Gathering abwarten** (kein Trickle ICE), dann SDP komprimieren.
- SDP vor dem Komprimieren **minimieren**: unnötige Zeilen entfernen, nur benötigte Felder übertragen und auf der Gegenseite rekonstruieren. Ziel: QR-Code gut scanbar (< ~800 Zeichen).
- Browser verschleiern lokale IP-Adressen oft über mDNS (`xxxx.local`). Das muss im Hotspot-Szenario getestet werden (siehe Risiken).
- Fallback, falls QR-Scannen nicht klappt: Code als Text kopieren/teilen können.

**Optionaler Online-Modus (später):** Wenn Internet vorhanden ist, Signaling über einen Raumcode (z. B. PeerJS oder eigener kleiner WebSocket-Server). Das Signaling ist hinter einem Interface `SignalingProvider` versteckt, damit beide Varianten austauschbar sind.

### 3.4 Netcode für Echtzeit

- Feste Simulationsrate: **30 Ticks/s** (`core` rechnet mit festem Zeitschritt, unabhängig von der Bildrate).
- Clients senden **Inputs** (nicht Positionen) jeden Tick mit Sequenznummer.
- Host sendet **Snapshots** der schnellen Zustände mit 20–30 Hz, kompakt als Binärformat (`ArrayBuffer`/`DataView`), nicht als JSON. Nur Entities in der Nähe/im selben Raum des Clients (Interest Management), damit Ratten-Wellen nicht die Bandbreite sprengen.
- Langsame Zustände (Inventar, Kolonie, Skills) nur bei Änderung als zuverlässiges Event, plus vollständiger Abgleich bei Verbindungsaufbau.
- Client:
  - **Eigene Maus**: Client-seitige Vorhersage + Abgleich (Reconciliation) mit dem Host-Snapshot
  - **Andere Spieler, Katze, Ratten**: Interpolation mit ~100 ms Verzögerung zwischen zwei Snapshots
  - **Fahrzeug mit zwei Spielern**: Fahrer sagt Bewegung vorher, Schütze wird auf dem Fahrzeug mitbewegt
- Ping/Latenz messen und in einem Debug-Overlay anzeigen.
- Verbindungsabbruch erkennen (Heartbeat); Client kann in derselben Sitzung neu beitreten (Reconnect), seine Maus wird bis dahin vom Host pausiert/im Versteck geparkt.

### 3.5 Rendering & Performance (Mobile first)

- Zielwert: **stabile 60 fps auf Mittelklasse-Handys**, mindestens 30 fps auf älteren Geräten.
- Low-Poly-Stil, wenige Lichter, gebackene Beleuchtung wo möglich, Texturen komprimiert (KTX2).
- **Tag-Nacht-Zyklus günstig umsetzen:** ein Directional Light + Ambient/Hemispheric Light, deren Farbe und Intensität zwischen Presets (Tag, Dämmerung, Nacht mit Notbeleuchtung/Straßenlaterne durch das Schaufenster) interpoliert wird. Keine Echtzeit-Schatten auf Mobile; Blob-Schatten unter Figuren.
- Instancing für wiederholte Objekte (Dosen, Flaschen, Käselaibe, Ratten), `scene.freezeActiveMeshes()` wo sinnvoll.
- Hardware-Skalierung (`engine.setHardwareScalingLevel`) je nach Gerät automatisch anpassen.
- Qualitätsstufen im Menü: niedrig / mittel / hoch.
- Bei Tab-Wechsel / App im Hintergrund: Rendering pausieren, Host informiert Clients.

### 3.6 Eingabe

- **Touch**: virtueller Joystick (links) + Kontext-Buttons (rechts: Interagieren/Looten, Verstecken, Sprinten, später Klettern/Angreifen), querformatoptimiert
- **Tastatur/Maus** am PC
- **Gamepad API** (Bluetooth-Controller am Handy/PC funktionieren im Browser)
- Alle Eingaben werden zu einem einheitlichen `InputFrame` normalisiert.
- Ein **kontextsensitiver Aktionsbutton** („Interagieren“) deckt Looten, Lernen, Verstecken, Einsteigen ab, damit auf dem Handy wenige Buttons reichen.

### 3.7 PWA & Offline

- Alle Assets (JS, WASM, Modelle, Texturen, Sounds) werden beim ersten Besuch **precached**.
- Manifest mit `display: "fullscreen"`, `orientation: "landscape"`, Icons.
- Hinweis-Screen für iPhone: „Teilen → Zum Home-Bildschirm“.
- Bildschirm wach halten mit der **Screen Wake Lock API**.
- Versionierung: Host und Clients tauschen beim Verbinden die Spielversion aus, bei Abweichung Hinweis zum Aktualisieren.
- Hosting: statisch über HTTPS (z. B. GitHub Pages, Netlify, Cloudflare Pages). HTTPS ist Pflicht für Service Worker und Kamera.

### 3.8 Speicherstände

- Ein Speicherstand = eine **Kolonie** (Bau, Lager, NPC-Mäuse, freigeschaltete Räume/Tunnel/Level, Tageszähler, Garten) inklusive der Spieler-Mäuse (Skills, Tragekapazität).
- Im Koop liegt der Speicherstand beim **Host**; Gäste spielen mit Mäusen aus der Kolonie des Hosts (siehe Annahmen).
- **Autosave** bei jedem Tagesanbruch und beim Verlassen; mehrere Slots.
- Save-Schema mit `version`-Feld und Migrationsfunktionen; Tests für jede Migration.
- Export/Import als Datei (JSON), damit Spielstände zwischen Geräten übertragen werden können.

## 4. PC-Modus (spätere Phase)

- Der PC ist Host und zeigt das Spiel (gemeinsame Kamera, die alle Mäuse im Bild hält; Splitscreen über Babylon-Viewports als Option).
- Handys öffnen eine **Controller-Seite** (`/controller`) der gleichen PWA und senden nur Inputs.
- Die Verbindung nutzt dieselbe `net`-Schicht. Offline-Problem: Viele PCs haben keine Kamera zum Scannen des Answer-QR-Codes. Lösungsoptionen, die zu prüfen sind:
  - kleiner lokaler Signaling-Server, der auf dem PC läuft (`npm run couch`), Handys verbinden sich per QR-Code-Link mit dem PC
  - oder Online-Signaling, wenn Internet vorhanden ist
- Controller-Seite: großflächige Touch-Buttons, Vibration als Feedback (`navigator.vibrate`, nur Android).

## 5. Meilensteine

**Phase 0 – Technischer Machbarkeitstest (ZUERST!)**
Minimale Seite ohne Spiel: zwei Handys, Hotspot ohne Internet, QR-Offer/Answer-Austausch, DataChannel sendet Pings hin und her, Latenz wird angezeigt.
Testen mit: Android↔Android, iPhone↔iPhone, Android↔iPhone, jeweils mit Android-Hotspot und iPhone-Hotspot.
→ Ergebnisse in `docs/connectivity-tests.md` dokumentieren. Erst danach weiterbauen.

**Phase 1 – Solo Vertical Slice („Eine Nacht im Feinkostladen“)**
Feinkostladen (ein Raum) + Mäusebau (ein Raum), Maus mit Third-Person-Kamera (Touch + Tastatur), Tag-Nacht-Zyklus, Katze mit Patrouille/Verfolgung, Verstecken in Topfpflanzen, Sonar-HUD, Reste looten, Körperinventar mit 3 Plätzen, Lager im Bau, Speichern/Laden, PWA offline-fähig.
→ Ziel: Der Kern (Schleichen, Looten, Katze) macht allein schon Spaß.

**Phase 2 – Koop auf dem Vertical Slice (2–4 Handys)**
Lobby, QR-Verbindungsaufbau, Host-autoritative Simulation, Vorhersage & Interpolation, Reconnect. Alle Spieler looten gemeinsam eine Nacht.

**Phase 3 – Aufbau-Systeme**
Skilltree + Lernstationen, Fitnessstudio (Tragekapazität, Klettern), Tunnel graben → Plattformen in Regalen, Crafting (Werkstatt), NPC-Mäuse mit Rollen, Kochmäuse/Nahrungsverwaltung, Wollknäuel gegen die Katze, Dosen öffnen.

**Phase 4 – Ratteninvasion**
Wellen alle 7 Tage aus der Toilette, Verteidigung mit Waffen, Kämpfermäuse, chemische Waffen (Labor), Fahrzeug für zwei Spieler (Fahrer + Schütze).

**Phase 5 – Inhalte**
Nachbarläden (Kleidungsgeschäft, weitere), Garten mit Dekoration, weitere Level bis zum Finale in der Bank (Tresor mit Parmesanrad und Serrano-Schinken).

**Phase 6 – PC-Modus mit Handys als Controller**

**Phase 7 (optional)**
Online-Signaling per Raumcode, Verpacken als native App mit **Capacitor**, falls die Browser-Verbindung offline auf bestimmten Geräten nicht zuverlässig funktioniert.

## 6. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| WebRTC findet sich im Hotspot ohne Internet nicht (mDNS-Verschleierung, Client-Isolation im Hotspot) | Phase 0 zuerst. Plan B: Kamera-Berechtigung (für QR-Scan) kann die Verschleierung in manchen Browsern aufheben; Plan C: native Verpackung mit Capacitor |
| QR-Code zu groß | SDP minimieren und komprimieren, notfalls auf zwei QR-Codes aufteilen |
| Leistung auf schwachen Handys (Ratten-Wellen, dynamisches Licht) | Qualitätsstufen, Low-Poly, Instancing, Wellen-Größe begrenzen, früh auf echten Geräten testen |
| iOS-Safari-Eigenheiten (Audio erst nach Nutzerinteraktion, kein Vollbild-API im Browser, Speicherlimit) | Früh auf iPhone testen; Audio erst nach Tippen starten |
| Umfang: viele Systeme (Kolonie, Crafting, Skills, Invasion, Fahrzeuge, Garten) | Strikt nach Phasen bauen; jede Phase ist für sich spielbar; Balancing datengetrieben |
| Kamera in engen Innenräumen (Regale, Wände) | Kamera-Kollision (Babylon `checkCollisions` an der Kamera), Wände zwischen Kamera und Maus ausblenden/transparent |

## 7. Arbeitsweise für Claude Code

- Kleine, lauffähige Schritte; nach jedem Meilenstein funktioniert das Projekt.
- `core` mit Vitest-Tests abdecken, besonders Serialisierung der Netzwerk-Nachrichten, Simulationsschritte, Crafting/Skills und Save-Migrationen.
- Netzwerk-Nachrichten zentral in `src/net/protocol.ts` definieren, mit Versionsnummer.
- Lokales Testen mehrerer Spieler: Entwicklungsmodus, in dem mehrere Browser-Tabs sich über einen `BroadcastChannel`-Transport verbinden (gleiches Interface wie WebRTC).
- Für Tests auf echten Handys: `vite --host` mit HTTPS (`@vitejs/plugin-basic-ssl`).
- Debug-Overlay (fps, Ping, Tickrate, Paketverlust, Katzen-Zustand, Tageszeit) per Taste/Geste einblendbar; Debug-Befehle (Zeit vorspulen, Loot geben, Invasion auslösen).
- UI-Texte auf Deutsch, aber alle Strings in `src/ui/strings.ts`, damit später Übersetzungen möglich sind.

## 8. Spielkonzept

### 8.1 Kurzbeschreibung

Ein kooperatives 3D-Survival-Spiel für 1–4 Spieler. Die Spieler sind Mäuse, die in der Wand eines portugiesischen Feinkostladens leben. Nachts, wenn keine Kunden mehr da sind, schleichen sie durch den Laden und looten Käse, Portwein und Fischkonserven, während die Ladenkatze Jagd auf sie macht. Tagsüber bauen sie ihren Mäusebau aus, lernen Fähigkeiten, stellen Werkzeuge und Waffen her und bereiten sich auf die Ratteninvasion vor, die alle sieben Tage aus der Toilette kommt. Über Tunnel erschließen sie nach und nach die Nachbarläden, bis sie am Ende den Tresor der Bank knacken, in dem ein riesiges Parmesanrad und ein Serrano-Schinken lagern.

**Vorbild für Grafikstil und Aufbau:** *Endling – Extinction is Forever* (stilisierte 3D-Optik, Kamera hinter dem Tier, Bau als Zuhause, nächtliche Beutezüge). **Aber:** Die Stimmung ist deutlich **fröhlicher und nicht endzeitlich** – ein charmantes Mäuse-Abenteuer, kein düsteres Überlebensdrama. Und: keine vorgegebenen 2D-Laufwege, sondern eine **offene 3D-Map** mit freier Bewegung.

**Genre-Bausteine:** Third-Person-Stealth (Nacht) + Basisbau/Kolonie-Verwaltung (Tag) + Crafting + Skilltree + wellenbasierte Verteidigung (alle 7 Tage).

### 8.2 Kernschleife: Tag und Nacht

- Ein voller Tag-Nacht-Zyklus dauert **10 Minuten** (Wert in `src/data/balance.json`, Vorschlag: Nacht ≈ 5 min, Tag ≈ 5 min). Man kann aber den Tag / Nacht auch manuell beenden.
- **Nacht = Beutezug:** Laden ist leer, Katze ist wach und patrouilliert. Spieler verlassen den Bau, looten Lebensmittel und Fundstücke, lernen an Lernstationen, kehren zum Bau zurück.
- **Tag = Bauphase:** Kunden sind im Laden, die Spieler sind im Bau. Sie verwalten Lager, Crafting, NPC-Mäuse, Fitnessstudio, Garten. Sind alle Spieler bereit, kann der Tag übersprungen werden („Schlafen bis zur Nacht“).
- Der **Tageszähler** läuft weiter; jeder 7. Tag ist Invasionstag (siehe 8.11).
- Die Kolonie **verbraucht täglich Nahrung** (Vorschlag: abhängig von der Anzahl der Mäuse). Ohne Vorrat werden die Mäuse schwächer (siehe Annahmen).

### 8.3 Spielfigur, Kamera und Steuerung

- Jeder Spieler steuert **eine Maus** aus der Kolonie.
- **Kamera:** Third-Person, hinter und leicht über der Maus, die Maus ist immer sichtbar (kein Ego-Shooter). Kamera folgt weich, kollidiert mit Wänden, Wände zwischen Kamera und Maus werden transparent.
- **Startfähigkeiten:** nur **Rennen** und **Verstecken**. Alles Weitere (Klettern, Waffen benutzen, Dosen öffnen, mehr tragen) wird gelernt.
- **Verstecken:** In jedem Raum stehen **Topfpflanzen**; darin ist die Maus für die Katze unsichtbar. Später auch weitere Verstecke (unter Regalen, in Kisten).
- **Klettern:** Nach Freischaltung kann die Maus an markierten Stellen (Kabel, Stoff, Regalkanten) hochklettern. Plattformen in den Regalen sind auch über Tunnel erreichbar, die Bauernmäuse graben.

### 8.4 Der Gegner: die Katze

- Lebt im Laden, ist nachts wach und will die Mäuse fangen und töten.
- **Zustände:** Schlafen → Patrouillieren → Aufmerksam (Geräusch/kurzer Sichtkontakt) → Verfolgen → Abgelenkt (Wollknäuel) → Fressen/Schlafen.
- **Wahrnehmung:** Sichtkegel und Hören (Rennen ist laut, Schleichen leise, fallende Gegenstände locken sie an).
- **Sonar-HUD:** Ein Kompass-Ring am Bildschirmrand zeigt an, in welcher **Himmelsrichtung im Raum** sich die Katze befindet (weltfest: N/O/S/W des Raums). Je näher die Katze, desto schneller pulsiert das Sonar. Nur nachts aktiv.
- **Ablenkung:** Wollknäuel (aus Textilien gecraftet) werfen → Katze spielt eine Zeit lang damit.
- **Ressource:** Aus dem **Katzenklo** lassen sich Exkremente sammeln, die im Labor zu **chemischen Waffen** gegen Ratten verarbeitet werden.

### 8.5 Welt und Level

- **Level 1: Feinkostladen in Portugal.** Verkauft Fischkonserven, Käse und Portwein. Regale, Theke, Kühlvitrine, Schaufenster, Lagerraum, Toilette (Rattenzugang), Katzenklo, Topfpflanzen.
- **Der Mäusebau** liegt in der Wand des Ladens und ist der Hub. Räume werden nach und nach freigeschaltet: Lager/Küche, Werkstatt, Labor, Fitnessstudio, Garten, Schlafplätze.
- **Tunnel und Plattformen:** Bauernmäuse graben Gänge zu **Plattformen in den Regalen**. Von dort hat man Überblick über den Laden und kommt leichter an Loot. Tunnel kosten Zeit und ggf. Ressourcen.
- **Nachbarläden erschließen:** Über Tunnel werden angrenzende Geschäfte zugänglich, z. B. ein **Kleidungsgeschäft** (Kleiderbügel, Stoff). Jedes Geschäft bringt neue Ressourcen, eigene Gefahren und Lernstationen.
- **Finale: die Bank.** Letztes Level; der Tresor enthält ein riesiges Parmesanrad und einen Serrano-Schinken. Wird er geöffnet, ist das Spiel gewonnen.
- Level sind als Daten in `src/data/levels/*.json` definiert: Räume, Loot-Spawns, Verstecke, Kletterstellen, Plattformen, Lernstationen, Katzen-Patrouillenpunkte, Rattenzugang.

### 8.6 Looten und Ressourcen

| Kategorie | Beispiele | Fundort | Verwendung |
|---|---|---|---|
| Lebensmittel | Käse, Portwein, Fischkonserven, Essensreste | Feinkostladen | Nahrung für die Kolonie; Dosen erst nach Skill „Dosen öffnen“ nutzbar, vorher nur Reste |
| Fundstücke/Müll | Kronkorken, Weinkorken, Dinge, die Kunden verlieren | Alle Läden | Crafting-Material |
| Textilien | Stoff, Kleiderbügel, Wolle | Kleidungsgeschäft | Wollknäuel (Ablenkung), Waffen |
| Werkzeuge | Gabeln, Messer | Feinkostladen | Lanzen, Speere, Nahkampfwaffen |
| Katzen-Exkremente | aus dem Katzenklo | Feinkostladen | Chemische Waffen (Labor) |
| Garten-Material | Pilze, Moos | Bau/Läden | Garten anpflanzen |

- Loot respawnt zu jedem Tagesanbruch (Laden wird nachgefüllt), Mengen in Loot-Tabellen.

### 8.7 Inventar

- **Körperinventar:** Anfangs **3 Plätze**. Mehr Plätze durch Training im Fitnessstudio (Stärke).
- **Bau-Inventar (Lager):** Alles, was in den Bau gebracht wird, landet im Lager. Öffnen per Taste/Button, gemeinsam für alle Spieler.
- Lebensmittel werden von den **Kochmäusen** verwaltet (Vorratsanzeige, Haltbarkeit optional).
- Wird eine Maus von der Katze gefangen, gehen die **getragenen Items verloren** (siehe Annahmen).

### 8.8 Der Mäusebau und die Kolonie

Die Spieler sind Teil eines ganzen Mäuserudels. **NPC-Mäuse** haben Rollen entsprechend ihren Fähigkeiten:

| Rolle | Aufgabe | Voraussetzung |
|---|---|---|
| Bauernmäuse | Graben Tunnel zu Plattformen und Nachbarläden | – |
| Handwerkermäuse | Arbeiten in der Werkstatt, stellen Werkzeuge, Waffen, Fahrzeuge her | Werkstatt freigeschaltet |
| Intelligente Mäuse | Arbeiten im Labor (chemische Waffen, Forschung) | Labor freigeschaltet |
| Kochmäuse | Verwalten die gelooteten Lebensmittel | Küche/Lager |
| Kämpfermäuse | Besonders geschickte Mäuse; kämpfen mit Messern, Gabeln und gebauten Waffen an der Seite der Spieler gegen die Ratten | Ausbildung/Skill |

- NPC-Mäuse werden nicht frei simuliert, sondern als **Jobs mit Timern** abgebildet (z. B. „Tunnel zu Regal 3: 2 Tage“). Im Bau sind sie sichtbar und animiert, aber ohne eigene Pfadfindung.
- **Räume im Bau:**
  - **Lager/Küche** – Vorräte, Nahrungsverbrauch
  - **Werkstatt** – Crafting-Station
  - **Labor** – chemische Waffen, evtl. Forschung
  - **Fitnessstudio** – Mausefallen als Push-up-Geräte, Seile zum Hangeln → Stärke (Tragekapazität) und Geschicklichkeit (Klettern)
  - **Garten** – frei gestaltbarer Raum, nur zum Spaß: Pilze und Moos anpflanzen, Dekoration wie Bänke und Laternen freischalten und platzieren (Raster-Platzierung)

### 8.9 Skilltree und Lernen

- Jede Spieler-Maus hat einen **Skilltree**. Skills werden an **Lernstationen** in den Läden gelernt (z. B. Klettern an einem Kabel, Waffen benutzen an einer Gabel, Dosen öffnen an einer Dose) und im **Fitnessstudio** trainiert.
- Beispiel-Skills (Definition in `src/data/skills.json`):
  - Rennen, Verstecken (Start)
  - Klettern I–III (Regale, Kabel, Vorhänge)
  - Dosen öffnen
  - Waffen benutzen (Nahkampf), später Fahrzeug fahren, Fahrzeug-Geschütz
  - Stärke I–III (Tragekapazität 3 → 5 → 8)
  - Schleichen (leiser für die Katze)
- Lernen kostet Zeit an der Station (Risiko: Katze) und ggf. Ressourcen; Training im Fitnessstudio kostet Tageszeit.

### 8.10 Crafting

Rezepte in `src/data/recipes.json` (Zutaten → Ergebnis, Station, Dauer). Startset:

| Ergebnis | Zutaten | Station | Zweck |
|---|---|---|---|
| Wollknäuel | Stoff/Wolle | Werkstatt | Katze ablenken |
| Lanze / Speer | Gabel + Kleiderbügel/Stoff | Werkstatt | Nahkampf gegen Ratten |
| Messerwaffe | Messer + Griff (Kork) | Werkstatt | Kämpfermäuse ausrüsten |
| Auto (2 Sitze) | Kronkorken (Räder) + Korken + Kleiderbügel + … | Werkstatt (Handwerkermäuse) | Fahrer + Schütze bei der Invasion |
| Chemische Waffe | Katzen-Exkremente + Behälter | Labor | Flächenschaden/Abwehr gegen Ratten |
| Gartendeko (Bank, Laterne) | Kork, Kronkorken, Stoff | Werkstatt | Garten |

### 8.11 Ratteninvasion (alle 7 Tage)

- Am Ende jedes 7. Tages kommen **Ratten aus der Toilette** des Feinkostladens. Ziel der Ratten: das Lager der Kolonie plündern.
- Die Spieler verteidigen mit Nahkampfwaffen, chemischen Waffen und dem **Auto**: eine Maus fährt, eine schießt (Koop-Moment). Im Solo-Modus übernimmt eine Kämpfermaus den zweiten Sitz.
- **Kämpfermäuse** (NPC) kämpfen mit, wenn ausgebildet und ausgerüstet.
- Wellenstärke wächst mit dem Tageszähler. Verlorene Invasion = Verlust von Vorräten und verletzte Mäuse, kein Game Over (siehe Annahmen).
- Vorwarnung im HUD ab Tag 6 („Die Ratten kommen morgen“).

### 8.12 Koop: Was die Spieler gemeinsam tun

- Gemeinsam looten und sich gegenseitig decken (einer lockt die Katze mit Wollknäuel, andere plündern).
- Aufgaben im Bau parallel erledigen (einer trainiert, einer craftet, einer gärtnert).
- Fahrzeug mit zwei Rollen bei der Invasion.
- Gefangene Mitspieler können nicht gerettet werden, sie kehren zur nächsten Nacht in den Bau zurück (siehe Annahmen).
- Es gibt keinen Wettbewerb zwischen den Spielern: geteiltes Lager, geteilter Fortschritt der Kolonie, individuelle Skills pro Maus.

### 8.13 Spielende

Das Spiel ist gewonnen, wenn das letzte Level (die Bank) erreicht und der **Tresor** geöffnet wurde. Danach freies Weiterspielen in der Kolonie.

### 8.14 Grafikstil und Stimmung

- **Grafikstil an Endling orientiert:** stilisiertes Low-Poly, weiche Formen, malerische Farbflächen, atmosphärisches Licht – aber mit hellerer, wärmerer Palette.
- Stimmungsvolle, aber freundliche Nachtszenen (Straßenlaterne durchs Schaufenster, warmes Glimmen der Kühlvitrine, Mondlicht).
- Maus-Perspektive: alles wirkt riesig (Weinflaschen wie Türme, Regale wie Hochhäuser).
- **Stimmung: fröhlich und charmant**, kein Endzeit-Gefühl. Die Katze ist ein spannender Gegner, aber das Spiel bleibt leichtherzig und humorvoll (Mausefallen als Fitnessgeräte, Autos aus Kronkorken). Der Bau ist gemütlich, der Laden ist der Abenteuerspielplatz.
- Sound: Katze schnurrt/faucht als Richtungshinweis (ergänzt das Sonar), leises Trippeln der Maus, Ambience des Ladens.

## 9. Annahmen und offene Fragen

Diese Punkte wurden im Konzept nicht festgelegt. Claude Code setzt die Annahme um, bis etwas anderes entschieden wird. Alle Werte in `src/data/balance.json`.

| Thema | Annahme | Alternative |
|---|---|---|
| Was passiert tagsüber im Laden? | Spieler bleiben im Bau (Bauphase). Wer bei Tagesanbruch noch draußen ist, wird automatisch in den Bau „zurückgezogen“ und verliert getragene Items. | Laden auch tagsüber betretbar, aber mit Kunden/Ladenbesitzer als zusätzlicher Gefahr |
| Tod durch die Katze | Maus verliert die getragenen Items und wacht zur nächsten Nacht im Bau auf. Kein permanenter Verlust. | Permadeath der Maus, Spieler übernimmt eine neue Maus aus der Kolonie |
| Nahrungsverbrauch | Kolonie verbraucht täglich Nahrung. Bei leerem Lager: Mäuse werden schwächer (langsamer, weniger Tragekraft), NPC-Jobs pausieren. Kein Game Over. | Game Over bei Hungertod |
| Invasion verloren | Ratten plündern einen Teil des Lagers, Kämpfermäuse sind einige Tage verletzt. | Game Over |
| Anzahl Level | Ca. 5: Feinkostladen → Kleidungsgeschäft → 2–3 weitere Läden (z. B. Bäckerei, Eisenwarenladen, Apotheke) → Bank | Weniger/mehr Level |
| Speicherstand im Koop | Nur der Host speichert. Gäste bekommen beim Beitritt eine Maus aus der Kolonie des Hosts (mit deren Skills). | Jeder Spieler bringt seine eigene Maus mit eigenem Skilltree mit (komplexer) |
| Beitritt mitten im Spiel | Nicht möglich; alle Spieler treten in der Lobby bei. Reconnect derselben Spieler ist möglich. | Late Join |
| Fahrzeug im Solo-Modus | Eine Kämpfermaus übernimmt den zweiten Sitz (KI schießt automatisch). | Fahrzeug nur im Koop |
| Zyklus-Aufteilung | Nacht 2,5 min, Tag 1 min (Tag überspringbar, wenn alle bereit) | Gleich lang |

## 10. Änderungen nach Recherche (2026-09-21) – überstimmt ältere Abschnitte

Verbindlich sind `docs/superpowers/specs/2026-09-21-phase0-phase1-design.md` und `docs/decisions.md`. Kurzfassung der Änderungen gegenüber den Abschnitten 2–9:

- §2/§3.1: **kein** `moveWithCollisions`, Havok oder `RecastJSPlugin` – Kollision und Wegfindung liegen als reines TypeScript in `src/core`.
- §2: Babylon **9.27.x** mit „pure"-Importen, WebGL2-Engine explizit; **kein KTX2/Draco/Meshopt** in Phase 1; TypeScript **6.0.x**.
- §3.3/§6: Kamera-Berechtigung ist der **Standardweg** (nicht Plan B); Text-Kopieren ist gleichwertig. Regel: Wer den Hotspot aufmacht, ist Host.
- §3.4: Determinismus-Regeln (eigenes Trig-Modul, Seeded-PRNG, Integer-Ticks) gelten ab dem ersten Core-Code.
- §3.7: Manifest `display: standalone` + `display_override: [fullscreen, standalone]`.
- §5: Phase 1 darf starten, sobald das Testlabor steht; die Zwei-Handy-Matrix blockiert nur die Planung von Phase 2. Nicht testbare Matrix-Zellen werden dokumentiert.
- §6: Kamera-Kollision über eigenen Spring-Arm gegen Core-Geometrie – **nicht** `camera.checkCollisions`.
- §7: statt `@vitejs/plugin-basic-ssl` → `npm run phone` + `adb reverse` bzw. GitHub Pages.
- §8.3/§8.9: kein Schleich-Button in Phase 1 (analoger Joystick); Flucht unter Regale bereits in Phase 1.
- §9: Tag/Nacht **5 min / 5 min**, beides manuell beendbar.
