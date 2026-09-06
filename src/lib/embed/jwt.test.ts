import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import {
  createWidgetToken,
  verifyWidgetToken,
  signStateToken,
  verifyStateToken,
} from './jwt';

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

    // Advance past the 5-minute (300s) expiry plus the 5s clock tolerance
    vi.setSystemTime(fixedNow + 306 * 1000);

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

describe('jwt - iss/aud and algorithm hardening', () => {
  const secretKey = () =>
    new TextEncoder().encode(process.env.EMBED_JWT_SECRET as string);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'EMBED_JWT_SECRET',
      'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256',
    );
  });

  it('stamps default iss and aud claims', async () => {
    const token = await createWidgetToken(baseClaims);
    const claims = await verifyWidgetToken(token);
    expect(claims.iss).toBe('mpnext-embed');
    expect(claims.aud).toBe('mpnext-embed-api');
  });

  it('honors EMBED_JWT_ISSUER / EMBED_JWT_AUDIENCE', async () => {
    vi.stubEnv('EMBED_JWT_ISSUER', 'custom-iss');
    vi.stubEnv('EMBED_JWT_AUDIENCE', 'custom-aud');
    const token = await createWidgetToken(baseClaims);
    const claims = await verifyWidgetToken(token);
    expect(claims.iss).toBe('custom-iss');
    expect(claims.aud).toBe('custom-aud');
  });

  it('rejects a token signed with the right key but the wrong issuer', async () => {
    const token = await new SignJWT({ ...baseClaims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('someone-else')
      .setAudience('mpnext-embed-api')
      .setExpirationTime('5m')
      .sign(secretKey());
    await expect(verifyWidgetToken(token)).rejects.toThrow(/Invalid token/);
  });

  it('rejects a token signed with the right key but the wrong audience', async () => {
    const token = await new SignJWT({ ...baseClaims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('mpnext-embed')
      .setAudience('some-other-api')
      .setExpirationTime('5m')
      .sign(secretKey());
    await expect(verifyWidgetToken(token)).rejects.toThrow(/Invalid token/);
  });

  it('rejects a token missing iss/aud entirely', async () => {
    const token = await new SignJWT({ ...baseClaims })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(secretKey());
    await expect(verifyWidgetToken(token)).rejects.toThrow(/Invalid token/);
  });

  it('rejects alg confusion: HS512 with the same secret', async () => {
    const token = await new SignJWT({ ...baseClaims })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuer('mpnext-embed')
      .setAudience('mpnext-embed-api')
      .setExpirationTime('5m')
      .sign(secretKey());
    await expect(verifyWidgetToken(token)).rejects.toThrow(/Invalid token/);
  });

  it('rejects alg confusion: unsigned "none" token', async () => {
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      ...baseClaims,
      iss: 'mpnext-embed',
      aud: 'mpnext-embed-api',
      iat: now,
      exp: now + 300,
    })}.`;
    await expect(verifyWidgetToken(token)).rejects.toThrow(/Invalid token/);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await new SignJWT({ ...baseClaims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('mpnext-embed')
      .setAudience('mpnext-embed-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-completely-different-secret-value-1234567890'));
    await expect(verifyWidgetToken(token)).rejects.toThrow(/Invalid token/);
  });

  it('rejects a well-formed token that lacks sub/wid', async () => {
    const token = await new SignJWT({ origin: 'https://example.com' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('mpnext-embed')
      .setAudience('mpnext-embed-api')
      .setExpirationTime('5m')
      .sign(secretKey());
    await expect(verifyWidgetToken(token)).rejects.toThrow(/missing required claims/);
  });

  it('tolerates up to 5s of clock skew past exp', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const token = await createWidgetToken(baseClaims);
    vi.setSystemTime(fixedNow + 304 * 1000);
    const claims = await verifyWidgetToken(token);
    expect(claims.sub).toBe(baseClaims.sub);
    vi.useRealTimers();
  });

  it('reads the secret lazily so a re-stubbed EMBED_JWT_SECRET takes effect', async () => {
    const token = await createWidgetToken(baseClaims);
    vi.stubEnv('EMBED_JWT_SECRET', 'rotated-secret-that-is-also-long-enough-for-hs256-use');
    await expect(verifyWidgetToken(token)).rejects.toThrow(/Invalid token/);
    const fresh = await createWidgetToken(baseClaims);
    const claims = await verifyWidgetToken(fresh);
    expect(claims.sub).toBe(baseClaims.sub);
  });

  it('throws in production when EMBED_JWT_SECRET is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMBED_JWT_SECRET', '');
    await expect(createWidgetToken(baseClaims)).rejects.toThrow(/EMBED_JWT_SECRET/);
  });
});

describe('jwt - v2 claims', () => {
  it('round-trips ver and sid without an mpAccessToken', async () => {
    const token = await createWidgetToken({
      sub: 'user-guid-123',
      wid: 'user-menu',
      origin: 'https://example.com',
      ver: 2,
      sid: 'opaque-sid',
    });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    );
    expect(payload.mpAccessToken).toBeUndefined();
    expect('mpAccessToken' in payload).toBe(false);

    const claims = await verifyWidgetToken(token);
    expect(claims.ver).toBe(2);
    expect(claims.sid).toBe('opaque-sid');
    expect(claims.mpAccessToken).toBeUndefined();
  });

  it('does not serialize undefined optional claims as null', async () => {
    const token = await createWidgetToken({
      sub: 'public',
      wid: 'full-calendar',
      origin: 'https://example.com',
      ver: 2,
      sid: undefined,
      mpAccessToken: undefined,
    });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    );
    expect('sid' in payload).toBe(false);
    expect('mpAccessToken' in payload).toBe(false);
  });

  it('rejects an unsupported ver value', async () => {
    const key = new TextEncoder().encode(process.env.EMBED_JWT_SECRET as string);
    const token = await new SignJWT({ ...baseClaims, ver: 3 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('mpnext-embed')
      .setAudience('mpnext-embed-api')
      .setExpirationTime('5m')
      .sign(key);
    await expect(verifyWidgetToken(token)).rejects.toThrow(/unsupported version/);
  });
});

describe('jwt - state tokens', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips an arbitrary payload', async () => {
    const token = await signStateToken(
      { state: 'abc', nonce: 'n1', origin: 'https://example.com', return_to: 'https://example.com/p' },
      600,
    );
    const payload = await verifyStateToken<{ state: string; nonce: string; origin: string }>(token);
    expect(payload.state).toBe('abc');
    expect(payload.nonce).toBe('n1');
    expect(payload.origin).toBe('https://example.com');
  });

  it('uses typ "nw-state" in the protected header', async () => {
    const token = await signStateToken({ state: 'abc' }, 600);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
    expect(header.typ).toBe('nw-state');
    expect(header.alg).toBe('HS256');
  });

  it('rejects a widget token presented as a state token (typ mismatch)', async () => {
    const widgetToken = await createWidgetToken(baseClaims);
    await expect(verifyStateToken(widgetToken)).rejects.toThrow(/Invalid state token/);
  });

  it('rejects a state token presented as a widget token (header typ mismatch)', async () => {
    const stateToken = await signStateToken(
      { sub: 'user', wid: 'user-menu', origin: 'https://example.com' },
      600,
    );
    await expect(verifyWidgetToken(stateToken)).rejects.toThrow(/Invalid token/);
  });

  it('honors the ttl', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const token = await signStateToken({ state: 'abc' }, 30);
    vi.setSystemTime(fixedNow + 29 * 1000);
    await expect(verifyStateToken(token)).resolves.toMatchObject({ state: 'abc' });
    vi.setSystemTime(fixedNow + 40 * 1000);
    await expect(verifyStateToken(token)).rejects.toThrow(/Invalid state token/);
  });

  it('rejects tampered state tokens', async () => {
    const token = await signStateToken({ state: 'abc' }, 600);
    const [h, p] = token.split('.');
    await expect(verifyStateToken(`${h}.${p}.bogus`)).rejects.toThrow(/Invalid state token/);
  });
});
