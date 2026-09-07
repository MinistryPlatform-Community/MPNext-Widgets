# 9. Fix `no-location-assign-relative-destination` in token-bridge

**Depends on:** nothing. **Risk:** low. **Size:** ~30 minutes.

## The warning

Surfaced by a rule that is **new in `eslint-config-next@16.3.4`** (bumped from
16.2.6 in the dependency pass). It is the only lint finding in the repo:

```
src/components/token-bridge/token-bridge.tsx
  71:9  warning  Do not use `window.location.href` to navigate to internal Next.js
                 pages. Use `redirect()` in the render phase, or `useRouter().push()`
                 in Client Components' event handlers instead.
                 @next/next/no-location-assign-relative-destination
```

Warning only — `pnpm lint` exits 0 and CI does not fail. This is the known
baseline referenced by `04-eslint-10.md`.

## Why it was left alone in the dependency pass

It is a real finding but **not** a dependency change, and it sits in the logout
and navigation path of the auth bridge. Changing navigation semantics there was
out of scope for a version-bump branch.

## The code (`token-bridge.tsx`, ~lines 60-75)

Inside a `userLogout` event handler:

```ts
const data = await res.json();
if (data.redirectUrl) {
  window.location.href = data.redirectUrl;   // (a) cross-origin — keep as-is
  return;
}
// ...
window.location.href = "/signin";            // (b) line 71 — the flagged one
```

## The important distinction

Only **(b)** is flagged, and only (b) should change.

- **(a)** assigns `data.redirectUrl`, which comes back from the logout API and is
  the **MP end-session URL** — a cross-origin, top-level navigation. It *must*
  stay a raw `window.location.href` assignment. `router.push()` cannot leave the
  origin, and per `CLAUDE.md` the OAuth login/callback/logout hops are
  deliberately top-level navigations. Do not "fix" this line.
- **(b)** is the internal `/signin` fallback — a relative, same-app route. That is
  the one the rule is actually about.

## Steps

1. Change **only** line 71 to client-side navigation: add
   `const router = useRouter();` (from `next/navigation`) at component top level,
   then call `router.push("/signin")`.
2. Leave (a) as `window.location.href`. If the rule flags it anyway — it should
   not, since the destination is not a relative literal — add a narrow
   `// eslint-disable-next-line` with a comment explaining it is a cross-origin
   top-level navigation to MP's end-session endpoint.
3. Verify `pnpm lint` reports **0 problems**. Completing this file is what makes
   the `04-eslint-10.md` baseline "zero warnings".

## Testing

Exercise logout manually, since `token-bridge` has no test coverage:

- Logout where the API **returns** a `redirectUrl` → must still land on MP's
  end-session page, i.e. the cross-origin navigation is intact.
- Logout where the API **fails or returns no** `redirectUrl` → must fall back to
  `/signin`. The `catch {}` swallows the error, so check both branches.

## Done when

`pnpm lint` reports 0 problems, both logout branches behave as before, and the
standard verification gate passes.
