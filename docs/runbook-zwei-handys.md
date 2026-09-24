# Runbook: Verbindungstests mit zwei Geräten

Für **Sitzung A** (PC mit Webcam + Android-Handy, Meilenstein M2) und für die **Zwei-Handy-Matrix F**
(Host-Handy + Leihhandy + PC). Dieses Blatt ist zum Ausdrucken gedacht: alles, was **während** der
Sitzung am Gerät gebraucht wird, steht hier. Nachschlagen im Repo ist nur für die Nacharbeit nötig
(Eintragen der Ergebnisse nach `docs/connectivity-tests.md`, Bedeutung der Fehlercodes F1–F9 in
`docs/decisions.md`).

---

## 1. Zweck und Datenschutz-Regel

**Zweck.** Das Verbindungs-Testlabor (`lab.html`) misst, ob zwei echte Geräte im selben WLAN oder über
einen Handy-Hotspot ohne fremden Server zueinander finden – über den **QR-Pfad** (Code zeigen, Code
scannen) und, als Rückfallweg, über den **Text-Pfad**. Aus den Reports entsteht die Go/No-Go-Notiz für
Phase 2 (Mehrspieler). Ohne diese Messungen wird der Netzcode des Spiels nicht geplant.

**Datenschutz-Regel – bitte zuerst lesen.** Das Repo ist öffentlich.

1. Weitergegeben wird **nur** Text aus den Knöpfen mit dem Zusatz „(anonymisiert)": „Alle Reports
   kopieren (JSON, anonymisiert)" bzw. „Alle teilen". Darin ist jede Netzwerkadresse durch ein Kürzel
   wie `ipv4/private#1` ersetzt.
2. **Nie** weitergegeben werden „Roh-SDP kopieren" und „Einzel-Report als JSON mit echten Adressen
   kopieren (nie öffentlich posten)". Beide enthalten echte Adressen, `ufrag`, `pwd` und Fingerprint.
   Sie bleiben auf dem Gerät und dienen nur der Fehlersuche vor Ort.
3. **Kein Foto und kein Screenshot des QR-Codes** (oder des Bildschirms, der ihn zeigt) wird
   weitergegeben: der Code enthält dieselben Daten wie „Roh-SDP kopieren" – echte Adressen, `ufrag`,
   `pwd` und Fingerprint. Ein Bild davon ist eine maschinenlesbare Kopie des Payloads, kein Beleg.
   Wer eine Anzeige zeigen will, fotografiert den Zustands-Chip oder die Report-Karte, nie die
   QR-Fläche und nie die Vollbild-Lupe.
4. Das Feld **„Gerät (Spitzname)"** ist ein frei gewählter Spitzname (1–24 Zeichen, z. B. „Android-Handy",
   „PC-Webcam", „Leihhandy") – kein Klarname, keine Seriennummer, kein Gerätename des Herstellers.
5. Auch in den handschriftlichen Notizen unten stehen **keine** IP-Adressen und keine WLAN-Namen –
   nur „ja/nein", Anzahlen und Uhrzeiten.

---

## 2. Vorbereitung (einmal je Sitzung, ca. 15 min)

- [ ] **Push-Freeze.** Ab jetzt wird bis zum Ende der Sitzung **nichts** nach `main` gepusht. Ein Deploy
      mitten in der Sitzung tauscht die Seite unter den Geräten aus und macht alle laufenden Zellen
      unvergleichbar. Erwartete Build-ID notieren:

      Build-ID dieser Sitzung: ________________  (8-stelliger Kurz-SHA)

- [ ] **Build-ID auf jedem Gerät prüfen.** Auf **jedem** Gerät öffnen:

      `https://codecrafter-wizard.github.io/mouseraid/lab.html?expect=<Build-ID>`

      Steht ein **roter** Hinweis auf eine andere Build-ID, ist das Gerät veraltet: in der Hülle
      „Nach Update suchen" tippen, dann „Jetzt aktualisieren" – die Seite lädt genau einmal neu. Danach
      die Adresse mit `?expect=` erneut öffnen und prüfen, dass der rote Hinweis weg ist.
      (Die Seite wird mit `max-age=600` ausgeliefert: kurz nach einem Deploy kann das Update erst nach
      ein paar Minuten gefunden werden.)

