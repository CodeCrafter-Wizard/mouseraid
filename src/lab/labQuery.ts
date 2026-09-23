import type { CellLabel } from './report';

/** URL-Parameter des Labors. `?transport=bc` ist der Entwickler-/E2E-Modus ohne Signalisierung. */
export interface LabQuery {
  transport: 'text' | 'broadcast';
  room: string;
  role: 'host' | 'client' | null;
  slot: number;
  quick: boolean;
}

const MAX_ROOM_LENGTH = 40;
/** Standard im Labor: 200 Pings je Kanal; der Schnellmodus hält E2E-Läufe kurz. */
const PING_COUNT = 200;
const PING_COUNT_QUICK = 20;

function parseSlot(text: string | null): number {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
}

/** Rein: liest `location.search`. Unbekannte Werte fallen auf den Normalfall (Text-Pfad, Platz 1) zurück. */
export function parseLabQuery(search: string): LabQuery {
  const params = new URLSearchParams(search);
  const role = params.get('role');
  const room = (params.get('room') ?? '').slice(0, MAX_ROOM_LENGTH);
  return {
    transport: params.get('transport') === 'bc' ? 'broadcast' : 'text',
    room: room === '' ? 'standard' : room,
    role: role === 'host' || role === 'client' ? role : null,
    slot: parseSlot(params.get('slot')),
    quick: params.get('quick') === '1',
  };
}

/** Anzahl der Pings je Kanal für einen Lauf. */
export function pingCountFor(path: CellLabel['path'], search: string): number {
  return path === 'broadcast' || parseLabQuery(search).quick ? PING_COUNT_QUICK : PING_COUNT;
}
