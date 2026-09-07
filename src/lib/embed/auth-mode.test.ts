import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { resolveAuthMode, parseAuthModeOverrides } from './auth-mode';

describe('parseAuthModeOverrides', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('returns an empty map for undefined/empty input', () => {
    expect(parseAuthModeOverrides(undefined).size).toBe(0);
    expect(parseAuthModeOverrides('').size).toBe(0);
    expect(parseAuthModeOverrides(' , ,').size).toBe(0);
  });

  it('parses origin=mode pairs', () => {
    const map = parseAuthModeOverrides('https://a.com=hardened,https://b.org=legacy, https://c.net = dual ');
    expect(map.get('https://a.com')).toBe('hardened');
    expect(map.get('https://b.org')).toBe('legacy');
    expect(map.get('https://c.net')).toBe('dual');
  });

  it('normalizes origins (case, trailing slash, path) and modes (case)', () => {
    const map = parseAuthModeOverrides('HTTPS://WWW.Example.com/=HARDENED,http://localhost:5173/some/path=Dual');
    expect(map.get('https://www.example.com')).toBe('hardened');
    expect(map.get('http://localhost:5173')).toBe('dual');
  });

  it('skips malformed entries and invalid modes', () => {
    const map = parseAuthModeOverrides('https://a.com=hardened,nonsense,https://b.org=bogus,=dual');
    expect(map.size).toBe(1);
    expect(map.get('https://a.com')).toBe('hardened');
  });
});

describe('resolveAuthMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
    vi.stubEnv('EMBED_AUTH_MODE', '');
    vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', '');
  });

  it('defaults to legacy', () => {
    vi.stubEnv('EMBED_AUTH_MODE', '');
    vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', '');
    expect(resolveAuthMode('https://example.com')).toBe('legacy');
    expect(resolveAuthMode('')).toBe('legacy');
  });

  it('honors EMBED_AUTH_MODE (case-insensitive, trimmed)', () => {
    vi.stubEnv('EMBED_AUTH_MODE', 'dual');
    expect(resolveAuthMode('https://example.com')).toBe('dual');
    vi.stubEnv('EMBED_AUTH_MODE', ' Hardened ');
    expect(resolveAuthMode('https://example.com')).toBe('hardened');
  });

  it('falls back to legacy on an invalid EMBED_AUTH_MODE and warns once per value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('EMBED_AUTH_MODE', 'strict-unique-bad-value');
    expect(resolveAuthMode('https://example.com')).toBe('legacy');
    expect(resolveAuthMode('https://other.com')).toBe('legacy');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/invalid value "strict-unique-bad-value"/);
    warn.mockRestore();
  });

  it('per-origin override wins over the global mode', () => {
    vi.stubEnv('EMBED_AUTH_MODE', 'legacy');
    vi.stubEnv(
      'EMBED_AUTH_MODE_ORIGINS',
      'https://pilot.example.com=hardened,https://dual.example.com=dual',
    );
    expect(resolveAuthMode('https://pilot.example.com')).toBe('hardened');
    expect(resolveAuthMode('https://dual.example.com')).toBe('dual');
    expect(resolveAuthMode('https://other.example.com')).toBe('legacy');
  });

  it('matches overrides on normalized origin', () => {
    vi.stubEnv('EMBED_AUTH_MODE', 'hardened');
    vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', 'https://Legacy.Example.com/=legacy');
    expect(resolveAuthMode('https://legacy.example.com')).toBe('legacy');
    expect(resolveAuthMode('HTTPS://LEGACY.EXAMPLE.COM')).toBe('legacy');
    expect(resolveAuthMode('https://legacy.example.com:8443')).toBe('hardened');
  });

  it('re-reads overrides when the env var changes', () => {
    vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', 'https://a.com=dual');
    expect(resolveAuthMode('https://a.com')).toBe('dual');
    vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', 'https://a.com=hardened');
    expect(resolveAuthMode('https://a.com')).toBe('hardened');
  });
});
