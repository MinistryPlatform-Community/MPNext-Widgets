# 10. Add Subresource Integrity to the two CDN scripts

**Depends on:** `08-pin-add-to-calendar-cdn.md` — **done** on `dev` (PR #19).
**Risk:** low code change, but a wrong hash silently breaks a widget on every
host page. **Size:** ~45 minutes including verification.

Split out of item 8, which pinned the versions. Pinning was the prerequisite:
an SRI hash is meaningless against a floating range, because the bytes behind
the URL are allowed to change.

## The problem

`packages/embed-sdk/src/shared/cdn-loader.ts:6` takes only a URL and sets no
`integrity` or `crossOrigin` attribute:

```ts
export function loadScript(url: string): Promise<void> {
  // ...
  const script = document.createElement("script");
  script.src = url;
  script.async = true;
  // no integrity, no crossOrigin
  document.head.appendChild(script);
}
```

Both third-party scripts are now pinned to exact versions, so jsDelivr *should*
serve immutable bytes — but nothing verifies that. A compromised or
misconfigured CDN edge can serve different content under the same pinned URL and
it executes on church websites we do not control, in the top-level page context
(the script tag goes in `document.head`, not the Shadow DOM). SRI makes that
tamper-evident: the browser refuses to execute bytes that do not match the hash.

## The two call sites

There are exactly two, both already pinned:

| Call site | URL |
|---|---|
| `add-to-calendar.ts:173` | `add-to-calendar-button@2.15.0/dist/atcb.min.js` |
| `full-calendar.ts:122` | `fullcalendar@6.1.21/index.global.min.js` |

## Precomputed hashes

Verified against jsDelivr on 2026-09-07 with
`curl -sL "$url" | openssl dgst -sha384 -binary | openssl base64 -A`:

```
add-to-calendar-button@2.15.0/dist/atcb.min.js
  sha384-80vV/KEhBwD5tKGZUNJIP8v35xgzoh4G8XSqB97o794UbhhHRhOfKhrNGPFrhRwY

fullcalendar@6.1.21/index.global.min.js
  sha384-WDvnzcla8X1CQM97EnYyl4OoTCvmMFp5lBiVNO3IjVdvLMOUjwt+iuYb/Mru5A9v
```

**Recompute these rather than trusting the file.** They are correct for the
exact pinned versions above, but if either version has been bumped since this
was written the hashes are stale and will hard-fail the widget.

`crossOrigin = "anonymous"` is **required** — without it the browser cannot
check integrity on a cross-origin response and blocks the script. jsDelivr sends
`access-control-allow-origin: *` (verified 2026-09-07), so anonymous CORS works.

## Steps

1. Give `loadScript` an optional second argument. Keep it optional so the
   signature stays backward compatible and the existing tests keep passing:

   ```ts
   export function loadScript(url: string, integrity?: string): Promise<void> {
     // ...
     if (integrity) {
       script.integrity = integrity;
       script.crossOrigin = "anonymous";
     }
   ```

2. Put each hash next to the version constant it belongs to, so a version bump
   and its hash are impossible to miss:

   ```ts
   const ATCB_VERSION = "2.15.0";
   const ATCB_SRI = "sha384-80vV/...";
   ```

   Same shape for `FC_VERSION` / `FC_SRI` in `full-calendar.ts`. Add a comment on
   each pointing at the recompute command above — a bumped version with a stale
   hash is the main way this change bites later.

3. Pass the hash at both call sites.

## Two subtleties in the current implementation

Neither has to be fixed here, but decide deliberately and leave a comment:

- **The early-resolve path bypasses verification.** `cdn-loader.ts:11-15`
  resolves immediately if `document.querySelector('script[src="..."]')` finds an
  existing tag. If a host page already loaded the same URL *without* integrity,
  we adopt it and report success. Tightening this means also matching on the
  `integrity` attribute.
- **`scriptCache` is keyed by URL only.** Fine today (one hash per URL), but a
  second caller passing a different hash for the same URL would silently reuse
  the first promise.

## `injectExternalCSS` — leave it alone

`cdn-loader.ts:32` has the same gap, and `<link rel="stylesheet">` does support
`integrity`. But it has **no production callers** — only `cdn-loader.test.ts`
references it. FullCalendar 6.x injects its own CSS from
`index.global.min.js`, and `mp-widget-overrides.css` is served from our own
origin via the `customcss` attribute, not through this helper. Adding a
parameter to a helper nothing calls is churn; skip it unless a caller appears.

## Testing

The failure mode is asymmetric, so test both widgets — and note that a hash
mismatch fires `onerror`, which is the path `loadScript` rejects on:

- **`next-add-to-calendar` degrades.** `add-to-calendar.ts:172-178` wraps the
  load in `try/catch` and sets `cdnLoaded = false`, falling back to ICS. A bad
  hash here shows *working* buttons with no dropdown — easy to miss. Confirm the
  dropdown (Apple / Google / iCal File / Outlook.com) actually renders.
- **`next-full-calendar` errors visibly.** `loadFullCalendar()` does not catch;
  callers at lines 73-76 and 155-164 do, and line 162 renders
  `"Failed to load calendar library."` Only the `week` and `grid` views load
  FullCalendar at all (`needsFullCalendar()`), so switch to one of those.
- **Negative test:** temporarily corrupt one hash, reload, and confirm the
  browser blocks the script and the widget takes the path above. Then restore
  it. This is the only way to know the attribute is actually being applied
  rather than silently ignored.
- **Unit tests:** `packages/embed-sdk/src/shared/cdn-loader.test.ts` already
  asserts `src` and `async` on the created tag. Add cases for integrity set /
  omitted, and that `crossOrigin` is `"anonymous"` only when a hash is passed.

## Done when

Both CDN scripts load with a verified `integrity` hash and
`crossOrigin="anonymous"`, both widgets still work in their demo pages, a
deliberately corrupted hash is provably blocked by the browser, and the standard
verification gate passes.
