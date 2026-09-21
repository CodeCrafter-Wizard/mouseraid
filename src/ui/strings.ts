import type { FailureCode } from '../net/failureCodes';

/** Alle sichtbaren Texte (deutsch). Platzhalter in {geschweiften Klammern}. */
export const S = {
  appName: 'Mäusebau',
  shell: {
    subtitleGame: 'Ein Mäuse-Abenteuer im Feinkostladen',
    subtitleLab: 'Verbindungs-Testlabor',
    stageNoteGame: 'Meilenstein M0 – das Gerüst steht. Das Spiel entsteht in den nächsten Meilensteinen.',
    stageNoteLab: 'Hier entsteht in M1/M2 der Verbindungstest (QR-Code, WebRTC, Ping).',
    linkLab: 'Verbindungs-Testlabor',
    linkGame: 'Zurück zum Spiel',
    build: 'Build',
    buildMismatch: 'Erwartet wurde Build {expected} – bitte Seite neu laden bzw. „Nach Update suchen“ tippen. (Ungespeicherte Änderungen hängen „-dirty“ an die Build-ID.)',
  },
  pwa: {
    offlinePending: 'Offline noch nicht bereit …',
    offlineReady: 'Offline bereit ✓',
    checkUpdate: 'Nach Update suchen',
    checking: 'Suche nach Update …',
    upToDate: 'Kein neues Update gefunden.',
    updateLoading: 'Update gefunden – wird geladen …',
    updateReady: 'Neue Version bereit.',
    checkFailed: 'Update-Suche fehlgeschlagen – offline?',
    updateAvailable: 'Neue Version verfügbar',
    applyUpdate: 'Jetzt aktualisieren',
    unsupported: 'Dieser Browser unterstützt keinen Offline-Modus.',
    notRegistered: 'Service Worker inaktiv (Entwicklungsmodus).',
    registered: 'Service Worker aktiv.',
    phoneMode: 'Handy-Testmodus: Service Worker abgeschaltet.',
    registerError: 'Service Worker konnte nicht registriert werden.',
  },
  errors: {
    title: 'Es ist ein Fehler aufgetreten',
    copy: 'Diagnose kopieren',
    copied: 'Kopiert ✓',
    copyFailed: 'Kopieren nicht möglich – Text bitte manuell markieren.',
    close: 'Schließen',
    contextLost: 'Grafik-Kontext verloren (WebGL).',
  },
  labInfo: {
    secureContext: 'Sicherer Kontext',
    rtc: 'WebRTC verfügbar',
    camera: 'Kamera-API verfügbar',
    yes: 'ja',
    no: 'nein',
  },
  // Fehlercodes des Testlabors (src/net/failureCodes.ts). `satisfies` erzwingt beim Typecheck, dass
  // jeder Code genau einen Eintrag hat – ein fehlender oder überzähliger Code ist ein Compilerfehler.
  failures: {
    F1: {
      title: 'Keine Adresse im lokalen Netz gefunden',
      hint: 'WLAN oder Hotspot einschalten und verbinden, Flugmodus und VPN ausschalten, dann die Seite neu laden.',
    },
    F1S: {
      title: 'Safari gibt ohne Kamera-Erlaubnis keine Netzwerkadresse heraus',
      hint: 'Kamera erlauben oder den Text-Pfad benutzen. Ohne Kamera klappt es nur, wenn das andere Gerät echte Adressen liefert (dort die Kamera erlauben).',
    },
    F2: {
      title: 'Nur verschleierte Adressen (mDNS) gefunden',
      hint: 'Kamera-Berechtigung dauerhaft erteilen („Immer zulassen“, nicht „Nur dieses Mal“) und Seite neu laden.',
    },
    F3: {
      title: 'Kein Netzwerkweg zwischen den Geräten (ICE fehlgeschlagen)',
      hint: 'Beide Geräte ins selbe WLAN oder in denselben Hotspot bringen, VPN ausschalten und mit neuen Codes noch einmal verbinden.',
    },
    F4: {
      title: 'iPhone-Hotspot schirmt dieses Gerät ab',
      hint: 'Das Gerät mit dem Hotspot muss Host sein – Rollen tauschen und neu verbinden.',
    },
    F5: {
      title: 'Code ungültig oder unpassend',
      hint: 'Code vollständig kopieren; beide Geräte auf denselben Build aktualisieren. Der Host fügt den Antwort-Code des Mitspielers ein, der Mitspieler den Code des Hosts.',
    },
    F6: {
      title: 'Diese Umgebung eignet sich nicht für die Verbindung',
      hint: 'Seite über https (oder localhost) in einem aktuellen Browser öffnen und den Zugriff auf das lokale Netzwerk in den Website-Einstellungen erlauben.',
    },
    F7: {
      title: 'Verbunden, aber die Datenkanäle öffnen sich nicht',
      hint: 'Auf beiden Geräten trennen und mit neuen Codes neu verbinden; beide Geräte auf denselben Build aktualisieren.',
    },
    F8: {
      title: 'Verbindung verloren',
      hint: 'Beide Geräte wach und die Seite im Vordergrund lassen, WLAN oder Hotspot prüfen, dann neu verbinden.',
    },
    F9: {
      title: 'Kamera nicht verfügbar',
      hint: 'Kamera-Zugriff in den Website-Einstellungen erlauben und andere Kamera-Apps schließen – oder den Text-Pfad benutzen.',
    },
  } as const satisfies Record<FailureCode, { title: string; hint: string }>,
} as const;

/** Ersetzt {name}-Platzhalter. */
export function fmt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
