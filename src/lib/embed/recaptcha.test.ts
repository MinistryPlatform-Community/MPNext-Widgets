import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyRecaptchaToken } from './recaptcha';

/**
 * reCAPTCHA Tests
 *
 * verifyRecaptchaToken:
 * - short-circuits to { success: true } when RECAPTCHA_SECRET_KEY is unset (dev mode)
 * - POSTs to google's siteverify endpoint with secret + response
 * - returns Google's `success` flag verbatim
 * - returns { success: false } on non-OK HTTP responses
 * - returns { success: false } on fetch throws
 */

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

describe('verifyRecaptchaToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Re-establish defaults from src/test-setup.ts that may be relevant
    vi.stubEnv('NODE_ENV', 'test');
    fetchSpy = vi.spyOn(global, 'fetch');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('short-circuits to success when RECAPTCHA_SECRET_KEY is not set', async () => {
    // Ensure secret key is unset
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');

    const result = await verifyRecaptchaToken('any-token');

    expect(result).toEqual({ success: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs token + secret to Google siteverify and returns success=true on success response', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'server-secret-123');
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await verifyRecaptchaToken('user-token-abc');

    expect(result).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe('POST');
    expect(
      (init.headers as Record<string, string>)['Content-Type'],
    ).toBe('application/x-www-form-urlencoded');

    // Body is URLSearchParams — read it back
    const body = init.body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('secret')).toBe('server-secret-123');
    expect(body.get('response')).toBe('user-token-abc');
  });

  it('returns success=false when Google reports verification failure', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'server-secret-123');
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await verifyRecaptchaToken('bad-token');
    expect(result).toEqual({ success: false });
  });

  it('returns success=false on non-OK HTTP response', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'server-secret-123');
    fetchSpy.mockResolvedValueOnce(
      new Response('upstream error', { status: 502 }),
    );

    const result = await verifyRecaptchaToken('user-token');
    expect(result).toEqual({ success: false });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns success=false when fetch throws', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'server-secret-123');
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    const result = await verifyRecaptchaToken('user-token');
    expect(result).toEqual({ success: false });
    expect(errorSpy).toHaveBeenCalled();
  });
});
