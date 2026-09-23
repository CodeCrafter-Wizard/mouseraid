import { describe, expect, it } from 'vitest';
import { parseLabQuery, pingCountFor } from '../../../src/lab/labQuery';

describe('parseLabQuery', () => {
  it('liefert ohne Parameter den Text-Pfad mit Standardwerten', () => {
    expect(parseLabQuery('')).toEqual({ transport: 'text', room: 'standard', role: null, slot: 1, quick: false });
  });

  it('liest den BroadcastChannel-Modus mit Raum, Rolle und Platz', () => {
    expect(parseLabQuery('?transport=bc&room=r-42&role=client&slot=3&quick=1')).toEqual({
      transport: 'broadcast', room: 'r-42', role: 'client', slot: 3, quick: true,
    });
  });

  it('weist unbekannte Rollen und Plätze außerhalb 1–3 zurück', () => {
    const query = parseLabQuery('?transport=bc&role=chef&slot=7');
    expect(query.role).toBeNull();
    expect(query.slot).toBe(1);
    expect(parseLabQuery('?slot=2.5').slot).toBe(1);
    expect(parseLabQuery('?slot=abc').slot).toBe(1);
    // Die Ränder direkt daneben – 0 und 4 sind keine Plätze.
    expect(parseLabQuery('?slot=0').slot).toBe(1);
    expect(parseLabQuery('?slot=4').slot).toBe(1);
  });

  it('kürzt überlange Raumnamen und ersetzt einen leeren Raum', () => {
    expect(parseLabQuery(`?room=${'x'.repeat(80)}`).room).toHaveLength(40);
    expect(parseLabQuery('?room=').room).toBe('standard');
  });

  it('andere Werte für transport bedeuten den Text-Pfad', () => {
    expect(parseLabQuery('?transport=rtc').transport).toBe('text');
  });
});

describe('pingCountFor', () => {
  it('misst im Normalfall 200 Pings', () => {
    expect(pingCountFor('text', '')).toBe(200);
    expect(pingCountFor('qr', '')).toBe(200);
  });

  it('misst im Selbsttest (Pfad loopback) 50 Pings – zwei Läufe sollen in unter zwei Minuten durch sein', () => {
    expect(pingCountFor('loopback', '')).toBe(50);
    expect(pingCountFor('loopback', '?expect=abc')).toBe(50);
    expect(pingCountFor('loopback', '?quick=1')).toBe(20);
  });

  it('misst im BroadcastChannel-Modus und mit ?quick=1 nur 20 Pings', () => {
    expect(pingCountFor('broadcast', '')).toBe(20);
    expect(pingCountFor('text', '?quick=1')).toBe(20);
    // Beides zusammen bleibt beim Schnellmodus.
    expect(pingCountFor('broadcast', '?quick=1')).toBe(20);
  });
});
