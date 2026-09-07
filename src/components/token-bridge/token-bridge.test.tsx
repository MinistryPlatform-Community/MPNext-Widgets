import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, act } from '@testing-library/react';

/**
 * Cover for "`TokenBridge` never mounts on any reachable route".
 *
 * The bridge was rendered only by an `(app)` layout whose single page
 * `redirect()`ed away, so it never reached the client. The visible cost was
 * sign-out: `next-user-menu` dispatches a *cancelable* `userLogout` and falls
 * back to its own MP end-session redirect when nothing cancels it, which ends
 * the MP session while leaving the Better Auth cookie alive.
 *
 * These tests pin the contract the widget relies on:
 *   - `userLogout` is canceled synchronously (`defaultPrevented === true`), so
 *     the widget takes the bridge's path, not its own,
 *   - exactly one `POST /api/auth/logout` per logout (one listener),
 *   - the MP end-session URL from the server is still a real navigation,
 *   - and the `/signin` fallback survives an API failure.
 */

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const { TokenBridge } = await import('./token-bridge');

const TOKEN_KEYS = [
  'mpp-widgets_AuthToken',
  'mpp-widgets_IdToken',
  'mpp-widgets_ExpiresAfter',
  'mpp-widgets_Refresh',
];

/** Session-token payload the bridge copies into `localStorage`. */
const SESSION_TOKENS = {
  authenticated: true,
  accessToken: 'mp-access-token',
  idToken: 'mp-id-token',
  refreshToken: 'mp-refresh-token',
  expiresAt: 1_800_000_000,
};

type FetchCall = { url: string; method: string; body: unknown };

let calls: FetchCall[];
let sessionTokensResponse: () => Response;
let logoutResponse: () => Response | Promise<Response>;
let originalLocation: PropertyDescriptor | undefined;
let locationHref: string;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A `location` stand-in: jsdom cannot navigate, but href assignment is the assertion. */
function stubLocation() {
  originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
  locationHref = 'http://localhost:3000/demo';
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      get href() {
        return locationHref;
      },
      set href(value: string) {
        locationHref = value;
      },
      origin: 'http://localhost:3000',
    },
  });
}

/**
 * Dispatches `userLogout` the way `next-user-menu` does — bubbling and
 * composed from an element in the page — and reports what the widget would
 * conclude. `handled === true` means the widget skips its own redirect.
 */
function dispatchUserLogout(detail: { postLogoutRedirectUri?: string } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const event = new CustomEvent('userLogout', {
    detail,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  const notCanceled = host.dispatchEvent(event);
  host.remove();
  return { event, handled: !notCanceled };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TokenBridge', () => {
  beforeEach(() => {
    push.mockReset();
    calls = [];
    sessionTokensResponse = () => json(SESSION_TOKENS);
    logoutResponse = () =>
      json({ redirectUrl: 'https://mp.example.com/oauth/connect/endsession?id_token_hint=x' });

    localStorage.clear();
    sessionStorage.clear();
    stubLocation();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url === '/api/auth/session-tokens') return sessionTokensResponse();
        if (url === '/api/auth/logout') return logoutResponse();
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
    }
  });

  it('bridges the Better Auth session tokens into localStorage on mount', async () => {
    render(<TokenBridge />);
    await flush();

    expect(localStorage.getItem('mpp-widgets_AuthToken')).toBe('mp-access-token');
    expect(localStorage.getItem('mpp-widgets_IdToken')).toBe('mp-id-token');
    expect(localStorage.getItem('mpp-widgets_Refresh')).toBe('mp-refresh-token');
    expect(localStorage.getItem('mpp-widgets_ExpiresAfter')).toBe(
      new Date(SESSION_TOKENS.expiresAt * 1000).toString(),
    );
  });

  it('writes nothing when there is no Better Auth session', async () => {
    sessionTokensResponse = () => json({ authenticated: false }, 401);

    render(<TokenBridge />);
    await flush();

    for (const key of TOKEN_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('cancels the widget userLogout event so it does not take its own redirect', async () => {
    render(<TokenBridge />);
    await flush();

    const { event, handled } = dispatchUserLogout();

    // Synchronous: the widget checks `dispatchEvent`'s return value.
    expect(event.defaultPrevented).toBe(true);
    expect(handled).toBe(true);
    // The widget's own fallback would have navigated by now.
    expect(window.location.href).toBe('http://localhost:3000/demo');
  });

  it('signs out of Better Auth exactly once, then navigates to MP end-session', async () => {
    render(<TokenBridge />);
    await flush();

    TOKEN_KEYS.forEach((key) => localStorage.setItem(key, 'stale'));
    sessionStorage.setItem('userObj', '{}');

    dispatchUserLogout({ postLogoutRedirectUri: 'http://localhost:3000/demo' });
    await flush();

    const logoutCalls = calls.filter((c) => c.url === '/api/auth/logout');
    expect(logoutCalls).toHaveLength(1);
    expect(logoutCalls[0].method).toBe('POST');
    expect(logoutCalls[0].body).toEqual({
      postLogoutRedirectUri: 'http://localhost:3000/demo',
    });

    for (const key of TOKEN_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(sessionStorage.getItem('userObj')).toBeNull();

    // Cross-origin end-session: a raw location assignment, not router.push().
    expect(window.location.href).toBe(
      'https://mp.example.com/oauth/connect/endsession?id_token_hint=x',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('registers the userLogout listener exactly once across a remount', async () => {
    // StrictMode runs the effect, cleans it up, and runs it again. A missing
    // `removeEventListener` would leave two listeners and fire two
    // `POST /api/auth/logout` requests for a single sign-out.
    render(
      <StrictMode>
        <TokenBridge />
      </StrictMode>,
    );
    await flush();

    dispatchUserLogout();
    await flush();

    expect(calls.filter((c) => c.url === '/api/auth/logout')).toHaveLength(1);
  });

  it('falls back to /signin when the logout API fails', async () => {
    render(<TokenBridge />);
    await flush();

    logoutResponse = () => {
      throw new Error('network down');
    };

    dispatchUserLogout();
    await flush();

    expect(push).toHaveBeenCalledWith('/signin');
    expect(window.location.href).toBe('http://localhost:3000/demo');
  });

  it('falls back to /signin when the logout API returns no redirectUrl', async () => {
    render(<TokenBridge />);
    await flush();

    logoutResponse = () => json({});

    dispatchUserLogout();
    await flush();

    expect(push).toHaveBeenCalledWith('/signin');
  });

  it('stops listening once unmounted', async () => {
    const { unmount } = render(<TokenBridge />);
    await flush();

    unmount();

    const { handled } = dispatchUserLogout();
    await flush();

    expect(handled).toBe(false);
    expect(calls.filter((c) => c.url === '/api/auth/logout')).toHaveLength(0);
  });
});
