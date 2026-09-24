import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeStreamTracks, type StreamLike, type TrackLike } from '../../../src/lab/camera';
import type { TrackState } from '../../../src/lab/labTypes';

// Nur die REINE Naht der Kamera wird hier geprüft: `getUserMedia`, `<video>` und der Modul-Stream
// brauchen einen Browser und stehen deshalb in den Playwright-Tests (Vitest läuft mit environment 'node').

interface FakeTrack extends TrackLike {
  fire(type: string): void;
  listenerCount(): number;
}

function fakeTrack(id: string, readyState: 'live' | 'ended' = 'live'): FakeTrack {
  const listeners = new Map<string, Set<() => void>>();
  return {
    id,
    readyState,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    fire(type) { for (const listener of [...(listeners.get(type) ?? [])]) listener(); },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

const streamOf = (...tracks: FakeTrack[]): StreamLike => ({ getVideoTracks: () => tracks });

describe('observeStreamTracks', () => {
  it('meldet beim Anhängen einmal „live" je laufender Spur – eine beendete Spur nicht', () => {
    const seen: [TrackState, string][] = [];
    observeStreamTracks(streamOf(fakeTrack('a'), fakeTrack('b', 'ended')), (state, trackId) => seen.push([state, trackId]));
    expect(seen).toEqual([['live', 'a']]);
  });

  it('bildet mute/unmute/ended auf die Report-Zustände ab', () => {
    const track = fakeTrack('a');
    const seen: [TrackState, string][] = [];
    observeStreamTracks(streamOf(track), (state, trackId) => seen.push([state, trackId]));
    // Sperrbildschirm: Chrome für Android stummt die Spur und belebt sie wieder – erst `ended` ist endgültig.
    track.fire('mute');
    track.fire('unmute');
    track.fire('ended');
    expect(seen).toEqual([['live', 'a'], ['muted', 'a'], ['unmuted', 'a'], ['ended', 'a']]);
  });

  it('beobachtet jede Videospur einzeln', () => {
    const first = fakeTrack('a');
    const second = fakeTrack('b');
    const seen: [TrackState, string][] = [];
    observeStreamTracks(streamOf(first, second), (state, trackId) => seen.push([state, trackId]));
    second.fire('mute');
    expect(seen).toEqual([['live', 'a'], ['live', 'b'], ['muted', 'b']]);
  });

  it('die Rückgabe meldet alle Zuhörer ab und ist mehrfach aufrufbar', () => {
    const track = fakeTrack('a');
    const seen: TrackState[] = [];
    const stop = observeStreamTracks(streamOf(track), (state) => seen.push(state));
    expect(track.listenerCount()).toBe(3);
    stop();
    stop();
    expect(track.listenerCount()).toBe(0);
    track.fire('ended');
    expect(seen).toEqual(['live']);
  });
});

// Die Anforderung selbst hängt an `navigator.mediaDevices` und an Modul-Zustand: beides wird hier
// ersetzt bzw. je Test frisch geladen (`vi.resetModules`), damit kein Test den Stream des nächsten erbt.

/** Stream-Attrappe mit EINER laufenden Videospur, die ihre eigenen `stop()`-Aufrufe zählt. */
function streamDouble(): { media: MediaStream; stops(): number } {
  let stops = 0;
  const track = {
    id: 'video-1',
    readyState: 'live',
    stop(): void {
      stops += 1;
      track.readyState = 'ended';
    },
  };
  const media = { getVideoTracks: () => [track], getTracks: () => [track] };
  return { media: media as unknown as MediaStream, stops: () => stops };
}

/** `getUserMedia`, das erst auf Zuruf antwortet – nur so ist „während die Anforderung läuft" prüfbar. */
function pendingMediaDevices(): { answer: ((media: MediaStream) => void)[]; count(): number } {
  const answer: ((media: MediaStream) => void)[] = [];
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { answer.push(resolve); }) },
  });
  return { answer, count: () => answer.length };
}

const freshCamera = async (): Promise<typeof import('../../../src/lab/camera')> => {
  vi.resetModules();
  return import('../../../src/lab/camera');
};

describe('openLobbyCamera und restartCamera', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('zwei gleichzeitige Aufrufe lösen genau EIN getUserMedia aus und liefern denselben Stream', async () => {
    const gum = pendingMediaDevices();
    const camera = await freshCamera();

    const first = camera.openLobbyCamera();
    const second = camera.openLobbyCamera();
    // Zwei Anforderungen wären zwei Kameras: die zweite überschriebe den Stream der ersten, der dann
    // ungenutzt weiterliefe (Akku, Kamera-Lämpchen) – und der Sucher hinge am toten Stream.
    expect(gum.count()).toBe(1);

    const double = streamDouble();
    gum.answer[0]?.(double.media);
    expect(await first).toEqual({ running: true, gumCalled: true, error: null });
    expect(await second).toEqual(await first);
    expect(camera.cameraStream()).toBe(double.media);
    expect(gum.count()).toBe(1);
  });

  it('restartCamera wartet eine laufende Anforderung ab: alter Stream genau einmal beendet, genau eine neue Anforderung', async () => {
    const gum = pendingMediaDevices();
    const camera = await freshCamera();

    const open = camera.openLobbyCamera();
    const restart = camera.restartCamera();
    // Solange die erste Anforderung läuft, fragt der Neustart nicht dazwischen.
    expect(gum.count()).toBe(1);

    const first = streamDouble();
    gum.answer[0]?.(first.media);
    await open;
    await vi.waitFor(() => { expect(gum.count()).toBe(2); });
    // Der Stream, der erst nach dem Neustart-Klick eintraf, wird beendet – sonst liefe er für immer weiter.
    expect(first.stops()).toBe(1);

    const second = streamDouble();
    gum.answer[1]?.(second.media);
    expect((await restart).running).toBe(true);
    expect(camera.cameraStream()).toBe(second.media);
    expect(first.stops()).toBe(1);
    expect(gum.count()).toBe(2);
  });
});
