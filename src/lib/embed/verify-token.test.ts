import { describe, it, expect, vi, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { createVerifyToken, verifyVerifyToken } from './verify-token';
import { createWidgetToken } from './jwt';

/**
 * Plan Your Visit verification token tests (jose-backed).
 * Behavior contract: returns the payload on success, null on ANY failure.
 */

const data = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

describe('verify-token', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips name + email with typ pyv-verify', async () => {
    const token = await createVerifyToken(data);
    const payload = await verifyVerifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.typ).toBe('pyv-verify');
    expect(payload?.firstName).toBe('Ada');
    expect(payload?.lastName).toBe('Lovelace');
    expect(payload?.email).toBe('ada@example.com');
    expect(payload?.iat).toBeTypeOf('number');
    expect(payload?.exp).toBe((payload?.iat ?? 0) + 60 * 60 * 24);
  });

  it('honors a custom expiry and returns null once expired', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const token = await createVerifyToken(data, 60);

    vi.setSystemTime(fixedNow + 59 * 1000);
    expect(await verifyVerifyToken(token)).not.toBeNull();

    vi.setSystemTime(fixedNow + 61 * 1000);
    expect(await verifyVerifyToken(token)).toBeNull();
  });

  it('returns null for garbage input', async () => {
    expect(await verifyVerifyToken('')).toBeNull();
    expect(await verifyVerifyToken('a.b')).toBeNull();
    expect(await verifyVerifyToken('a.b.c')).toBeNull();
  });

  it('returns null for a tampered signature', async () => {
    const token = await createVerifyToken(data);
    const [h, p] = token.split('.');
    expect(await verifyVerifyToken(`${h}.${p}.AAAA`)).toBeNull();
  });

  it('returns null when a widget JWT is presented as a verify token', async () => {
    const widget = await createWidgetToken({
      sub: 'u',
      wid: 'plan-your-visit',
      origin: 'https://example.com',
      mpAccessToken: 'x',
    });
    expect(await verifyVerifyToken(widget)).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    const key = new TextEncoder().encode(process.env.EMBED_JWT_SECRET as string);
    const token = await new SignJWT({ typ: 'pyv-verify', firstName: 'Ada', lastName: '', email: 'a@b.c' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    expect(await verifyVerifyToken(token)).toBeNull();
  });

  it('returns null for HS512 alg confusion', async () => {
    const key = new TextEncoder().encode(process.env.EMBED_JWT_SECRET as string);
    const token = await new SignJWT({ typ: 'pyv-verify', ...data })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    expect(await verifyVerifyToken(token)).toBeNull();
  });
});
