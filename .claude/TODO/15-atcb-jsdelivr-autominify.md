# 15. `atcb.min.js` is jsDelivr-generated, not an npm artifact

**Depends on:** `10-sri-cdn-scripts.md` — **done** (this was found while
computing that item's hashes).
**Risk:** low today, but it is the one hole left in the SRI story.
**Size:** ~30 minutes, mostly re-verification.

## The problem

`packages/embed-sdk/src/components/add-to-calendar.ts` loads:

```
https://cdn.jsdelivr.net/npm/add-to-calendar-button@2.15.0/dist/atcb.min.js
```

That file **does not exist in the npm tarball.** Verified 2026-09-07:

```
npm pack add-to-calendar-button@2.15.0 && tar tzf ... | grep dist/
  package/dist/atcb.js                 555,091 bytes   (exists)
  package/dist/atcb.min.js             — absent
```

jsDelivr serves it by **auto-minifying `dist/atcb.js` on the fly** (437,916
bytes served vs 555,091 in the package). So `ATCB_SRI` pins bytes produced by
jsDelivr's minifier, not bytes published by the package author.

Contrast `FC_SRI`: `fullcalendar@6.1.21/index.global.min.js` **is** a real file
in the npm tarball, and its jsDelivr bytes hash identically to the tarball
copy — verified the same day.

## Why it matters

The whole premise of item 10 is "pinned version ⇒ immutable bytes ⇒ a hash is
meaningful forever." That holds for a published file. It does not strictly hold
for a CDN-side transform: if jsDelivr ever upgrades its minifier and the cached
object is evicted or purged, the bytes change under the same pinned URL and
**every host page hard-fails the integrity check at once** — the widget silently
degrades to the ICS fallback (buttons, no dropdown), which is exactly the failure
mode item 10 called out as easy to miss.

jsDelivr does send `cache-control: immutable, max-age=31536000` on it, so this is
unlikely rather than impossible. It is a supply-chain assumption we did not
intend to make, and nothing in the repo records it.

## Options

1. **Switch to the real npm file** — `dist/atcb.js` instead of `dist/atcb.min.js`,
   and hash that. Guarantees author-published, immutable bytes. Costs ~117KB
   uncompressed; both are served gzip/brotli so the wire cost is much smaller —
   **measure it before deciding** (`curl -sH 'accept-encoding: br' -o /dev/null
   -w '%{size_download}\n' <url>` for each).
2. **Keep `.min.js`** and just document the assumption next to `ATCB_SRI`.

Option 1 is preferred if the compressed delta is small; it removes the CDN from
the trust chain entirely rather than documenting it.

## Steps

1. Measure compressed sizes of `dist/atcb.js` vs `dist/atcb.min.js`.
2. If switching: update `ATCB_CDN_URL`, recompute `ATCB_SRI` against the new URL,
   and confirm the hash equals the npm tarball's own hash (that equality is the
   point — it is what tells you no CDN transform happened):
   ```
   npm pack add-to-calendar-button@2.15.0 && tar xzf add-to-calendar-button-2.15.0.tgz
   openssl dgst -sha384 -binary package/dist/atcb.js | openssl base64 -A
   ```
3. Either way, add a one-line note next to `ATCB_SRI` saying whether the hashed
   bytes are npm-published or CDN-generated, so the next person bumping the
   version knows which invariant they are relying on.
4. Browser-test `demo-add-to-calendar.html` — the dropdown must render
   (Apple / Google / iCal File / Outlook.com), not just the button.

## Done when

`ATCB_SRI` covers bytes whose provenance is written down, the dropdown still
renders, and the standard verification gate passes.
