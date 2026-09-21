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
} as const;

/** Ersetzt {name}-Platzhalter. */
export function fmt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
