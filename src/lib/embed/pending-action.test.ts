import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPendingAction, consumePendingAction } from './pending-action';
import { createActionToken } from './action-token';
import { __resetSessionStoreForTests, getSessionStore } from './session-store';

interface Payload {
  title: string;
  description: string;
}

const guard = (data: unknown): Payload | null => {
  const d = data as Partial<Payload> | null;
  return d && typeof d.title === 'string' && typeof d.description === 'string'
    ? { title: d.title, description: d.description }
    : null;
};

const PAYLOAD: Payload = { title: 'Prayer for my mother', description: 'x'.repeat(2000) };

describe('pending-action', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetSessionStoreForTests();
  });

  it('round-trips a large payload', async () => {
    const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);
    const result = await consumePendingAction('prayer-feedback', token, guard);

    expect(result).toEqual({ ok: true, data: PAYLOAD });
  });

  it('keeps the token short regardless of payload size', async () => {
    // The reason the payload is not in the token: a 2000-character description
    // signs into a ~3KB URL, which mail clients and link rewriters mangle.
    const small = await createPendingAction('prayer-feedback', { title: 'a', description: 'b' }, 3600);
    const large = await createPendingAction('prayer-feedback', PAYLOAD, 3600);

    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThan(400);
  });

  describe('single use', () => {
    it('burns the record on first redemption', async () => {
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);

      expect((await consumePendingAction('prayer-feedback', token, guard)).ok).toBe(true);
      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'used',
      });
    });

    it('reports a third attempt as used, not invalid', async () => {
      const token = await createPendingAction('publication-verify', PAYLOAD, 3600);
      await consumePendingAction('publication-verify', token, guard);
      await consumePendingAction('publication-verify', token, guard);

      expect(await consumePendingAction('publication-verify', token, guard)).toEqual({
        ok: false,
        reason: 'used',
      });
    });
  });

  describe('expired is distinguishable from used', () => {
    it('reports an expired envelope as expired', async () => {
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 60);
      vi.setSystemTime(Date.now() + 61_000);

      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    it('proves expiry without touching the store', async () => {
      // The saving that makes the signed envelope worth its extra signature:
      // an expired link costs no store round-trip.
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 60);
      vi.setSystemTime(Date.now() + 61_000);

      const store = getSessionStore();
      const spy = vi.spyOn(store, 'kvGetDelete');
      await consumePendingAction('prayer-feedback', token, guard);

      expect(spy).not.toHaveBeenCalled();
    });

    it('expires the envelope before the stored record, so expired stays reachable', async () => {
      // If the record vanished first, `expired` would be unreachable and
      // `used` would silently absorb every genuinely expired link.
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 60);
      vi.setSystemTime(Date.now() + 61_000);

      const first = await consumePendingAction('prayer-feedback', token, guard);
      expect(first).toEqual({ ok: false, reason: 'expired' });
    });
  });

  describe('kinds cannot cross', () => {
    it('refuses a token minted for another kind', async () => {
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);

      expect(await consumePendingAction('publication-verify', token, guard)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('does not burn the record when the wrong kind is presented', async () => {
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);
      await consumePendingAction('publication-verify', token, guard);

      // Still redeemable at its real route.
      expect((await consumePendingAction('prayer-feedback', token, guard)).ok).toBe(true);
    });

    it('reports wrong-type as invalid, never naming the real flow', async () => {
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);
      const result = await consumePendingAction('publication-verify', token, guard);

      expect(result).toEqual({ ok: false, reason: 'invalid' });
      expect(JSON.stringify(result)).not.toContain('prayer-feedback');
    });
  });

  describe('rejection', () => {
    it('rejects a forged or malformed token', async () => {
      expect(await consumePendingAction('prayer-feedback', 'nope', guard)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('rejects an envelope with no jti', async () => {
      const token = await createActionToken('prayer-feedback', { notJti: 'x' }, 3600);

      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('rejects a valid envelope whose record was never stored', async () => {
      // A signed envelope for a jti we never wrote reads as redeemed, which is
      // the safe answer: it authorises nothing either way.
      const token = await createActionToken('prayer-feedback', { jti: 'never-stored' }, 3600);

      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'used',
      });
    });

    it('reports a payload the guard rejects as invalid, and still burns it', async () => {
      const token = await createPendingAction(
        'prayer-feedback',
        { unexpected: true } as unknown as Payload,
        3600
      );

      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'invalid',
      });
      // Already burned — a shape we cannot read is not worth keeping redeemable.
      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'used',
      });
    });
  });

  describe('fails closed', () => {
    it('refuses to redeem when the store is unreachable', async () => {
      // rate-limit.ts fails open so an outage cannot take widgets down. This
      // must not: writing a row on a token we could not verify is exactly what
      // the email round-trip exists to prevent.
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);

      const store = getSessionStore();
      vi.spyOn(store, 'kvGetDelete').mockRejectedValueOnce(new Error('ECONNRESET'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'unavailable',
      });
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('leaves the record redeemable after a store failure', async () => {
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);

      const store = getSessionStore();
      const spy = vi.spyOn(store, 'kvGetDelete').mockRejectedValueOnce(new Error('ECONNRESET'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await consumePendingAction('prayer-feedback', token, guard);
      spy.mockRestore();

      expect((await consumePendingAction('prayer-feedback', token, guard)).ok).toBe(true);
      errorSpy.mockRestore();
    });

    it('reports an unopenable record as invalid rather than succeeding', async () => {
      const token = await createPendingAction('prayer-feedback', PAYLOAD, 3600);

      const store = getSessionStore();
      vi.spyOn(store, 'kvGetDelete').mockResolvedValueOnce('not-a-sealed-value');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await consumePendingAction('prayer-feedback', token, guard)).toEqual({
        ok: false,
        reason: 'invalid',
      });

      errorSpy.mockRestore();
    });
  });

  it('stores the payload sealed, not in the clear', async () => {
    await createPendingAction('prayer-feedback', PAYLOAD, 3600);

    const store = getSessionStore();
    const spy = vi.spyOn(store, 'kvSet');
    await createPendingAction('prayer-feedback', PAYLOAD, 3600);

    const stored = spy.mock.calls[0][1];
    expect(stored).not.toContain('Prayer for my mother');
  });

  it('gives the store a longer TTL than the envelope', async () => {
    const store = getSessionStore();
    const spy = vi.spyOn(store, 'kvSet');

    await createPendingAction('prayer-feedback', PAYLOAD, 600);

    expect(spy.mock.calls[0][2]).toBe(600 + 300);
  });
});
