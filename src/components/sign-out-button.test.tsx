import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

/**
 * Cover for TODO 27 — the `/demo` header's Sign Out control.
 *
 * It used to be `<a href="/api/auth/sign-out">`: a GET at a POST-only endpoint,
 * so it 404'd and the user stayed signed in. These tests pin that the
 * replacement is a real control that drives the app's one logout path
 * (`POST /api/auth/logout` → MP end-session), not a navigation.
 */

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

const { SignOutButton } = await import('./sign-out-button');

type FetchCall = { url: string; method: string };

let calls: FetchCall[];
let logoutResponse: () => Response | Promise<Response>;
let originalLocation: PropertyDescriptor | undefined;
let locationHref: string;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** jsdom cannot navigate; href assignment is the assertion. */
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A real click, then a microtask drain so the async handler can settle. */
async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe('SignOutButton', () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    calls = [];
    logoutResponse = () =>
      json({ redirectUrl: 'https://mp.example.com/oauth/connect/endsession?id_token_hint=x' });
    localStorage.clear();
    sessionStorage.clear();
    stubLocation();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' });
        if (String(input) === '/api/auth/logout') return logoutResponse();
        throw new Error(`unexpected fetch: ${String(input)}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
    }
  });

  it('is a button, not a link to an API route', () => {
    render(<SignOutButton />);

    const control = screen.getByRole('button', { name: 'Sign Out' });
    expect(control.tagName).toBe('BUTTON');
    // A GET navigation is precisely what 404'd; nothing may reintroduce one.
    expect(document.querySelector('a[href^="/api/auth"]')).toBeNull();
  });

  it('POSTs the real logout endpoint and navigates to MP end-session', async () => {
    render(<SignOutButton />);

    await click(screen.getByRole('button', { name: 'Sign Out' }));
    await flush();

    expect(calls).toEqual([{ url: '/api/auth/logout', method: 'POST' }]);
    // Cross-origin: a raw location assignment, not router.push().
    expect(window.location.href).toBe(
      'https://mp.example.com/oauth/connect/endsession?id_token_hint=x',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('never calls the POST-only Better Auth sign-out endpoint', async () => {
    render(<SignOutButton />);

    await click(screen.getByRole('button', { name: 'Sign Out' }));
    await flush();

    expect(calls.some((c) => c.url.includes('/api/auth/sign-out'))).toBe(false);
  });

  it('clears the browser-held MP widget tokens', async () => {
    localStorage.setItem('mpp-widgets_AuthToken', 'stale');
    localStorage.setItem('mpp-widgets_IdToken', 'stale');
    sessionStorage.setItem('userObj', '{}');

    render(<SignOutButton />);
    await click(screen.getByRole('button', { name: 'Sign Out' }));
    await flush();

    expect(localStorage.getItem('mpp-widgets_AuthToken')).toBeNull();
    expect(localStorage.getItem('mpp-widgets_IdToken')).toBeNull();
    expect(sessionStorage.getItem('userObj')).toBeNull();
  });

  it('sends exactly one logout request when clicked twice', async () => {
    let resolveLogout: (r: Response) => void = () => {};
    logoutResponse = () => new Promise<Response>((r) => (resolveLogout = r));

    render(<SignOutButton />);
    const button = screen.getByRole('button', { name: 'Sign Out' });

    await click(button);
    await flush();

    expect(screen.getByRole('button')).toBeDisabled();
    await click(screen.getByRole('button'));
    await flush();

    expect(calls.filter((c) => c.url === '/api/auth/logout')).toHaveLength(1);

    await act(async () => {
      resolveLogout(json({ redirectUrl: 'https://mp.example.com/oauth/connect/endsession' }));
    });
  });

  it('falls back to /signin when the logout API fails', async () => {
    logoutResponse = () => {
      throw new Error('network down');
    };

    render(<SignOutButton />);
    await click(screen.getByRole('button', { name: 'Sign Out' }));
    await flush();

    expect(push).toHaveBeenCalledWith('/signin');
    expect(refresh).toHaveBeenCalled();
    expect(window.location.href).toBe('http://localhost:3000/demo');
  });

  it('falls back to /signin when the logout API returns no redirectUrl', async () => {
    logoutResponse = () => json({});

    render(<SignOutButton />);
    await click(screen.getByRole('button', { name: 'Sign Out' }));
    await flush();

    expect(push).toHaveBeenCalledWith('/signin');
  });
});
