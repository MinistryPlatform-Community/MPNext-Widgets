# 8. Pin the `add-to-calendar-button` CDN URL (supply chain)

**Depends on:** nothing. **Risk:** low change. **Size:** ~15 minutes.
**Priority: highest signal-to-effort item in this batch.**

## The problem

`packages/embed-sdk/src/components/add-to-calendar.ts:20-21`:

```ts
const ATCB_CDN_URL =
  "https://cdn.jsdelivr.net/npm/add-to-calendar-button@2/dist/atcb.min.js";
```

That `@2` is a **floating major range**, not a version. jsDelivr resolves it to
whatever the latest 2.x is *at page load time*, on church websites we do not
control, inside the `next-add-to-calendar` widget — outside our build, our
lockfile, and any review. A new 2.x publish (or a compromised one) executes on
host pages with no action from us and no way to roll back short of an SDK
redeploy.

Compare `full-calendar.ts:23`, which pins an exact `FC_VERSION = "6.1.21"`. This
file is the odd one out; the inconsistency looks accidental rather than intended.

Latest at time of writing: **2.15.0**. The `next` dist-tag is `3.0.0-next.11` —
ignore it.

## Steps

1. Mirror the FullCalendar pattern, for consistency with its sibling component:

   ```ts
   const ATCB_VERSION = "2.15.0";
   const ATCB_CDN_URL =
     `https://cdn.jsdelivr.net/npm/add-to-calendar-button@${ATCB_VERSION}/dist/atcb.min.js`;
   ```

2. `pnpm build:sdk`, then confirm the pin is in the emitted bundle:
   `grep -o "add-to-calendar-button@[0-9.]*" public/embed-sdk/next-embed.*.es.js`
3. Smoke-test the widget: `pnpm test:widget` → `demo-add-to-calendar.html`.
   Add an event to a calendar and confirm the generated links work.
4. Note `add-to-calendar.ts:91` also carries a `"VERSION:2.0"` string in the
   element config. That is the library's own **config-schema** version, not the
   package version. Leave it alone unless the upgrade guide says otherwise.

## Follow-up worth considering (separate, optional)

Neither CDN script is loaded with Subresource Integrity. `loadScript(url)` in
`packages/embed-sdk/src/shared/cdn-loader.ts:6` takes only a URL and sets no
`integrity` or `crossOrigin` attribute. Adding an optional second argument for an
SRI hash would make both third-party scripts tamper-evident on host pages.

Pinning the version is the prerequisite — an SRI hash is meaningless against a
floating range — so do this file first and treat SRI as its own change.

## Done when

Both CDN scripts are pinned to exact versions, the widget still works in the
demo, and the standard verification gate passes.
