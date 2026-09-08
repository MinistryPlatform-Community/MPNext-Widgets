import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LOGOUT_RETURN_TTL_SECONDS,
  isAllowedReturnTarget,
  openLogoutReturn,
  sealLogoutReturn,
} from './logout-return';

vi.mock('./config', () => ({
  allowedOrigins: ['https://allowed.example.com', '*.church.example.org'],
}));

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('isAllowedReturnTarget', () => {
  it.each([
    'https://allowed.example.com',
    'https://allowed.example.com/members?tab=giving#top',
    'https://first.church.example.org/goodbye',
  ])('accepts %s', (target) => {
    expect(isAllowedReturnTarget(target)).toBe(true);
  });

  it.each([
    ['an origin that is not embedded here', 'https://evil.example.net/'],
    ['a lookalike suffix', 'https://allowed.example.com.evil.net/'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['a relative path', '/members'],
    ['a protocol-relative URL', '//evil.example.net'],
    ['empty', ''],
    ['null', null],
  ])('rejects %s', (_why, target) => {
    expect(isAllowedReturnTarget(target)).toBe(false);
  });
});

describe('sealLogoutReturn / openLogoutReturn', () => {
  it('round-trips an allowed target and the id_token', async () => {
    const ticket = await sealLogoutReturn({
      returnTo: 'https://allowed.example.com/members',
      idToken: 'the-id-token',
    });
    expect(ticket).toBeTruthy();
    // Opaque: neither the destination nor the token is readable from the URL.
    expect(ticket).not.toContain('allowed.example.com');
    expect(ticket).not.toContain('the-id-token');

    expect(await openLogoutReturn(ticket)).toEqual({
      returnTo: 'https://allowed.example.com/members',
      idToken: 'the-id-token',
    });
  });

  it('round-trips without an id_token', async () => {
    const ticket = await sealLogoutReturn({ returnTo: 'https://allowed.example.com/', idToken: null });
    expect(await openLogoutReturn(ticket)).toEqual({ returnTo: 'https://allowed.example.com/' });
  });

  it('will not mint a ticket for an origin that is not embedded here', async () => {
    expect(await sealLogoutReturn({ returnTo: 'https://evil.example.net/' })).toBeNull();
    expect(await sealLogoutReturn({ returnTo: 'javascript:alert(1)' })).toBeNull();
  });

  it('refuses a tampered, malformed, or empty ticket instead of throwing', async () => {
    const ticket = (await sealLogoutReturn({ returnTo: 'https://allowed.example.com/' }))!;
    expect(await openLogoutReturn(`${ticket}x`)).toBeNull();
    expect(await openLogoutReturn('v1.aaaa.bbbb')).toBeNull();
    expect(await openLogoutReturn('nonsense')).toBeNull();
    expect(await openLogoutReturn('')).toBeNull();
    expect(await openLogoutReturn(null)).toBeNull();
  });

  it('expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const ticket = await sealLogoutReturn({ returnTo: 'https://allowed.example.com/' });

    vi.setSystemTime(new Date(Date.now() + (LOGOUT_RETURN_TTL_SECONDS - 5) * 1000));
    expect(await openLogoutReturn(ticket)).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + 10 * 1000));
    expect(await openLogoutReturn(ticket)).toBeNull();
  });

  it('re-checks the allowlist on open, not only on mint', async () => {
    const ticket = await sealLogoutReturn({ returnTo: 'https://first.church.example.org/bye' });
    expect(await openLogoutReturn(ticket)).not.toBeNull();

    const config = await import('./config');
    const original = [...config.allowedOrigins];
    config.allowedOrigins.length = 0;
    try {
      expect(await openLogoutReturn(ticket)).toBeNull();
    } finally {
      config.allowedOrigins.push(...original);
    }
  });
});
