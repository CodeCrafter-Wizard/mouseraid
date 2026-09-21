import type { MessageRouter } from './messageRouter';
import type { Channel } from './transport';

export interface PingSample {
  seq: number;
  rttMs: number;
}

export interface PingStats {
  sent: number;
  received: number;
  lossPct: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  outOfOrder: number;
}

export interface PingSeriesOptions {
  count: number;
  intervalMs: number;
  timeoutMs: number;
  /** Uhr in ms (im Browser `() => performance.now()`); liefert `sentAtMs` und die RTT. */
  now: () => number;
}

/** Nearest-Rank-Perzentil: Rang = ceil(p/100 · n), 1-basiert. Ganzzahlig gerechnet – 0.95 · n wäre ungenau. */
function nearestRank(sortedAscending: readonly number[], percent: number): number {
  const rank = Math.max(1, Math.ceil((percent * sortedAscending.length) / 100));
  return sortedAscending[rank - 1] ?? 0;
}

/**
 * Rein: Statistik einer Ping-Serie aus den Proben in ANKUNFTSREIHENFOLGE.
 *
 * - Duplikate (gleiche `seq`) zählen einmal; die erste Ankunft gilt, spätere werden ganz ignoriert.
 * - `outOfOrder` = Proben, deren `seq` kleiner ist als eine zuvor angekommene.
 * - `lossPct` = (sent − received) / sent · 100, auf eine Nachkommastelle; `sent` 0 → 0.
 * - Ohne Antworten sind alle Zeitwerte 0. Zeitwerte werden NICHT gerundet (das macht die Anzeige).
 */
export function computePingStats(sent: number, samplesInArrivalOrder: readonly PingSample[]): PingStats {
  const seen = new Set<number>();
  const rtts: number[] = [];
  let highestSeq = -Infinity;
  let outOfOrder = 0;
  for (const sample of samplesInArrivalOrder) {
    if (seen.has(sample.seq)) continue;
    seen.add(sample.seq);
    rtts.push(sample.rttMs);
    if (sample.seq < highestSeq) outOfOrder += 1;
    else highestSeq = sample.seq;
  }
  rtts.sort((x, y) => x - y);

  const received = rtts.length;
  const lost = Math.max(0, sent - received);
  const lossPct = sent > 0 ? Math.round((lost * 1000) / sent) / 10 : 0;
  return {
    sent,
    received,
    lossPct,
    minMs: rtts[0] ?? 0,
    medianMs: nearestRank(rtts, 50),
    p95Ms: nearestRank(rtts, 95),
    maxMs: rtts[received - 1] ?? 0,
    outOfOrder,
  };
}

/** Beantwortet jeden Ping mit einem Pong gleicher `seq`/`sentAtMs` auf DEMSELBEN Kanal. @returns Abmelde-Funktion. */
export function attachPongResponder(router: MessageRouter): () => void {
  return router.on('ping', (message, channel) => {
    router.send(channel, { type: 'pong', seq: message.seq, sentAtMs: message.sentAtMs });
  });
}

/**
 * Sendet `count` Pings (seq 0 … count−1) im Abstand `intervalMs` – den ersten sofort – und sammelt die Pongs.
 *
 * Löst auf, sobald kein Pong mehr aussteht, spätestens `timeoutMs` nach dem letzten Ping. Ein
 * `send() === false` zählt als gesendet-aber-verloren. Es zählen nur Pongs vom selben Kanal, deren
 * `seq` UND `sentAtMs` zu einem offenen Ping dieser Serie passen – Nachzügler einer früheren Serie
 * und Duplikate fallen so heraus. Beim Ende werden Handler und Timer immer abgeräumt; das Promise
 * lehnt nie ab.
 */
export function runPingSeries(router: MessageRouter, channel: Channel, options: PingSeriesOptions): Promise<PingStats> {
  const { count, intervalMs, timeoutMs, now } = options;
  return new Promise((resolve) => {
    const pending = new Map<number, number>();
    const samples: PingSample[] = [];
    let sent = 0;
    let finished = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = router.on('pong', (message, arrivedOn) => {
      if (arrivedOn !== channel || pending.get(message.seq) !== message.sentAtMs) return;
      pending.delete(message.seq);
      samples.push({ seq: message.seq, rttMs: now() - message.sentAtMs });
      if (sent >= count && pending.size === 0) finish();
    });

    function finish(): void {
      if (finished) return;
      finished = true;
      if (interval !== null) clearInterval(interval);
      if (timeout !== null) clearTimeout(timeout);
      unsubscribe();
      resolve(computePingStats(sent, samples));
    }

    function sendNext(): void {
      const seq = sent;
      const sentAtMs = now();
      sent += 1;
      // Vor dem Senden vormerken: ein Transport, der synchron zustellt, brächte den Pong sonst zu früh.
      pending.set(seq, sentAtMs);
      if (!router.send(channel, { type: 'ping', seq, sentAtMs })) pending.delete(seq);
      if (sent < count) return;
      if (interval !== null) clearInterval(interval);
      interval = null;
      if (pending.size === 0) finish();
      else timeout = setTimeout(finish, timeoutMs);
    }

    if (count <= 0) {
      finish();
      return;
    }
    sendNext();
    if (sent < count) interval = setInterval(sendNext, intervalMs);
  });
}
