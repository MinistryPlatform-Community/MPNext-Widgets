import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

/**
 * Cover for TODO 23.
 *
 * `AccessDenied` is the end of the road for two states — a signed-in user who
 * is not in the demo group, and a signed-in user whose session has no
 * `userGuid` — and its only control used to be `<Link href="/">Go to
 * Dashboard</Link>`. There is no dashboard: `/` redirects to `/demo`, and
 * `/demo` re-renders this component, so the button looped back to itself. The
 * "Profile Incomplete" copy even tells the user to sign out, which that button
 * could not do.
 *
 * These tests pin that the control is a real sign-out (the app's single logout
 * path, TODO 27) in *both* states, and that no navigation back into the dead
 * end reappears.
 */

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

const { AccessDenied } = await import('./access-denied');

type FetchCall = { url: string; method: string };

let calls: FetchCall[];
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

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AccessDenied', () => {
  beforeEach(() => {
    calls = [];
    push.mockReset();
    refresh.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    stubLocation();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' });
        return json({ redirectUrl: 'https://mp.example.com/oauth/connect/endsession' });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
    }
  });

  describe('the group-membership refusal', () => {
    it('renders the default copy', () => {
      render(<AccessDenied />);

      expect(screen.getByText('Access Denied')).toBeTruthy();
      expect(screen.getByText(/don't have permission/i)).toBeTruthy();
    });

    it('offers Sign Out as its only control', () => {
      const { container } = render(<AccessDenied />);

      const button = screen.getByRole('button', { name: 'Sign Out' });
      expect(button.tagName).toBe('BUTTON');
      expect(container.querySelectorAll('a')).toHaveLength(0);
    });
  });

  describe('the Profile Incomplete render', () => {
    // `(demo)/layout.tsx` passes these three overrides for the missing-guid
    // state; the copy asks the user to sign out and back in.
    function renderIncomplete() {
      return render(
        <AccessDenied
          icon="⚠️"
          title="Profile Incomplete"
          message="You're signed in, but your MinistryPlatform user ID is missing from this session, so demo access can't be verified. Sign out and back in; if it keeps happening, contact your administrator."
        />,
      );
    }

    it('keeps the caller overrides', () => {
      renderIncomplete();

      expect(screen.getByText('Profile Incomplete')).toBeTruthy();
      expect(screen.getByText(/MinistryPlatform user ID is missing/i)).toBeTruthy();
      expect(screen.queryByText('Access Denied')).toBeNull();
    });

    it('offers the sign-out the copy asks for', () => {
      const { container } = renderIncomplete();

      expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
      expect(container.querySelectorAll('a')).toHaveLength(0);
    });
  });

  it('never links back to the page that rendered it', () => {
    // The regression under test: `/` is a redirect('/demo'), and `/demo`
    // renders this component, so any anchor to `/`, `/demo` or `/dashboard`
    // is a loop straight back to the same screen.
    for (const props of [{}, { title: 'Profile Incomplete' }]) {
      const { container, unmount } = render(<AccessDenied {...props} />);
      const hrefs = Array.from(container.querySelectorAll('a')).map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs).toEqual([]);
      unmount();
    }
  });

  it('drives the app logout path and leaves for MP end-session', async () => {
    render(<AccessDenied />);

    await click(screen.getByRole('button', { name: 'Sign Out' }));

    // The single logout mechanism (TODO 27): ends the Better Auth session and
    // the MP IdP session, so the user is not signed straight back in.
    expect(calls).toEqual([{ url: '/api/auth/logout', method: 'POST' }]);
    expect(locationHref).toBe('https://mp.example.com/oauth/connect/endsession');
    expect(push).not.toHaveBeenCalled();
  });

  it('falls back to /signin when MP returns no end-session URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' });
        return json({});
      }),
    );

    render(<AccessDenied />);
    await click(screen.getByRole('button', { name: 'Sign Out' }));

    // Anywhere but back to /demo — the Better Auth session is gone either way.
    expect(push).toHaveBeenCalledWith('/signin');
    expect(locationHref).toBe('http://localhost:3000/demo');
  });

  it('clears the browser-held MP tokens on the way out', async () => {
    localStorage.setItem('mpp-widgets_AuthToken', 'stale');
    sessionStorage.setItem('userObj', '{}');

    render(<AccessDenied />);
    await click(screen.getByRole('button', { name: 'Sign Out' }));

    expect(localStorage.getItem('mpp-widgets_AuthToken')).toBeNull();
    expect(sessionStorage.getItem('userObj')).toBeNull();
  });
});
