# 23. `AccessDenied`'s "Go to Dashboard" link loops back to itself

**Depends on:** nothing — item 27 already landed the working sign-out control
this needs.
**Risk:** low — a dead-end button on a page that is already a dead end.
**Size:** ~15 minutes.

> Found while working item 13 on 2026-09-07. **Pre-existing.**
> Updated 2026-09-07 by item 27: the recommended fix changed (see step 1).

## The problem

`src/app/(demo)/demo/_components/access-denied.tsx` ends with:

```tsx
<Link href="/" ...>Go to Dashboard</Link>
```

There is no dashboard. `/` (`src/app/page.tsx`) is a `redirect('/demo')`, and
`/demo` is the page that just rendered `AccessDenied`. Clicking it returns the
user to the identical screen.

Both callers hit this:

- the group-membership refusal (`checkDemoAccess` returned false), and
- the "Profile Incomplete" render item 12 added for a signed-in user whose
  session has no `userGuid` — where the copy explicitly says *"Sign out and back
  in"*, but the only button on the page cannot do that.

## Steps

1. Decide what the button should do. The useful options, in order:
   - **Sign out** — render `<SignOutButton />` from
     `src/components/sign-out-button.tsx`. This is the action the Profile
     Incomplete copy asks for and the only one that can clear a bad session.
     Item 27 built it: it POSTs `/api/auth/logout`, which ends the Better Auth
     session *and* the MP IdP session, then navigates to MP's end-session URL.
     Pass `className` to match the page's primary-button styling
     (`bg-[#004C97] … text-white`) instead of the header's bordered variant.

     **Do not** link to `/api/auth/sign-out`, which is what the earlier version
     of this file suggested. Better Auth registers it POST-only so a link 404s,
     and even a correct POST would leave the MP session alive to sign the user
     straight back in — that was item 27. `src/lib/app-logout.test.ts` now
     fails the build if any source file names that endpoint or puts an
     `/api/auth/*` route behind an `href`.
   - Nothing — drop the link and leave the explanation, if there is no
     destination worth offering.
2. Consider letting the caller pass the action, the way item 12 made
   `title`/`message`/`icon` overridable: the two states may want different
   buttons (sign out for Profile Incomplete, nothing for a genuine access
   refusal).
3. Extend `src/app/(demo)/layout.test.tsx` (or a new
   `access-denied.test.tsx`) to assert the rendered destination, so this cannot
   silently regress to `/`.

## Done when

Neither `AccessDenied` state offers a link that returns the user to the same
screen, and the standard verification gate passes.
