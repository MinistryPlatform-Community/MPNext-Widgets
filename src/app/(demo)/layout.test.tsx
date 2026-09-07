import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

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

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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
    expect(screen.getByText('Profile Incomplete')).toBeTruthy();
    expect(screen.getByText(/MinistryPlatform user ID is missing/i)).toBeTruthy();
    expect(screen.queryByTestId('demo-catalog')).toBeNull();

    // No point calling the access check without the GUID it resolves.
    expect(checkDemoAccess).not.toHaveBeenCalled();

    // The cause has to reach the server log rather than failing silently.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain('userGuid');
  });

  it('treats an undefined userGuid the same way', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });

    await renderLayout();

    expect(screen.getByText('Profile Incomplete')).toBeTruthy();
    expect(checkDemoAccess).not.toHaveBeenCalled();
  });

  it('renders the demo children for a signed-in user with access', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', userGuid: 'guid-123' },
    });
    checkDemoAccess.mockResolvedValue(true);

    await renderLayout();

    expect(checkDemoAccess).toHaveBeenCalledWith('guid-123');
    expect(screen.getByTestId('demo-catalog')).toBeTruthy();
    expect(screen.queryByText('Access Denied')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('still renders Access Denied for a signed-in user without demo access', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user-1', userGuid: 'guid-123' },
    });
    checkDemoAccess.mockResolvedValue(false);

    await renderLayout();

    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(screen.queryByTestId('demo-catalog')).toBeNull();
    expect(screen.queryByText('Profile Incomplete')).toBeNull();
  });
});
