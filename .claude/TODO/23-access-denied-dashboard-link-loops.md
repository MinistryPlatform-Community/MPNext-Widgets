# 23. `AccessDenied`'s "Go to Dashboard" link loops back to itself

**Depends on:** nothing.
**Risk:** low — a dead-end button on a page that is already a dead end.
**Size:** ~15 minutes.

> Found while working item 13 on 2026-09-07. **Pre-existing.**

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
   - **Sign out** — `/api/auth/sign-out` (what the demo catalog header already
     links to, with the `no-html-link-for-pages` disable comment). This is the
     action the Profile Incomplete copy asks for and the only one that can clear
     a bad session.
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
