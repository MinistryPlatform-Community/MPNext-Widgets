# 16. `copy-sdk.js` leaves pre-hashing bundles in `public/embed-sdk/`

**Depends on:** nothing.
**Risk:** none in production (these files are gitignored and Vercel builds from
a clean tree) — but it actively misleads local verification.
**Size:** ~15 minutes.

## The problem

`scripts/copy-sdk.js` says it "cleans stale hashed files", and its
`stalePatterns` only matches the *current* naming scheme:

```js
const stalePatterns = [
  /^next-embed\.[a-f0-9]+\.es\.js(\.map)?$/,  // hashed bundles + maps
  /^next-embed\.js$/,                         // loader
  /^mp-widget-overrides\.[a-f0-9]+\.css$/,    // hashed CSS
];
```

Nothing matches the **pre-content-hashing** outputs, so on any machine that built
the SDK before that scheme landed, these survive every subsequent build forever:

```
public/embed-sdk/next-embed.es.js        161,376 bytes   dated 2026-03-25
public/embed-sdk/next-embed.es.js.map
public/embed-sdk/next-embed.umd.js       145,169 bytes   dated 2026-03-25
public/embed-sdk/next-embed.umd.js.map
```

(`.gitignore:13-17` covers all of them, so nothing is committed and nothing
deploys. Vercel starts from a clean checkout.)

## Why it is worth fixing anyway

They are a **verification trap.** The obvious way to confirm a change landed in
the bundle is `grep public/embed-sdk/next-embed.es.js` — and that file is a
March artifact still containing `fullcalendar@6.1.15` and the floating
`add-to-calendar-button@2`. It reads as "the change did not land" when the real,
current bundle is `next-embed.<hash>.es.js` next to it. This cost real time
during item 10; it will cost it again during item 7, whose own instructions say
to grep `public/embed-sdk/next-embed.*.es.js`.

## Steps

1. Widen the cleanup in `scripts/copy-sdk.js` so it removes anything matching
   `next-embed*` / `mp-widget-overrides*` that the current build did not just
   emit — i.e. compute the set of files being copied from `dist/` and delete
   every other `next-embed*` / `mp-widget-overrides.*.css` in `dest` first.
   That is self-maintaining, unlike another hand-written regex that will go
   stale the next time the naming scheme changes.
2. Keep `mp-widget-overrides.css` (unhashed) — it is the tracked **source** CSS
   that `hash-sdk.js` reads, not an output. Deleting it breaks the build.
3. Run `pnpm build:sdk` on a dirty `public/embed-sdk/` and confirm only the
   current hashed bundle, its map, the loader, the hashed CSS, and the source
   CSS remain.

## Done when

`pnpm build:sdk` leaves exactly the current build's artifacts in
`public/embed-sdk/`, and the standard verification gate passes.