- [ ] **Kamera-Berechtigung zurücksetzen – VOR dem ersten Lauf.** Die Reihenfolge ist Pflicht: **zuerst
      der Lauf ohne Kamera, dann die Läufe mit Kamera.** Ein Lauf mit dem Label „Kamera aus" zählt nur,
      wenn der Browser die Kamera-Berechtigung **nicht** erteilt hat – sonst gibt Chrome auch ohne
      laufende Kamera echte Adressen heraus, und der Report markiert den Lauf selbst als ungültig.
      - Chrome (Android und Desktop): Symbol links in der Adressleiste → „Berechtigungen" bzw.
        „Website-Einstellungen" → **Kamera → Zurücksetzen**. Danach die Seite neu laden.
      - Safari (iOS): Einstellungen → Safari → Kamera → **„Fragen"**. Bei einer installierten Web-App:
        Einstellungen → (App) → Kamera aus- und wieder einschalten.
      - Gegenprobe: nach dem Zurücksetzen muss beim ersten Kamera-Zugriff wieder ein Dialog erscheinen.

- [ ] **Netz vorbereiten.** Heim-WLAN auf beiden Geräten verfügbar; VPN aus; Flugmodus aus. Für die
      Hotspot-Zellen: **mobile Daten ausschalten**, dann den Hotspot einschalten – so wird wirklich das
      lokale Netz des Hotspots gemessen und nicht der Umweg übers Mobilfunknetz.

- [ ] **Geräte wach halten.** Bildschirm-Zeitsperre auf 5 min oder länger stellen. Das Labor fordert beim
      Tippen auf „Zelle übernehmen" selbst einen Wake Lock an; ob er erteilt wurde, steht später im
      Report (`wakelock:acquired` / `wakelock:denied` / `wakelock:unsupported`). Zwei bekannte Grenzen:
      in einer **installierten iOS-Web-App unter iOS 18.4** wirkt er nicht, und nach einem Wegschalten
      der Seite über `pagehide` (Zurück-Taste, iOS-Seitencache) fordert die Seite ihn **nicht** erneut an
      – dann hilft nur ein Neuladen.

