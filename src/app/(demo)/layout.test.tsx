import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Regression cover for the `/demo` infinite redirect loop.
 *
 * The layout used to guard with `if (!session?.user?.userGuid) redirect(...)`,
 * which conflated two states. A signed-in user whose session was missing
 * `userGuid` was sent to `/signin`, `/signin` saw a valid session and bounced
 * them back to `/demo`, and the browser span forever with no diagnostic.
 *
 * The three states below must stay distinct:
 *   - no session        -> redirect to /signin
 *   - session, no guid  -> explanatory render, never a redirect
 *   - session with guid -> normal access check
 */

const getSession = vi.fn();
const checkDemoAccess = vi.fn();

/** Thrown by the `redirect` mock so a redirect is observable, like Next's. */
class RedirectError extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
  // `AccessDenied` renders `SignOutButton`, a client component that reads the
  // router (TODO 23). Its own behaviour is covered by access-denied.test.tsx.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

vi.mock('./demo/_lib/check-demo-access', () => ({
  checkDemoAccess: (...args: unknown[]) => checkDemoAccess(...args),
}));

// Client component: it only appends a <script> in an effect, and its module
// graph is irrelevant to the guard under test.
vi.mock('./demo/_components/mp-widgets-loader', () => ({
  MPWidgetsLoader: () => null,
}));

// Client component: its behaviour is covered by token-bridge.test.tsx. Here we
// only care *that* it renders, and exactly once -- it used to be mounted by the
// unreachable `(app)` layout, which silently disabled server-side sign-out.
vi.mock('@/components/token-bridge', () => ({
  TokenBridge: () => <div data-testid="token-bridge" />,
}));

const { default: DemoLayout } = await import('./layout');

/** Renders the async server component's resolved element tree. */
async function renderLayout() {
  const element = await DemoLayout({
    children: <div data-testid="demo-catalog">Widget catalog</div>,
  });
  return render(element);
}

describe('DemoLayout access guard', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSession.mockReset();
    checkDemoAccess.mockReset();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  // TODO 24: the gate used to read the cookie cache, so a session cookie
  // captured before sign-out rendered the whole catalog until the cached JWT
  // expired (measured: 5 minutes). The guard is only as fresh as its read.
  it('reads the session store, not the cookie cache', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', userGuid: 'guid-123' },
    });
    checkDemoAccess.mockResolvedValue(true);

    await renderLayout();

    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    );
  });

  it('refuses a revoked session even when a cache cookie is presented', async () => {
    // The store is the authority: it says the session is gone, so it is gone,
    // whatever the replayed cookie claims.
    getSession.mockResolvedValue(null);

    await expect(
      renderLayout(),
    ).rejects.toThrow('NEXT_REDIRECT:/signin?callbackUrl=/demo');

    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    );
    expect(checkDemoAccess).not.toHaveBeenCalled();
  });

  it('redirects a signed-out request to /signin with a callbackUrl', async () => {
    getSession.mockResolvedValue(null);

    await expect(renderLayout()).rejects.toThrow(RedirectError);
    await expect(renderLayout()).rejects.toThrow(
      'NEXT_REDIRECT:/signin?callbackUrl=/demo',
    );

    expect(checkDemoAccess).not.toHaveBeenCalled();
  });

  it('redirects when a session exists but carries no user', async () => {
    getSession.mockResolvedValue({ session: { id: 's1' } });

    await expect(renderLayout()).rejects.toThrow(
      'NEXT_REDIRECT:/signin?callbackUrl=/demo',
    );
  });

  it('explains instead of redirecting when a signed-in user has no userGuid', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', email: 'qa@example.com', userGuid: null },
    });

    await renderLayout();

    // The bug: this state used to throw a redirect back to /signin.
    expect(screen.getByText('Profile Incomplete')).toBeInTheDocument();
    expect(screen.getByText(/MinistryPlatform user ID is missing/i)).toBeInTheDocument();
    expect(screen.queryByTestId('demo-catalog')).not.toBeInTheDocument();

    // No point calling the access check without the GUID it resolves.
    expect(checkDemoAccess).not.toHaveBeenCalled();

    // The cause has to reach the server log rather than failing silently.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain('userGuid');
  });

  it('treats an undefined userGuid the same way', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });

    await renderLayout();

    expect(screen.getByText('Profile Incomplete')).toBeInTheDocument();
    expect(checkDemoAccess).not.toHaveBeenCalled();
  });

  it('renders the demo children for a signed-in user with access', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', userGuid: 'guid-123' },
    });
    checkDemoAccess.mockResolvedValue(true);

    await renderLayout();

    expect(checkDemoAccess).toHaveBeenCalledWith('guid-123');
    expect(screen.getByTestId('demo-catalog')).toBeInTheDocument();
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  // `/demo` is the only page a signed-in user renders (`/` just redirects
  // here), so this layout is the one place `TokenBridge` can mount -- and it
  // must mount exactly once, or widget sign-out fires `POST /api/auth/logout`
  // twice.
  it('mounts exactly one TokenBridge for a signed-in user with access', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', userGuid: 'guid-123' },
    });
    checkDemoAccess.mockResolvedValue(true);

    await renderLayout();

    expect(screen.getAllByTestId('token-bridge')).toHaveLength(1);
  });

  it('does not mount TokenBridge when access is refused', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', userGuid: 'guid-123' },
    });
    checkDemoAccess.mockResolvedValue(false);

    await renderLayout();

    expect(screen.queryByTestId('token-bridge')).not.toBeInTheDocument();
  });

  it('does not mount TokenBridge when the session has no userGuid', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });

    await renderLayout();

    expect(screen.queryByTestId('token-bridge')).not.toBeInTheDocument();
  });

  it('still renders Access Denied for a signed-in user without demo access', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', userGuid: 'guid-123' },
    });
    checkDemoAccess.mockResolvedValue(false);

    await renderLayout();

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('Profile Incomplete')).not.toBeInTheDocument();
  });

  /**
   * TODO 23. Both refusal states are terminal: the layout renders them instead
   * of the catalog, so whatever control they carry is the user's only way out.
   * It used to be "Go to Dashboard" → `/` → `redirect('/demo')` → this same
   * screen. Sign-out is the only action that changes the outcome — it clears
   * the session whose `userGuid` is missing, and it lets a refused user come
   * back as an account that has access.
   */
  it.each([
    [
      'the access refusal',
      { user: { id: 'user-1', userGuid: 'guid-123' } },
      false,
      'Access Denied',
    ],
    ['the missing-userGuid render', { user: { id: 'user-1' } }, undefined, 'Profile Incomplete'],
  ])('offers a working sign-out and no loop back on %s', async (_name, session, access, heading) => {
    getSession.mockResolvedValue(session);
    if (access !== undefined) checkDemoAccess.mockResolvedValue(access);

    const { container } = await renderLayout();

    expect(screen.getByText(heading)).toBeInTheDocument();

    // A real control, not a navigation: `/api/auth/sign-out` is POST-only and
    // would leave the MP session alive anyway (TODO 27).
    const button = screen.getByRole('button', { name: 'Sign Out' });
    expect(button.tagName).toBe('BUTTON');

    // No anchor at all -- every destination reachable from here (`/`, `/demo`,
    // `/dashboard`) lands the user back on this screen.
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});
