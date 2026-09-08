# 35. Legacy `next-user-menu` warns "MPWidgets.js not loaded" and renders no Sign In on the demo pages

**Depends on:** nothing.
**Risk:** none in production *if* the diagnosis below is only about the demo
pages. It is not yet proven to be demo-only — if it is a race, any host site
loading `MPWidgets.js` from a slow origin sees the same empty user menu.
**Size:** ~1 hour to diagnose, unknown to fix (depends which of the two causes
below it is).

> Found while browser-testing item 30 on 2026-09-08. **Pre-existing** and
> unrelated to that fix — the same warning is in the pre-fix baseline.

## The problem

In `legacy` mode, `next-user-menu` renders MP's own `<mpp-user-login>` into its
light DOM and slots it into the shadow root. On every demo page that loads
`MPWidgets.js`, that path produces:

```
[warning] [next-user-menu] <mpp-user-login> is not registered — MPWidgets.js
does not appear to be loaded on this page. …
```

…even though the script loads fine. Measured on 2026-09-08 with
`pnpm test:widget`, default (`legacy`) config, `demo-user-menu.html`:

| signal | value |
|---|---|
| `MPWidgets.js` response | `200 https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js` |
| `customElements.get("mpp-user-login")` after 4s | `true` |
| `<mpp-user-login>` in `next-user-menu`'s light DOM | present |
| its `shadowRoot` | `null` |
| its rendered text | `""` |
| its `getBoundingClientRect()` | `0 × 0` |

So the element is in the DOM, the custom element *is* registered a moment later,
and yet nothing ever upgrades or paints — **there is no Sign In button on the
page at all in legacy mode**. MP's own script also logs
`[AUTH] No token available when making AJAX request` and
`User not authenticated.` on the same pages.

## Two candidate causes — measure before fixing

1. **A race the widget never recovers from.** `ensureLightDOMLogin()`
   (`packages/embed-sdk/src/components/user-menu.ts:646`) checks
   `customElements.get("mpp-user-login")` once, warns, appends the element
   anyway "in case the script loads later" — and then nothing re-runs. There is
   an `authPollTimer` (`startAuthPoll()`), but it only polls `localStorage` for
   a token; it never re-renders on *registration*. If MPWidgets.js defines its
   elements asynchronously after its own load event, the warning is correct at
   the instant it fires and permanently stale afterwards. The fix would be a
   `customElements.whenDefined("mpp-user-login").then(() => this.render())`
   rather than a one-shot check.
2. **MP refuses to render for this origin.** `mpi.ministryplatform.com`'s widget
   may decline to paint on an origin it does not recognise (`localhost:5173`),
   in which case the empty `<mpp-user-login>` is MP's answer and only the
   *warning* is wrong. Item 29 already established that MP's OAuth client
   treats host-page origins as things that must be registered.

Distinguish them by loading `demo-user-menu.html` from `localhost:3000`
(`/demo/user-menu`, a registered origin) and by hooking
`customElements.whenDefined("mpp-user-login")` to timestamp registration
against the widget's first render.

## Why it matters

`legacy` is the **default** `EMBED_AUTH_MODE` and the mode every existing
customer is on until the item-29/30 hardened migration completes. If cause 1 is
right, this is a live sign-in outage on any host page where MPWidgets.js is
slow. It also makes the demo pages useless for QA'ing legacy login, which is
what `WIDGET-AUTH-MIGRATION-PLAN.md`'s per-customer cutover runbook asks
someone to do.

Note the warning text itself is actively misleading in the same way item 30's
banner was: it names a cause ("MPWidgets.js does not appear to be loaded") that
a 200 response contradicts.

## Done when

Either the demo pages render a working legacy Sign In button with no spurious
warning, or the warning is rewritten to state what was actually measured (script
loaded, element registered, MP declined to paint) and the origin requirement is
documented alongside `EMBED_ALLOWED_ORIGINS`. Standard verification gate passes.
