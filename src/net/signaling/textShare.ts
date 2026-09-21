/** Notweg ohne Clipboard-API (unsicherer Kontext, ältere Browser): verstecktes Textfeld + `execCommand`. */
function copyViaTextarea(text: string): boolean {
  const area = document.createElement('textarea');
  try {
    area.value = text;
    area.readOnly = true; // verhindert am Handy das Aufklappen der Tastatur
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Kopiert den Payload-Text in die Zwischenablage. Wirft nie – `false` heißt: Text bitte von Hand markieren. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Verweigert oder kein Fokus → unten der Notweg.
  }
  return copyViaTextarea(text);
}

/** Kann dieser Browser reinen Text über das System-Teilen-Blatt weitergeben? */
export function canShareText(): boolean {
  try {
    if (typeof navigator.share !== 'function') return false;
    return typeof navigator.canShare !== 'function' || navigator.canShare({ text: 'MB1' });
  } catch {
    return false;
  }
}

/**
 * Teilt REINEN Text (nie eine URL – ein Deep-Link würde beim Empfänger eine zweite Seite öffnen).
 * `false` bei fehlender API, Abbruch durch den Nutzer (AbortError) und jedem anderen Fehlschlag.
 */
export async function shareText(title: string, text: string): Promise<boolean> {
  if (!canShareText()) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    return false;
  }
}
