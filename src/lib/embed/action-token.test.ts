import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import {
  ACTION_TOKEN_EXPIRY,
  createActionToken,
  verifyActionToken,
  type ActionTokenType,
} from './action-token';
import { JWT_ALGORITHM } from './jwt';

/** The guard used by most cases: accepts a payload carrying a string `id`. */
const idGuard = (payload: Record<string, unknown>) =>
  typeof payload.id === 'string' && payload.id ? { id: payload.id } : null;

describe('action-token', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a payload for the expected type', async () => {
    const token = await createActionToken('unsubscribe', { id: 'abc' });
    const result = await verifyActionToken('unsubscribe', token, idGuard);

    expect(result).toEqual({ ok: true, data: { id: 'abc' } });
  });

  describe('typ is an input, never trusted from the token', () => {
    it('refuses a token minted for a different flow', async () => {
      // The security property of the whole module: without this, an
      // email-confirmation token is replayable at the unsubscribe route.
      const token = await createActionToken('publication-verify', { id: 'abc' });
      const result = await verifyActionToken('unsubscribe', token, idGuard);

      expect(result).toEqual({ ok: false, reason: 'wrong-type' });
    });

    it('refuses a validly signed token with no typ at all', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ id: 'abc' })
        .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + 600)
        .sign(new TextEncoder().encode(process.env.EMBED_JWT_SECRET!));

      const result = await verifyActionToken('unsubscribe', token, idGuard);
      expect(result).toEqual({ ok: false, reason: 'wrong-type' });
    });

    it('does not let a caller-supplied payload override typ', async () => {
      // `createActionToken` spreads `data` then sets `typ`, so a payload key
      // named `typ` cannot smuggle in a different flow.
      const token = await createActionToken('publication-verify', {
        id: 'abc',
        typ: 'unsubscribe',
      });

      expect(await verifyActionToken('unsubscribe', token, idGuard)).toEqual({
        ok: false,
        reason: 'wrong-type',
      });
      expect(await verifyActionToken('publication-verify', token, idGuard)).toEqual({
        ok: true,
        data: { id: 'abc' },
      });
    });
  });

  describe('expiry', () => {
    it('reports an expired token as expired, not invalid', async () => {
      // "This link has expired, here is a new one" is actionable where
      // "invalid link" reads like our bug.
      const token = await createActionToken('prayer-feedback', { id: 'abc' }, 60);
      vi.setSystemTime(Date.now() + 61_000);

      expect(await verifyActionToken('prayer-feedback', token, idGuard)).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    it('is still valid one second before expiry', async () => {
      const token = await createActionToken('prayer-feedback', { id: 'abc' }, 60);
      vi.setSystemTime(Date.now() + 59_000);

      expect((await verifyActionToken('prayer-feedback', token, idGuard)).ok).toBe(true);
    });

    it('honours an explicit expiry over the per-flow default', async () => {
      const token = await createActionToken('unsubscribe', { id: 'abc' }, 60);
      vi.setSystemTime(Date.now() + 61_000);

      // Would still be valid on the 180-day default.
      expect((await verifyActionToken('unsubscribe', token, idGuard)).ok).toBe(false);
    });

    it('gives unsubscribe a long default, because an expired unsubscribe is a regression', async () => {
      const token = await createActionToken('unsubscribe', { id: 'abc' });
      vi.setSystemTime(Date.now() + 60 * 60 * 24 * 179 * 1000);

      expect((await verifyActionToken('unsubscribe', token, idGuard)).ok).toBe(true);
      expect(ACTION_TOKEN_EXPIRY.unsubscribe).toBe(60 * 60 * 24 * 180);
    });

    it('has a positive default for every declared type', () => {
      const types: ActionTokenType[] = [
        'pyv-verify',
        'prayer-feedback',
        'publication-verify',
        'unsubscribe',
      ];
      for (const t of types) {
        expect(ACTION_TOKEN_EXPIRY[t]).toBeGreaterThan(0);
      }
    });
  });

  describe('rejection', () => {
    it('rejects an empty or non-string token', async () => {
      expect(await verifyActionToken('unsubscribe', '', idGuard)).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(
        await verifyActionToken('unsubscribe', null as unknown as string, idGuard)
      ).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects a token signed with a different secret', async () => {
      const now = Math.floor(Date.now() / 1000);
      const forged = await new SignJWT({ typ: 'unsubscribe', id: 'abc' })
        .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + 600)
        .sign(new TextEncoder().encode('a-different-secret-that-is-also-32-bytes-long'));

      expect(await verifyActionToken('unsubscribe', forged, idGuard)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('rejects a tampered payload', async () => {
      const token = await createActionToken('unsubscribe', { id: 'abc' });
      const [header, , signature] = token.split('.');
      const swapped = Buffer.from(
        JSON.stringify({ typ: 'unsubscribe', id: 'zzz', iat: 1, exp: 9_999_999_999 })
      ).toString('base64url');

      expect(
        await verifyActionToken('unsubscribe', [header, swapped, signature].join('.'), idGuard)
      ).toEqual({ ok: false, reason: 'invalid' });
    });

    it('reports a payload the guard rejects as invalid', async () => {
      const token = await createActionToken('unsubscribe', { somethingElse: 1 });

      expect(await verifyActionToken('unsubscribe', token, idGuard)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('does not run the guard when the signature fails', async () => {
      const guard = vi.fn(idGuard);
      await verifyActionToken('unsubscribe', 'not.a.token', guard);
      expect(guard).not.toHaveBeenCalled();
    });

    it('does not run the guard when the type is wrong', async () => {
      const token = await createActionToken('publication-verify', { id: 'abc' });
      const guard = vi.fn(idGuard);

      await verifyActionToken('unsubscribe', token, guard);
      expect(guard).not.toHaveBeenCalled();
    });
  });

  it('carries the payload in the clear — signed, not encrypted', async () => {
    // Documented behaviour worth pinning: nothing secret goes in here.
    const token = await createActionToken('unsubscribe', { id: 'abc' });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf-8')
    );

    expect(payload.id).toBe('abc');
    expect(payload.typ).toBe('unsubscribe');
  });
});
