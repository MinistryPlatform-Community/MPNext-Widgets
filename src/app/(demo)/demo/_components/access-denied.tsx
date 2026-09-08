import { SignOutButton } from "@/components/sign-out-button";

interface AccessDeniedProps {
  /** Heading. Defaults to the group-membership wording. */
  title?: string;
  /** Body copy explaining why access was refused. */
  message?: string;
  /** Emoji shown above the heading. */
  icon?: string;
}

/** Primary-button styling for this page, in place of the header's bordered variant. */
const ACTION_CLASS =
  "inline-block rounded-md bg-[#004C97] px-4 py-2 text-sm font-medium text-white hover:bg-[#002855] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The refusal screen for `/demo`, in both states `(demo)/layout.tsx` can hit:
 * a signed-in user who is not in the demo group, and a signed-in user whose
 * session carries no `userGuid`.
 *
 * The one control is **Sign Out** (TODO 23). It used to be
 * `<Link href="/">Go to Dashboard</Link>`, which was a dead end: there is no
 * dashboard, `/` is a `redirect('/demo')`, and `/demo` is the page that just
 * rendered this component — so the button returned the user to the identical
 * screen. Signing out is the only action that changes anything from here:
 *
 *   - "Profile Incomplete" says *"Sign out and back in"* in so many words, and
 *     a fresh session is what repopulates `userGuid`;
 *   - "Access Denied" is a property of the signed-in account, so signing out
 *     to come back as an account that does have access is the only self-serve
 *     way forward.
 *
 * It must be `SignOutButton` rather than any link to `/api/auth/*`: those
 * routes are POST-only, and ending the Better Auth session alone leaves the MP
 * IdP session to sign the user straight back into the same dead end (TODO 27).
 * `src/lib/app-logout.test.ts` fails the build if that regresses.
 */
export function AccessDenied({
  title = "Access Denied",
  message = "You don't have permission to access the Widget Demo Library. Contact your administrator to request access, or sign out to use a different account.",
  icon = "🔒",
}: AccessDeniedProps = {}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mb-4 text-6xl">{icon}</div>
        <h1 className="mb-2 text-2xl font-bold text-[#2D2926]">{title}</h1>
        <p className="mb-6 text-gray-600">{message}</p>
        <SignOutButton className={ACTION_CLASS} />
      </div>
    </div>
  );
}
