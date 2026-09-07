# 22. `/demo/[slug]` loads `next-embed.es.js`, a file the build no longer emits

**Depends on:** nothing. Related to item 16 (the stale local copy is the only
reason this has never been noticed).
**Risk:** high on a clean deploy — every widget demo page fails to bootstrap.
**Size:** ~30 minutes.

> Found while browser-testing item 13 on 2026-09-07. **Pre-existing** — not
> introduced by that change.

## The problem

`src/app/(demo)/demo/_components/widget-demo.tsx:47,51` hardcodes the SDK URL:

```ts
const existing = document.querySelector('script[src="/embed-sdk/next-embed.es.js"]');
...
script.src = "/embed-sdk/next-embed.es.js";
```

The build does not produce that file. `scripts/hash-sdk.js` renames the Vite
output to a content-hashed name and writes a loader beside it, so
`packages/embed-sdk/dist/` — and therefore `public/embed-sdk/` after
`scripts/copy-sdk.js` — contains exactly:

```
mp-widget-overrides.<hash>.css
next-embed.<hash>.es.js
next-embed.<hash>.es.js.map
next-embed.js          <- the loader; sets __nextEmbedApiHost/BaseUrl/CSSUrl,
                          then dynamically imports the hashed bundle
```

On a clean checkout (Vercel builds from one) `/embed-sdk/next-embed.es.js` is a
**404**, the `script.onerror` fires, and every `/demo/<slug>` page logs
`Bootstrap failed: Failed to load SDK` with an empty demo container. Locally it
appears to work only because a pre-content-hashing `next-embed.es.js` from an
old build is still sitting in `public/embed-sdk/` — exactly the leftover item 16
is about. (Verifying item 13 required overwriting that leftover with the current
bundle by hand.)

Two more references carry the same wrong filename:

- `src/app/(demo)/demo/_components/implementation-code.tsx:19` — the embed
  snippet the demo tells host sites to copy:
  `<script type="module" src="https://your-host.com/embed-sdk/next-embed.es.js">`.
  A host site that copies it gets a 404 too, and it also bypasses the loader
  that sets `window.__nextEmbedApiHost` / `__nextEmbedCSSUrl`.
- `README.md:48` — "Single `<script type="module">` tag loads `next-embed.es.js`".

## Steps

1. Point `widget-demo.tsx` at the loader (`/embed-sdk/next-embed.js`) — both the
   `querySelector` de-dupe check and the injected `script.src`. The loader is
   the stable, unhashed entry point; that is why `hash-sdk.js` generates it.
2. Fix the copy-paste snippet in `implementation-code.tsx` and the README line
   to `next-embed.js` as well.
3. Confirm nothing else still references the old name:
   `grep -rn "next-embed\.es\.js" src packages README.md`.
4. Verify against a **clean** `public/embed-sdk/` (delete it, then
   `pnpm build:sdk`) so a leftover file cannot mask the result: load
   `/demo/user-menu` and confirm the event log reaches
   `SDK loaded (auto-initialized)` and the widget renders.

## Done when

`/demo/<slug>` bootstraps the SDK from a filename the build actually emits, with
no pre-hashing leftovers in `public/embed-sdk/`, and the standard verification
gate passes.
