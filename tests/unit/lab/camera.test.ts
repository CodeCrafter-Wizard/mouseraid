import { describe, expect, it } from 'vitest';
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
