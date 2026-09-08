# 38. `mp-widget-overrides.css` is hashed, staged and advertised — and injected by nothing

**Depends on:** nothing.
**Risk:** MP-hosted Shadow DOM widgets may be rendering unbranded on host pages,
and `CLAUDE.md` documents a behaviour that does not exist.
**Size:** 30 min to confirm which of the two readings is true; unknown to fix.

Found on 2026-09-08 while doing item 16, whose whole difficulty was that this
CSS is both a build input and a public URL.

## The finding

The build goes to real trouble for this file. `scripts/hash-sdk.js` reads
`public/embed-sdk/mp-widget-overrides.css`, content-hashes it into
`mp-widget-overrides.<hash>.css`, and writes the hashed URL into the generated
loader:

```js
window.__nextEmbedCSSUrl = _base + '/mp-widget-overrides.856a46b3.css';
```

`vercel.json` gives the hashed copy `max-age=31536000, immutable` + `ACAO: *`
and the unhashed copy a 300s cache + `ACAO: *`. `packages/embed-sdk/src/index.ts`
declares `__nextEmbedCSSUrl?: string` on `Window`.

**Nothing reads it.** `grep -rn "__nextEmbedCSSUrl" packages src scripts` returns
the loader that writes it, the `Window` declaration, and `hash-sdk.js`. And
`injectExternalCSS()` (`packages/embed-sdk/src/shared/cdn-loader.ts:67`), the
function that would consume it, has **only test callers** —
`cdn-loader.test.ts:182,199`.

Meanwhile `CLAUDE.md` says:

> **MP widget styling**: `public/embed-sdk/mp-widget-overrides.css` injected into
> MP Shadow DOM widgets via `customcss` attribute. User-menu applies this
> automatically.

`packages/embed-sdk/src/components/user-menu.ts` is 1790 lines and contains no
occurrence of `css`, `customcss`, or `overrides`.

## The two readings, and why it matters which

1. **Churches paste the unhashed URL into MP config themselves.** Then the
   documentation line is wrong about *who* applies it, the `customcss` mention
   is a manual setup step rather than SDK behaviour, and
   `__nextEmbedCSSUrl` + the hashed copy + its immutable cache header are dead
   weight the build maintains for nobody.
2. **`<mpp-user-login>` was supposed to get `customcss` set on it and lost it.**
   Then every MP-hosted Shadow DOM widget the SDK injects is rendering
   unbranded right now, on every customer site, and the missing line is one
   attribute set in `watchMpLoginRegistration()`.

Reading 2 is a live styling regression; reading 1 is a docs fix plus a small
deletion. They are indistinguishable from the repo alone — settle it by loading
a demo page in `legacy` mode and looking at whether the MP login widget picks up
the brand colours.

## Steps

1. `pnpm test:widget`, open a demo page with `<next-user-menu>` in `legacy`
   mode, and inspect the injected `<mpp-user-login>`: does it carry a
   `customcss` attribute, and is `#004C97` reaching its Shadow DOM?
2. If not (reading 2): set `customcss` to `window.__nextEmbedCSSUrl` where
   `watchMpLoginRegistration()` inserts the tag, and pin it with a test in
   `user-menu-mp-login.test.ts`.
3. If it is applied by church-side MP config (reading 1): correct the
   `CLAUDE.md` line to say so, and decide whether `__nextEmbedCSSUrl`, the
   hashed CSS copy and its `vercel.json` rule earn their keep. **Do not delete
   the unhashed copy or its rule** — that is the URL churches point at, and
   `src/proxy.test.ts` / `src/app/site-chrome.test.ts` assert it resolves.

## Done when

`CLAUDE.md`'s MP-widget-styling line matches what the code does, and either a
test pins the `customcss` injection or the unused plumbing is gone.
