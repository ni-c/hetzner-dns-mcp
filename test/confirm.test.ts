import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmationStore, fingerprint } from '../src/confirm.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('ConfirmationStore', () => {
  it('issues unguessable, single-use tokens', () => {
    const store = new ConfirmationStore();
    const first = store.issue('zone:a');
    const second = store.issue('zone:b');

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    expect(store.consume('zone:a', first)).toBe(true);
    expect(store.consume('zone:a', first)).toBe(false);
  });

  it('does not accept a token for a different resource', () => {
    const store = new ConfirmationStore();
    const token = store.issue('zone:a');
    expect(store.consume('zone:b', token)).toBe(false);
  });

  it('rejects a missing or wrong token', () => {
    const store = new ConfirmationStore();
    store.issue('zone:a');
    expect(store.consume('zone:a', undefined)).toBe(false);
    expect(store.consume('zone:a', 'f'.repeat(32))).toBe(false);
  });

  it('expires tokens after the TTL', () => {
    vi.useFakeTimers();
    const store = new ConfirmationStore(60_000);
    const token = store.issue('zone:a');

    vi.advanceTimersByTime(60_001);

    expect(store.consume('zone:a', token)).toBe(false);
    expect(store.ttlMinutes).toBe(1);
  });

  it('evicts the oldest entry instead of growing without bound', () => {
    // A model looping on refused calls must not be able to grow the map.
    const store = new ConfirmationStore();
    const first = store.issue('zone:0');
    for (let i = 1; i <= 100; i++) store.issue(`zone:${i}`);

    expect(store.consume('zone:0', first)).toBe(false);
    expect(store.consume('zone:100', 'wrong')).toBe(false);
  });
});

describe('fingerprint', () => {
  it('separates different payloads and matches identical ones', () => {
    const a = fingerprint([{ value: '198.51.100.1' }]);
    expect(fingerprint([{ value: '198.51.100.1' }])).toBe(a);
    expect(fingerprint([{ value: '198.51.100.2' }])).not.toBe(a);
    expect(
      fingerprint([{ value: '198.51.100.1' }, { value: '198.51.100.2' }])
    ).not.toBe(a);
  });

  it('handles an absent payload', () => {
    expect(fingerprint(undefined)).toBe(fingerprint(null));
  });
});
