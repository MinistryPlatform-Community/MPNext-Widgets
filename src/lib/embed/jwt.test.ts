import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWidgetToken, verifyWidgetToken } from './jwt';

/**
 * JWT Tests
 *
 * Tests for the embed widget JWT utilities:
 * - createWidgetToken: signs HS256 JWTs with 5-minute expiry
 * - verifyWidgetToken: validates signature + expiry, decodes claims
 *
 * The shared secret comes from EMBED_JWT_SECRET, stubbed in src/test-setup.ts.
 */

const baseClaims = {
  sub: 'user-guid-123',
  wid: 'user-menu',
  mpAccessToken: 'mp-oauth-token',
  origin: 'https://example.com',
};

describe('jwt - createWidgetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces a 3-part JWT (header.payload.signature)', async () => {
    const token = await createWidgetToken(baseClaims);

    expect(typeof token).toBe('string');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    parts.forEach((part) => expect(part.length).toBeGreaterThan(0));
  });

  it('embeds the supplied claims in the payload', async () => {
    const token = await createWidgetToken(baseClaims);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    );

    expect(payload.sub).toBe(baseClaims.sub);
    expect(payload.wid).toBe(baseClaims.wid);
    expect(payload.mpAccessToken).toBe(baseClaims.mpAccessToken);
    expect(payload.origin).toBe(baseClaims.origin);
  });

  it('populates iat, exp (iat + 300), and a jti', async () => {
    const fixedNow = 1_700_000_000_000; // ms
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const token = await createWidgetToken(baseClaims);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    );

    const expectedIat = Math.floor(fixedNow / 1000);
    expect(payload.iat).toBe(expectedIat);
    expect(payload.exp).toBe(expectedIat + 300);
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
  });

  it('generates a unique jti per token', async () => {
    const a = await createWidgetToken(baseClaims);
    const b = await createWidgetToken(baseClaims);

    const payloadA = JSON.parse(Buffer.from(a.split('.')[1], 'base64').toString());
    const payloadB = JSON.parse(Buffer.from(b.split('.')[1], 'base64').toString());

    expect(payloadA.jti).not.toBe(payloadB.jti);
  });
});

describe('jwt - verifyWidgetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips: claims survive sign + verify intact', async () => {
    const token = await createWidgetToken(baseClaims);
    const claims = await verifyWidgetToken(token);

    expect(claims.sub).toBe(baseClaims.sub);
    expect(claims.wid).toBe(baseClaims.wid);
    expect(claims.mpAccessToken).toBe(baseClaims.mpAccessToken);
    expect(claims.origin).toBe(baseClaims.origin);
    expect(claims.iat).toBeTypeOf('number');
    expect(claims.exp).toBeTypeOf('number');
    expect(claims.jti).toBeTypeOf('string');
  });

  it('rejects tokens with a tampered signature', async () => {
    const token = await createWidgetToken(baseClaims);
    const [header, payload] = token.split('.');
    const tampered = `${header}.${payload}.bogus-signature`;

    await expect(verifyWidgetToken(tampered)).rejects.toThrow(/Invalid token/);
  });

  it('rejects tokens with a tampered payload', async () => {
    const token = await createWidgetToken(baseClaims);
    const [header, , signature] = token.split('.');

    // Replace payload with a different (validly-encoded) one — signature won't match
    const evilPayload = Buffer.from(
      JSON.stringify({ ...baseClaims, sub: 'attacker' }),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const tampered = `${header}.${evilPayload}.${signature}`;
    await expect(verifyWidgetToken(tampered)).rejects.toThrow(/Invalid token/);
  });

  it('rejects malformed tokens (wrong number of parts)', async () => {
    await expect(verifyWidgetToken('only.two')).rejects.toThrow(/Invalid token/);
    await expect(verifyWidgetToken('a.b.c.d')).rejects.toThrow(/Invalid token/);
    await expect(verifyWidgetToken('singlepart')).rejects.toThrow(/Invalid token/);
    await expect(verifyWidgetToken('')).rejects.toThrow(/Invalid token/);
  });

  it('rejects expired tokens', async () => {
    // Sign a token at t=0
    const fixedNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const token = await createWidgetToken(baseClaims);

    // Advance well past the 5-minute (300s) expiry
    vi.setSystemTime(fixedNow + 301 * 1000);

    await expect(verifyWidgetToken(token)).rejects.toThrow(/Token expired|Invalid token/);
  });

  it('accepts tokens just before expiry', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const token = await createWidgetToken(baseClaims);

    // 299s later — still inside the 300s window
    vi.setSystemTime(fixedNow + 299 * 1000);

    const claims = await verifyWidgetToken(token);
    expect(claims.sub).toBe(baseClaims.sub);
  });
});
