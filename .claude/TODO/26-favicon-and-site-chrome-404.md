# 26. The app's favicon 404s (`/assets/icons/favicon.ico` does not exist)

**Depends on:** nothing.
**Risk:** low — cosmetic, but it is a console error on every page load and the
matcher carries a dead exclusion because of it.
**Size:** ~15 minutes.

> Found while working item 25 on 2026-09-07. **Pre-existing.**

## The problem

`src/app/layout.tsx` declares

```ts
icons: {
  icon: "/assets/icons/favicon.ico",
}
```

but `public/` contains nothing except `embed-sdk/` — there is no
`public/assets/` directory at all. Measured against `pnpm build` + `pnpm start`
with no cookies:

```
/assets/icons/favicon.ico   404
/favicon.ico                404      <- browsers' implicit fallback
/robots.txt                 307 -> /signin
```

So every page emits `Failed to load resource: 404 (Not Found)` for the favicon,
and the tab shows the browser's default globe.

Two consequences worth deciding on together:

1. `src/proxy.ts`'s matcher excludes `assets/`, an exclusion that currently
   protects nothing, because nothing is served from there. It should either
   start being true (ship the asset) or the exclusion should go.
2. `/robots.txt` is not excluded and does not exist, so a crawler asking for it
   is redirected to `/signin` rather than getting a 404. Harmless today (the app
   is not meant to be crawled) but it is the same class of "a public,
   non-application URL gets an auth redirect" that item 25 fixed for
   `/embed-sdk/`.

## Steps

1. Add the icon. Either drop a real `favicon.ico` at
   `public/assets/icons/favicon.ico`, or use the App Router file convention
   (`src/app/icon.png` / `src/app/favicon.ico`) and delete the `icons` entry
   from `layout.tsx` metadata — the convention generates the tags and a hashed,
   cache-busted URL, which is the better of the two.
2. If you take the file-convention route, `assets/` in the `src/proxy.ts`
   matcher becomes dead and should be removed; `favicon.ico` is already
   excluded. Update `src/proxy.test.ts` accordingly (it asserts the current
   exclusions).
3. Decide on `robots.txt`. A `src/app/robots.ts` returning `disallow: '/'` is
   the App Router answer, and it is served from a path the proxy already lets
   through (it is a route, not a `public/` file — confirm which, and add the
   exclusion if not).

## Done when

A page load produces no 404 in the console, the tab shows the app's icon, the
proxy matcher contains no exclusion for a path that serves nothing, and the
standard verification gate passes.