- [ ] **iPhone/iPad – nur wenn ein solches Gerät dabei ist** (sonst überspringen, Zellen als „nicht
      testbar" markieren):
      1. In **Safari** die Adresse oben öffnen, dann Teilen-Symbol → **„Zum Home-Bildschirm"** →
         installieren.
      2. Die **installierte App** (Symbol auf dem Home-Bildschirm) **online** öffnen – nicht den
         Safari-Tab. Warten, bis in der Hülle **„Offline bereit ✓"** steht.
      3. Erst danach auf den Hotspot umschalten bzw. das Internet trennen.
      4. **Notieren:** Lud die App beim ersten Start im Hotspot sichtbar neu (Ladebalken, kurzer weißer
         Bildschirm, „Offline noch nicht bereit …"), oder kam sie sofort aus dem Zwischenspeicher?

      Precache beim ersten Hotspot-Start neu geladen?   ja / nein   – wie lange? ____ s

- [ ] **Notizblätter bereitlegen.** Je geplanter Zelle einen Block aus Abschnitt 7 ausdrucken oder
      abschreiben.

---

## 3. Zellen: feste Reihenfolge, Priorität und Zeitbudget

Abgearbeitet wird **von oben nach unten**. **Bei Zeitdruck wird nach Priorität gestrichen, nicht nach
Reihenfolge:** zuerst fällt A8 (P3) weg, dann A3 und A5 (P2) – **nie A6 oder A7** (P1), obwohl sie weiter
unten stehen. In der Matrix F entsprechend: erst Z6/Z7 (P3), dann Z4/Z5 (P2), nie Z1–Z3 (P1). Die
Zeitangabe ist das Budget inklusive Aufbau; wer deutlich darüber liegt, notiert das (das ist selbst ein
Messwert: „so lange dauert eine Paarung in der Praxis").

### 3.1 Sitzung A – PC mit Webcam + Android-Handy (netto ≈ 74 min, mit Rüstzeit ≈ 90 min)

| Zelle | P | Zeit | Netz | Host | Client | Kamera | Pfad | Was diese Zelle beweisen soll |
|---|---|---|---|---|---|---|---|---|
| A1 | 1 | 8 min | Heim-WLAN | Android | PC | **aus** | Text-Code | Basislinie ohne Kamera. **Muss als Erstes laufen** (danach ist die Berechtigung erteilt). Erwartet: nur verschleierte Adressen → Befund F2 ist hier ein Ergebnis, kein Fehler. |
| A2 | 1 | 10 min | Heim-WLAN | Android | PC | an | **QR-Code** | Die Kernzelle von M2: Paarung allein über Kamera und QR, ohne Tippen. Liefert QR-Backend, Scan-Latenz und Paarungsdauer. |
| A3 | 2 | 8 min | Heim-WLAN | PC | Android | an | QR-Code | Rollentausch: scannt auch das Handy den Code vom PC-Bildschirm zuverlässig? |
| A4 | 1 | 10 min | **Handy-Hotspot** (mobile Daten aus) | Android (= Hotspot-Besitzer) | PC | an | QR-Code | Die Regel „**Hotspot-Besitzer = Host**". Soll klappen. |
| A5 | 2 | 8 min | Handy-Hotspot (mobile Daten aus) | PC | Android (= Hotspot-Besitzer) | an | QR-Code | Gegenprobe zu A4: Hotspot-Besitzer ist **Client**. Scheitert das hier, ist die Regel bestätigt. |
| A6 | 1 | 12 min | Heim-WLAN | Android | zwei PC-Profile | an | Platz 1 QR-Code, Platz 2 Text-Code | Dreier-Lobby und die Hochrechnung „Zeit bis Lobby voll". Die zwei Clients sind zwei getrennte Browser-Profile bzw. -Fenster am PC. |
| A7 | 1 | 12 min | wie A2 | Android | PC | an | QR-Code | Sperrbildschirm-Test 10/30/60 s (Abschnitt 5) auf der offenen Verbindung aus A2. |
| A8 | 3 | 6 min | Heim-WLAN | Android | PC | an | Text-Code | Vergleichszelle: derselbe Weg mit Kopieren/Einfügen. Zeigt, wie viel der QR-Pfad an Zeit spart (oder kostet). |

### 3.2 Matrix F – Host-Handy + Leihhandy (+ PC), nur wenn das zweite Handy da ist (netto ≈ 71 min)

| Zelle | P | Zeit | Netz | Host | Client | Kamera | Pfad | Was diese Zelle beweisen soll |
|---|---|---|---|---|---|---|---|---|
| Z1 | 1 | 10 min | Heim-WLAN | Handy A | Leihhandy | an | QR-Code | Zwei echte Handys, beide mit Kamera – der Normalfall des Spiels. |
| Z2 | 1 | 10 min | Hotspot von **Handy A** | Handy A (= Hotspot-Besitzer) | Leihhandy | an | QR-Code | „Hotspot-Besitzer = Host" auf zwei Handys. Soll klappen. |
| Z3 | 1 | 10 min | Hotspot von **Handy A** | Leihhandy | Handy A (= Hotspot-Besitzer) | an | QR-Code | **Erwarteter Fehlschlag**, wenn der Hotspot von einem iPhone kommt: dessen Client-Isolation ergibt Befund F4 (Adresse 192.0.0.2). Die Zelle wird trotzdem gefahren und der Report gespeichert. |
| Z4 | 2 | 15 min | Heim-WLAN | Handy A | Leihhandy **und** PC | an | Platz 1 QR-Code, Platz 2 QR-Code | Dreier-Lobby mit drei echten Geräten. **Notieren:** fragt die Kamera bei jedem Beitritt erneut nach? |
| Z5 | 2 | 12 min | wie Z1 | Handy A | Leihhandy | an | QR-Code | Sperrbildschirm-Test 10/30/60 s (Abschnitt 5) – auf **beiden** Handys nacheinander. |
| Z6 | 3 | 8 min | wie Z1 | Handy A | Leihhandy | an | QR-Code | Echte SDP-Mitschnitte sichern: „Roh-SDP kopieren" auf beiden Seiten. **Bleibt auf dem Gerät** und wird nur dem Agenten direkt gegeben – er anonymisiert vor dem Commit. |
| Z7 | 3 | 6 min | Heim-WLAN | Leihhandy (iPhone) | Handy A | an | QR-Code | Nur falls das Leihhandy ein iPhone ist: installierte App, Kamera-Nachfragen, Verhalten am Sperrbildschirm. |

### 3.3 Zellen der Spec, die **nicht testbar** sind (mit Grund)

Diese Zellen werden **nicht** gefahren. Sie stehen hier, damit im Protokoll sichtbar bleibt, warum eine
Lücke eine Lücke ist – nicht, weil sie vergessen wurde.

| Zelle | Grund |
|---|---|
| „Kamera **aus**" × **QR-Pfad** | Bauart: der QR-Pfad öffnet die Kamera schon beim Eintritt in die Lobby und braucht sie zum Scannen. Ein Lauf mit dem Label „Kamera aus" wäre auf diesem Pfad falsch beschriftet und wird vom Report ohnehin als ungültig markiert. Der Vergleich „ohne Kamera" läuft deshalb über den Text-Pfad (Zelle A1). |
| Nativer `BarcodeDetector` am **PC** | Die API gibt es in Chrome auf Windows und Linux nicht (nur ChromeOS und macOS). Am PC meldet das Labor immer `worker`. Ein natives Backend kann **nur** Android-Chrome liefern (Zellen A2/A4/Z1). |
| Nativer `BarcodeDetector` in **Safari/iOS** | Safari kennt die Schnittstelle nur hinter dem Feature-Flag „Shape Detection API", auf iOS ist sie zusätzlich defekt (WebKit-Bug 281848). Auf dem iPhone bleibt es beim Worker-Pfad. |
| **Firefox** mit „Kamera an" | Firefox kennt `permissions.query({ name: 'camera' })` nicht → Status `unsupported` → ein Lauf „Kamera an" gilt nach der Gültigkeitsregel als ungültig. (Spec-Abweichung 9.) |
| **Wake Lock** in der installierten iOS-Web-App | Wirkungslos unter iOS 18.4 (WebKit-Bug 254545). Der Zeitleisten-Eintrag sagt trotzdem, was der Browser gemeldet hat – mehr ist dort nicht messbar. |
| **iPhone-Zellen insgesamt** | Solange kein iPhone im Gerätepark ist, bleiben sie offen. Der iOS-Ablauf in Abschnitt 2 steht bereit, sobald eines geliehen werden kann. |
| **Automatischer QR-Handshake** (Fake-Kamera) | Die Fake-Kamera von Chromium liefert je Browser-Start genau ein Bild; ein Handshake bräuchte zwei verschiedene. Automatisch geprüft sind deshalb nur zwei Einzelschritte (ein echter Code wird gelesen, ein fremder Code übersprungen) – der vollständige QR-Handshake wird von Hand in dieser Sitzung geprüft. |

---

## 4. Ablauf je Zelle (Knopf-Folgen)

Jede Zelle benutzt genau einen dieser Blöcke – die Zellentabelle sagt, welchen. Die Knopftexte sind
wörtlich die der Oberfläche.

### 4.1 Vor jedem Lauf (auf **beiden** Geräten)

1. `lab.html?expect=<Build-ID>` öffnen; kein roter Build-Hinweis (sonst Abschnitt 2).
2. Karte **„1 · Zelle beschriften"** ausfüllen:
   - **Rolle**: „Host" oder „Client"
   - **Kamera**: „an" oder „aus"
   - **Hotspot-Besitzer**: „dieses Gerät" / „die Gegenstelle" / „WLAN-Router" / „unbekannt"
   - **Gerät (Spitzname)**: z. B. „Android-Handy"
   - **Pfad**: „Text-Code" oder „QR-Code"
3. **„Zelle übernehmen"** tippen. Das Label ist ab jetzt gesperrt; für eine neue Zelle
   **„Neue Zelle (Seite neu laden)"**. Mit diesem Tipp fordert die Seite auch den Wake Lock an.
4. Die Karte **„2 · Kamera"** erscheint bei Kamera „an" **und** auf dem QR-Pfad.
   - Auf dem **QR-Pfad** öffnet die Seite die Kamera selbst („Kamera für den QR-Pfad wird geöffnet …",
     danach „Kamera läuft – Code der Gegenstelle ins Bild halten.") und zeigt ein kleines Sucherbild.
     Der Knopf „Kamera einschalten" bleibt stehen, ist aber nur der **zweite Versuch** nach einer
     abgelehnten Berechtigung.
   - Auf dem **Text-Pfad** dafür **„Kamera einschalten"** tippen.
   - Den Dialog mit **„Immer zulassen"** beantworten (nicht „Nur dieses Mal") und im Notizblatt
     vermerken, wann er erschien.
   - Bleibt das Sucherbild schwarz oder meldet die Karte „Die Kamera wurde unterbrochen. Zum Weitermachen
     neu starten.": **„Kamera neu starten"**. Der Knopf erscheint erst, wenn die Kamera in diesem
     Seitenaufruf schon einmal lief, und er bleibt stehen, wenn der Neustart selbst scheitert.

### 4.2 Host auf dem QR-Pfad (Zellen A2, A4, A6-Platz 1, Z1, Z2, Z4)

1. Karte **„3 · Spieler verbinden (Host)"** → **„Spieler hinzufügen"**. Es erscheint **„Platz 1"**.
2. Der Platz zeigt den Angebots-Code von selbst als QR-Code (Überschrift „Angebots-Code als QR – vom
   Mitspieler scannen lassen", Beschriftung **„Tippen zum Vergrößern"**). **Auf den Code tippen** – der
   Code füllt dann den Bildschirm (weißer Grund). Schließen mit **„Schließen"**, einem weiteren Tipp
   oder der Escape-Taste. Bildschirmhelligkeit hochdrehen, wenn der Hinweis dazu rät.
3. Der Mitspieler scannt diesen Code (Block 4.3).
4. Sobald der Mitspieler seinen Antwort-Code zeigt: die Kamera darauf halten. Der Platz scannt von
   selbst, sobald die Kamera läuft, und meldet **„Code erkannt ✓"**. Bricht der Scan nach 60 s ab,
   erscheint **„Erneut scannen"**.
5. Der Chip am Platz geht über „verbinde …" auf **„verbunden"**. Dann **„Ping-Test starten"**.
6. Weitere Plätze: **„Spieler hinzufügen"** (Platz 2, Platz 3) und Schritte 2–5 wiederholen. Schon
   verbundene Plätze laufen dabei weiter. **Es scannt immer nur ein Platz**: der neueste übernimmt die
   Kamera, die übrigen melden „Ein anderer Platz scannt – ‚Erneut scannen' übernimmt die Kamera." – mit
   **„Erneut scannen"** holt man sie zurück.
7. Am Ende je Platz **„Platz freigeben"**.

**Rückfall auf Text, ohne die Zelle zu wechseln** – erlaubt und erwünscht, wenn der QR-Weg klemmt:
- Meldung **„Code zu groß für QR – Text-Pfad benutzen."**: der Code passt nicht mehr in einen lesbaren
  QR-Code. Dann den Text-Code darunter mit **„Kopieren"** (oder **„Teilen"**) verschicken.
- Nach 60 s ohne Treffer bricht der Scan ab. Dann **„Erneut scannen"** – oder
  **„Auf Text-Pfad wechseln"** und den Code von Hand austauschen. Nach dem Wechsel bleibt
  **„Erneut scannen"** verfügbar: man kann jederzeit auf den QR-Weg zurück.
- Meldet der Block „Ohne Kamera kein Scan – Text-Pfad benutzen oder Kamera neu starten.", gab die
  Kamera nichts her: entweder Karte 2 („Kamera neu starten") oder den Text-Weg nehmen.
- Die Zelle bleibt in allen Fällen Pfad **„QR-Code"**; der Ausweg steht von selbst im Report. Im
  Notizblatt vermerken, an welcher Stelle er nötig war.

### 4.3 Client auf dem QR-Pfad (Zellen A2, A4, A6-Platz 1, Z1, Z2, Z4)

1. Karte **„3 · Mit dem Host verbinden (Client)"**. Der QR-Block startet den Scan von selbst, sobald die
   Kamera läuft („Angebots-Code des Hosts scannen" steht als Überschrift darüber).
2. Die Kamera auf den QR-Code des Hosts halten (Abstand etwa eine Handbreit, Code vollständig im Bild),
   bis **„Code erkannt ✓"** gemeldet wird.
3. Die Seite erzeugt die Antwort **von selbst** und zeigt sie als QR-Code. (Nur auf dem Text-Pfad braucht
   es dafür den Knopf „Antwort erzeugen".)
4. Den Code dem Host hinhalten, bis dessen Scan trifft. Auch hier hilft „Tippen zum Vergrößern".
5. Sobald **„verbunden"** steht, läuft der Ping-Test von selbst. Ergebnis abwarten
   („Report gespeichert ✓").

### 4.4 Text-Pfad (Zellen A1, A6-Platz 2, A8 und als Rückfall überall)

**Host:** „Spieler hinzufügen" → **„Platz 1"** → unter „Angebots-Code – an den Mitspieler schicken"
**„Kopieren"** oder **„Teilen"** → Code an den Mitspieler geben → dessen Antwort in das Feld
„Antwort-Code des Mitspielers hier einfügen" einsetzen → **„Verbinden"** → bei „verbunden"
**„Ping-Test starten"** → am Ende **„Platz freigeben"**.

**Client:** Angebots-Code in das Feld „Angebots-Code des Hosts hier einfügen" einsetzen →
**„Antwort erzeugen"** → **„Kopieren"** → Code zurückgeben → warten, bis „verbunden" steht; der Ping-Test
läuft dann von selbst.

### 4.5 Was bei **jedem** Lauf zu beobachten ist

- **Zustands-Chip** am Platz: „wartet auf Antwort" → „verbinde …" → „verbunden". Bleibt er auf
  „verbinde …" stehen, trotzdem **„Ping-Test starten"** tippen: gerade der gescheiterte Lauf ist der
  wertvollste Report.
- **Block „QR-Tauglichkeit"**: **„QR-tauglich ✓"** = es gibt echte Host-Adressen und keine verschleierten
  (`.local`) – genau das braucht der QR-Pfad. **„Nicht QR-tauglich – ohne echte Host-Adresse scheitert
  die Verbindung meist."** = keine oder nur verschleierte Adressen; dann Kamera-Berechtigung prüfen
  (Befunde F1 / F1S / F2). Die Zeile darunter zählt beides („Host-Kandidaten: … echte IP, … mDNS").
- **Fehlercodes F1–F9** in der Report-Karte: Titel und Hinweis stehen direkt daneben. Alle notieren,
  auch wenn die Verbindung trotzdem stand.
- **Dialoge**: Kamera-Dialog und der Dialog „Lokales Netzwerk" (engl. „Local Network Access", LNA) –
  wann und wie oft? Ins Notizblatt.
- **Auf dem QR-Pfad zusätzlich**: traf der Code beim ersten Hinhalten? Wie oft musste nachgeführt
  werden? Erschien einer der Hinweise aus 4.2? Ein **fremder** QR-Code im Bild (Plakat, Verpackung) ist
  **kein** Fehler: die Seite meldet „Das war kein Mäusebau-Code – es wird weitergescannt.", scannt
  weiter und zählt ihn nicht als F9.

---

## 5. Sperrbildschirm-Test 10 / 30 / 60 s (Zellen A7 und Z5)

Nur an einer **offenen** Verbindung; am Platz erscheint dafür der Block **„Sperrbildschirm-Test"**. Der
Test misst, ob eine Verbindung das Ausschalten des Bildschirms übersteht – die Frage, an der im Spiel
später eine Runde hängt. **Am PC ist er nicht aussagekräftig**: gemessen werden soll ein Handy-Bildschirm.
Der Knopf **„Neu verbinden"** steht in diesem Block von Anfang an bereit – **sein Erscheinen ist kein
Signal**. Ob neu verbunden werden muss, sagt allein die Ergebniszeile (Schritt 6).

Je Durchgang (10 s, dann 30 s, dann 60 s):

1. **„10 s sperren"** tippen (bzw. „30 s sperren" / „60 s sperren"). Der Text darunter sagt:
   „Jetzt den Bildschirm sperren und nach 10 Sekunden wieder entsperren. Nichts anderes öffnen – auch
   ein App-Wechsel zählt als Sperren." Also wirklich **nur sperren**: nicht zwischendurch in eine andere
   App wechseln, sonst misst der Lauf den App-Wechsel statt der Bildschirmsperre.
2. **Sofort** den Bildschirm sperren (Ein/Aus-Taste). Solange noch nicht gesperrt wurde, kann man eine
   andere Dauer wählen – der Lauf beginnt erst mit dem Dunkelwerden.
3. Die genannte Zeit warten, dann entsperren und die Seite wieder in den Vordergrund holen.
4. Die Seite misst selbst: Dunkelzeit, Zustand der Verbindung, Zustand der Kameraspur, danach eine kurze
   Ping-Serie (20 Pings je Kanal). Das dauert ein paar Sekunden – abwarten. Währenddessen ist
   „Ping-Test starten" gesperrt.
5. Notieren: Stand die Verbindung noch? Meldete die Kamerakarte einen Spurverlust? Wie war der Ping
   danach?
6. **Das Signal steht in der Ergebniszeile**, nicht am Knopf: endet sie auf
   „Verbindung oder Kamera ist weg." (statt „Verbindung steht weiterhin ✓"), ist die Verbindung
   endgültig zu; darunter erscheint dann der Hinweis „Der Host legt für denselben Platz einen frischen
   Code an; der Mitspieler scannt oder fügt ihn erneut ein."
   Dann **„Neu verbinden" auf BEIDEN Geräten tippen** – es gibt keinen Kanal, über den das eine Gerät
   das andere benachrichtigen könnte:
   - am **Host** legt der Tipp auf demselben Platz ein frisches Angebot an und zeigt es sofort als
     QR-Code;
   - am **Client** räumt der Tipp den veralteten Antwort-Code weg und nimmt den Scan wieder auf.

   Wird nur auf einer Seite getippt, passiert nichts Sichtbares – der Client scannt dann einen toten
   Code bzw. der Host zeigt ein Angebot, das niemand scannt. **Die Zeit bis „verbunden" notieren.**

Zeitbedarf: ein 60-s-Durchgang samt Ping-Serie und eventuellem Neuverbinden kostet bis zu ~90 s. Drei
Durchgänge plus Notizen passen in das Budget von 12 min.

---

## 6. Wenn etwas schiefgeht

| Beobachtung | Erster Griff |
|---|---|
| „Nicht QR-tauglich", Befund F2 | Kamera-Berechtigung dauerhaft erteilen („Immer zulassen"), Seite neu laden, Zelle wiederholen. |
| Befund F1 / F1S | WLAN bzw. Hotspot prüfen, VPN und Flugmodus aus. Auf dem iPhone: ohne Kamera-Erlaubnis gibt Safari grundsätzlich keine Adresse heraus. |
| Befund F3 (kein Weg) | Beide Geräte in **dasselbe** Netz bringen, dann mit **neuen** Codes noch einmal verbinden – ein alter Code ist nach einem Fehlschlag verbraucht. |
| Befund F4 | Rollen tauschen: das Gerät mit dem Hotspot muss Host sein. Genau das prüfen die Zellen A4/A5 bzw. Z2/Z3. |
| Befund F6 | Seite über die `https`-Adresse öffnen und in den Website-Einstellungen den Zugriff auf das **lokale Netzwerk** erlauben. |
| Scan trifft nicht | Helligkeit hoch, Code vergrößern (auf den Code tippen), Abstand ändern, Spiegelungen vermeiden. Nach 60 s „Erneut scannen". |
| „Ein anderer Platz scannt …" | Am gewünschten Platz **„Erneut scannen"** – es scannt immer nur ein Platz zugleich. |
| „Ohne Kamera kein Scan …" | Karte „2 · Kamera" → „Kamera neu starten"; sonst „Auf Text-Pfad wechseln". |
| Codefeld ist leer / Seite hängt | „Platz freigeben", dann „Spieler hinzufügen" – der Platz wird neu aufgebaut. |
| Erscheint das Fehler-Panel | „Diagnose kopieren" und den Text mitschicken (er ist geschwärzt). |

---

## 7. Notizblatt (ein Block je Zelle – kopieren oder ausdrucken)

```
Zelle: ______   Datum/Uhrzeit: ____________   Build-ID: ________________
Gerät (Spitzname): ______________   Rolle: Host / Client   Pfad: Text-Code / QR-Code
Netz: Heim-WLAN / Hotspot von ____________      Kamera laut Label: an / aus

System-/Browser-Dialoge gesehen (Kamera, Lokales Netzwerk/LNA):
  Kamera-Dialog:                nein / ja  – wann: __________  wie oft: ____
  Dialog „Lokales Netzwerk"/LNA: nein / ja  – wann: __________  wie oft: ____
  Sonstiger Systemhinweis:      nein / ja  – welcher: _______________________

Ergebnis:
  Zustand am Ende:  wartet auf Antwort / verbinde … / verbunden / getrennt / fehlgeschlagen
  QR-Tauglichkeit:  QR-tauglich ✓ / nicht QR-tauglich
  Fehlercodes:  keine / ________________________________
  QR: traf der Code beim ersten Hinhalten?  ja / nein – Versuche: ____
      Rückfall auf Text nötig?  nein / ja – an welcher Stelle: ______________
      Meldung „Code zu groß für QR"?  nein / ja
      fremder Code übersprungen („kein Mäusebau-Code")?  nein / ja – wie oft: ____
  Dauer gefühlt bis „verbunden": ____ s

Sperrbildschirm-Test (nur A7 / Z5):
  10 s:  Verbindung gehalten? ja/nein   „Neu verbinden" nötig? ja/nein   zurück nach ____ s
  30 s:  Verbindung gehalten? ja/nein   „Neu verbinden" nötig? ja/nein   zurück nach ____ s
  60 s:  Verbindung gehalten? ja/nein   „Neu verbinden" nötig? ja/nein   zurück nach ____ s

Sonstiges (nur Art und Anzahl, keine Adressen, keine WLAN-Namen):
______________________________________________________________________
```

---

## 8. Abschluss der Sitzung

1. **Internet wieder anschalten**: WLAN an, Hotspot aus, mobile Daten zurück auf den gewohnten Stand.
2. Auf **jedem** beteiligten Gerät die Karte **„4 · Reports"** öffnen und
   **„Alle teilen"** oder **„Alle Reports kopieren (JSON, anonymisiert)"** tippen.
3. Den Text zusammen mit den ausgefüllten Notizblättern weitergeben. Er wird nach
   `docs/connectivity-tests.md` eingetragen; danach läuft `npm test` (der Datenschutz-Wächter prüft, dass
   keine echte Adresse hineingeraten ist).
4. „Roh-SDP kopieren" und „Einzel-Report als JSON mit echten Adressen kopieren (nie öffentlich posten)"
   **bleiben auf dem Gerät** – außer bei Zelle Z6, und auch dort gehen sie nur direkt an den Agenten,
   der sie vor jedem Commit anonymisiert.
5. Push-Freeze aufheben.

---

## 9. Release-Check-Notiz (vor jedem Release nachsehen)

Diese vier Punkte können die Messungen dieser Sitzung von außen ungültig machen – vor jedem Release
kurz nachschlagen, ob sich der Stand geändert hat:

- **chromestatus.com/feature/5065884686876672 – „Local Network Access Restrictions for WebRTC":**
  Chrome will WebRTC-Zugriffe ins lokale Netz hinter eine Berechtigungsabfrage stellen (Stand zuletzt:
  „Proposed", Vorwarnung an Unternehmen ab Chrome 137). Wird sie verweigert, meldet das Labor F6.
- **chromestatus.com/feature/5068298146414592 – „Local Network Access split permissions":**
  die Berechtigung wird in `local-network` (lokale Adressbereiche) und `loopback-network` (Schleife)
  geteilt, die alte bleibt als Alias (Stand zuletzt: ab Chrome 145). Genau diese beiden Namen fragt das
  Labor ab und schreibt sie in den Report.
- **bugzilla.mozilla.org/show_bug.cgi?id=1969916 – „Local network access restrictions for webrtc"**
  (Core :: WebRTC: Networking, Stand zuletzt: NEW): Firefox' Gegenstück. Solange der Fehlerbericht offen
  ist, verhält sich Firefox wie gemessen.
- **WebKit-Bugs 254545, 281848, 301994:** Wake Lock wirkt in installierten iOS-Web-Apps erst ab
  iOS 18.4 (254545); `BarcodeDetector` ist auf iOS defekt (281848); in installierten iOS-Web-Apps gibt es
  einen Balken in der Statusleiste (301994).

---

## 10. Go/No-Go für Phase 2

Nach der Sitzung ausfüllen. Phase 2 (Koop-Netzcode im Spiel) startet nur bei **Go** oder
**Go mit Auflagen**.

| # | Kriterium | erfüllt? | Beleg (Zelle) |
|---|---|---|---|
| 1 | Zwei echte Geräte verbinden sich in **mindestens einer** Netzform über den QR-Pfad ohne Tippen. | ja / nein | ____ |
| 2 | Der Block **„QR-Tauglichkeit"** meldete auf mindestens einem Handy „QR-tauglich ✓" (echte Host-Adressen, keine `.local`). | ja / nein | ____ |
| 3 | Die Regel **„Hotspot-Besitzer = Host"** stimmt: die Zelle mit Hotspot-Besitzer als Host klappt, die Gegenprobe scheitert nachvollziehbar. | ja / nein | ____ |
| 4 | Die Hochrechnung **„Zeit bis Lobby voll"** (drei Clients) liegt unter 3 Minuten. | ja / nein | ____ |
| 5 | Nach dem **30-s-Sperrtest** steht die Verbindung noch („Verbindung steht weiterhin ✓"), oder „Neu verbinden" auf beiden Geräten führt in unter 60 s zurück. | ja / nein | ____ |
| 6 | **Kein** Lauf scheiterte an F6 (Umgebung ungeeignet). | ja / nein | ____ |

**Entscheidung:** ☐ Go  ☐ Go mit Auflagen: ______________________  ☐ No-Go

**Bei No-Go** gehören diese Punkte in die Notiz: welche Netzform scheiterte, mit welchem Befund, und
ob ein Ausweg in Sicht ist (z. B. „nur Hotspot funktioniert" → im Spiel den Hotspot-Besitzer immer zum
Host machen; „gar nichts ohne Server" → Phase 2 braucht eine Signalisierung über einen Server, das ist
ein eigener Meilenstein).

Datum: __________   Entscheidung getroffen von: __________
