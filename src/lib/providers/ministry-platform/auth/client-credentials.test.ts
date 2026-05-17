import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getClientCredentialsToken } from '@/lib/providers/ministry-platform/auth/client-credentials';

/**
 * getClientCredentialsToken Tests
 *
 * Tests for the OAuth2 client credentials token acquisition function.
 * Tests cover:
 * - Successful token retrieval
 * - Correct request format (form-urlencoded body)
 * - Required parameters (grant_type, client_id, client_secret, scope)
 * - Error handling for failed token requests
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('getClientCredentialsToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch token using client credentials grant', async () => {
    const mockTokenResponse = {
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'http://www.thinkministry.com/dataplatform/scopes/all',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve(mockTokenResponse),
    });

    const result = await getClientCredentialsToken();

    expect(result).toEqual(mockTokenResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should POST to OAuth connect/token endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ access_token: 'token' }),
    });

    await getClientCredentialsToken();

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-mp.example.com/oauth/connect/token');
    expect(options.method).toBe('POST');
  });

  it('should send Content-Type: application/x-www-form-urlencoded', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ access_token: 'token' }),
    });

    await getClientCredentialsToken();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
  });

  it('should include grant_type=client_credentials in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ access_token: 'token' }),
    });

    await getClientCredentialsToken();

    const [, options] = mockFetch.mock.calls[0];
    const body = options.body as string;
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('client_credentials');
  });

  it('should include client_id from environment in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ access_token: 'token' }),
    });

    await getClientCredentialsToken();

    const [, options] = mockFetch.mock.calls[0];
    const params = new URLSearchParams(options.body as string);
    expect(params.get('client_id')).toBe('test-mp-client-id');
  });

  it('should include client_secret from environment in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ access_token: 'token' }),
    });

    await getClientCredentialsToken();

    const [, options] = mockFetch.mock.calls[0];
    const params = new URLSearchParams(options.body as string);
    expect(params.get('client_secret')).toBe('test-mp-client-secret');
  });

  it('should include scope in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ access_token: 'token' }),
    });

    await getClientCredentialsToken();

    const [, options] = mockFetch.mock.calls[0];
    const params = new URLSearchParams(options.body as string);
    expect(params.get('scope')).toBe(
      'http://www.thinkministry.com/dataplatform/scopes/all'
    );
  });

  it('should throw error when token request fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(getClientCredentialsToken()).rejects.toThrow(
      'Failed to get client credentials token: Unauthorized'
    );
  });

  it('should throw error on 500 server error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(getClientCredentialsToken()).rejects.toThrow(
      'Failed to get client credentials token: Internal Server Error'
    );
  });

  it('should propagate network errors', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(getClientCredentialsToken()).rejects.toThrow('Failed to fetch');
  });

  it('should return raw JSON response from token endpoint', async () => {
    const tokenResponse = {
      access_token: 'abc-123-def',
      token_type: 'Bearer',
      expires_in: 7200,
      scope: 'http://www.thinkministry.com/dataplatform/scopes/all',
      extra_field: 'preserved',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve(tokenResponse),
    });

    const result = await getClientCredentialsToken();

    expect(result).toEqual(tokenResponse);
  });
});
