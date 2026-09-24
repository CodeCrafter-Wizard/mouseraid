import { describe, expect, it } from 'vitest';
import { requestWakeLock, type WakeLockEnv, type WakeLockSentinelLike, type WakeLockState } from '../../../src/platform/wakeLock';

/** Attrappe eines `WakeLockSentinel`: zählt Freigaben und kann das `release`-Ereignis des Browsers auslösen. */
function fakeSentinel(): WakeLockSentinelLike & { releases: number; fireRelease(): void } {
  const listeners: (() => void)[] = [];
  let released = false;
  return {
    get released() { return released; },
    releases: 0,
    release() {
      released = true;
      this.releases += 1;
      return Promise.resolve();
    },
    addEventListener(_type, listener) { listeners.push(listener); },
    // Der Browser gibt die Sperre bei Unsichtbarkeit von selbst frei und meldet das genau so.
    fireRelease() {
      released = true;
      for (const listener of listeners) listener();
    },
  };
}

interface FakeEnv {
  env: WakeLockEnv;
  states: WakeLockState[];
  requests: number;
  sentinels: ReturnType<typeof fakeSentinel>[];
  visible: boolean;
  fire(type: 'visibilitychange' | 'pagehide'): void;
  listenerCount(): number;
}

/** `request`-Verhalten je Aufruf: 'ok' liefert einen Sentinel, 'reject' lehnt ab, 'throw' wirft synchron. */
function fakeEnv(behaviour: readonly ('ok' | 'reject' | 'throw')[], options: { supported?: boolean } = {}): FakeEnv {
  const listeners = new Map<string, Set<() => void>>();
  const state: FakeEnv = {
    env: {
      request: options.supported === false ? undefined : (type) => {
        state.requests += 1;
        expect(type).toBe('screen');
        const mode = behaviour[state.requests - 1] ?? 'ok';
        if (mode === 'throw') throw new Error('kaputt');
        if (mode === 'reject') return Promise.reject(new Error('NotAllowedError'));
        const sentinel = fakeSentinel();
        state.sentinels.push(sentinel);
        return Promise.resolve(sentinel);
      },
      on(type, listener) {
        const set = listeners.get(type) ?? new Set<() => void>();
        set.add(listener);
        listeners.set(type, set);
        return () => { set.delete(listener); };
      },
      isVisible: () => state.visible,
    },
    states: [],
    requests: 0,
    sentinels: [],
    visible: true,
    fire(type) { for (const listener of [...(listeners.get(type) ?? [])]) listener(); },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
  return state;
}

describe('requestWakeLock', () => {
  it('meldet „unsupported“ und liefert null, wenn der Browser keinen Wake Lock kennt', async () => {
    const fake = fakeEnv([], { supported: false });
    const handle = await requestWakeLock((state) => fake.states.push(state), fake.env);
    expect(handle).toBeNull();
    expect(fake.states).toEqual(['unsupported']);
    // Ohne Sperre gibt es nichts zu beobachten – sonst hinge ein Zuhörer ohne Zweck an der Seite.
    expect(fake.listenerCount()).toBe(0);
  });

  it('meldet „denied“ und liefert null, wenn die Anforderung abgelehnt wird (headless Chromium)', async () => {
    const fake = fakeEnv(['reject']);
    const handle = await requestWakeLock((state) => fake.states.push(state), fake.env);
    expect(handle).toBeNull();
    expect(fake.states).toEqual(['denied']);
    expect(fake.listenerCount()).toBe(0);
  });

  it('wirft auch dann nicht, wenn `request` synchron wirft', async () => {
    const fake = fakeEnv(['throw']);
    await expect(requestWakeLock((state) => fake.states.push(state), fake.env)).resolves.toBeNull();
    expect(fake.states).toEqual(['denied']);
  });

  it('kommt ohne Rückruf aus', async () => {
    const fake = fakeEnv(['ok']);
    const handle = await requestWakeLock(undefined, fake.env);
    expect(handle?.state).toBe('acquired');
  });

  it('gibt bei `pagehide` frei und meldet sich ab; `release` ist mehrfach aufrufbar', async () => {
    const fake = fakeEnv(['ok']);
    const handle = await requestWakeLock((state) => fake.states.push(state), fake.env);
    expect(handle).not.toBeNull();
    expect(handle?.state).toBe('acquired');
    expect(fake.states).toEqual(['acquired']);

    fake.fire('pagehide');
    expect(fake.sentinels[0]?.releases).toBe(1);
    expect(handle?.state).toBe('released');
    expect(fake.states).toEqual(['acquired', 'released']);
    // Nach der Freigabe hängt kein Zuhörer mehr an der Seite.
    expect(fake.listenerCount()).toBe(0);

    handle?.release();
    handle?.release();
    expect(fake.sentinels[0]?.releases).toBe(1);
    expect(fake.states).toEqual(['acquired', 'released']);
  });

  it('fordert nach dem Sichtbarwerden neu an (der Browser gibt bei Unsichtbarkeit selbst frei)', async () => {
    const fake = fakeEnv(['ok', 'ok']);
    const handle = await requestWakeLock((state) => fake.states.push(state), fake.env);

    // Bildschirm aus: der Browser gibt die Sperre frei, die Seite wird unsichtbar.
    fake.visible = false;
    fake.sentinels[0]?.fireRelease();
    fake.fire('visibilitychange');
    expect(fake.requests).toBe(1); // unsichtbar wird NICHT neu angefordert
    expect(handle?.state).toBe('released');

    fake.visible = true;
    fake.fire('visibilitychange');
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.requests).toBe(2);
    expect(handle?.state).toBe('acquired');
    expect(fake.states).toEqual(['acquired', 'released', 'acquired']);

    // Die zweite Sperre hängt am selben Handle: `release` beendet auch sie.
    handle?.release();
    expect(fake.sentinels[1]?.releases).toBe(1);
  });

  it('fordert nicht neu an, solange die Sperre noch gehalten wird', async () => {
    const fake = fakeEnv(['ok', 'ok']);
    await requestWakeLock((state) => fake.states.push(state), fake.env);
    fake.fire('visibilitychange');
    await Promise.resolve();
    expect(fake.requests).toBe(1);
    expect(fake.states).toEqual(['acquired']);
  });

  it('meldet „denied“, wenn die erneute Anforderung scheitert – und wirft dabei nicht', async () => {
    const fake = fakeEnv(['ok', 'reject']);
    const handle = await requestWakeLock((state) => fake.states.push(state), fake.env);
    fake.sentinels[0]?.fireRelease();
    fake.fire('visibilitychange');
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.states).toEqual(['acquired', 'released', 'denied']);
    expect(handle?.state).toBe('denied');
  });

  it('gibt eine Sperre, die erst nach `pagehide` eintrifft, sofort wieder frei', async () => {
    const fake = fakeEnv(['ok', 'ok']);
    const handle = await requestWakeLock((state) => fake.states.push(state), fake.env);
    fake.sentinels[0]?.fireRelease();
    fake.fire('visibilitychange');       // startet die zweite Anforderung
    handle?.release();                   // …und der Nutzer verlässt die Seite, bevor sie eintrifft
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.sentinels[1]?.releases).toBe(1);
    expect(fake.states).toEqual(['acquired', 'released']);
  });
});
