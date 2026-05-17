import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Config Tests
 *
 * `allowedOrigins` is computed once at module-load time by `loadAllowedOrigins()`.
 * To test the load-time behavior we have to:
 *   1. stub the relevant env vars
 *   2. call `vi.resetModules()` so the next import re-evaluates the module
 *   3. dynamically `import('./config')` and assert against the freshly-loaded array
 */

describe('config - allowedOrigins', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // Ensure none of the consulted env vars leak between tests
    vi.stubEnv('EMBED_ALLOWED_ORIGINS', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is exported as an array', async () => {
    const mod = await import('./config');
    expect(Array.isArray(mod.allowedOrigins)).toBe(true);
  });

  it('returns an empty array when no relevant env vars are set', async () => {
    const mod = await import('./config');
    expect(mod.allowedOrigins).toEqual([]);
  });

  it('parses a comma-separated EMBED_ALLOWED_ORIGINS list', async () => {
    vi.stubEnv(
      'EMBED_ALLOWED_ORIGINS',
      'https://a.example.com,https://b.example.com,https://c.example.com',
    );

    const mod = await import('./config');
    expect(mod.allowedOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]);
  });

  it('trims whitespace and drops empty entries', async () => {
    vi.stubEnv(
      'EMBED_ALLOWED_ORIGINS',
      '  https://a.example.com  , ,https://b.example.com ,,',
    );

    const mod = await import('./config');
    expect(mod.allowedOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('adds VERCEL_URL with https:// prefix', async () => {
    vi.stubEnv('VERCEL_URL', 'preview-deploy-abc.vercel.app');

    const mod = await import('./config');
    expect(mod.allowedOrigins).toContain('https://preview-deploy-abc.vercel.app');
  });

  it('adds VERCEL_PROJECT_PRODUCTION_URL with https:// prefix', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'prod.example.com');

    const mod = await import('./config');
    expect(mod.allowedOrigins).toContain('https://prod.example.com');
  });

  it('combines all three sources in order: env list, VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL', async () => {
    vi.stubEnv(
      'EMBED_ALLOWED_ORIGINS',
      'https://a.example.com,https://b.example.com',
    );
    vi.stubEnv('VERCEL_URL', 'preview.vercel.app');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'prod.example.com');

    const mod = await import('./config');
    expect(mod.allowedOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://preview.vercel.app',
      'https://prod.example.com',
    ]);
  });
});
