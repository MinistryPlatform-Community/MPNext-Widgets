# C71. Legacy `mpp-rss-reader` has no counterpart — no way to render a publication feed

**Widget:** none (old: Home / RSS, `/widgets`)
**Severity:** functional
**Confidence:** confirmed — MPWidgets.js loader table + the sample site's own home page; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

The **home page of MP's own sample widget site** is the RSS reader:

```html
<mpp-rss-reader publicationName="prayer"></mpp-rss-reader>
```

`observedAttributes` in `/widgets/dist/RssReader.js` is `["publicationname"]`, it is read
via `getAttribute("publicationname")`, and the configurator marks it **required**:

> **Publication Name** — `publicationname` — "Specifies the Publication that will populate
> this feed."

So: name a publication, get its items rendered on the page. The sample site points it at
`prayer`, which is the same publication family the Prayer & Feedback widget (C69) feeds —
the pair is "collect prayer requests" / "publish the prayer list", and MP put the second
half on its front page.

## New behaviour

No feed element exists in the 25-element `next-*` roster, and no route under
`src/app/api/embed/` (27 directories) serves publication content. `next-subscriptions`
manages *whether a contact receives* a publication; nothing renders *what is in* one.

## Why it matters

This is a publishing surface, not a filter: a church renders its prayer list, weekly
announcements, or devotional feed onto a page. Its absence is not worked around by any
other new widget — the closest thing is a church hand-writing a feed reader against MP's
API, which is exactly the work the embed SDK exists to remove. It is also, being MP's own
sample home page, the first widget a church evaluating the catalogue is likely to see.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets` →
  `<mpp-rss-reader publicationName="prayer">`
- Loader table entry: `{tag:"mpp-rss-reader", script:"/dist/RssReader.js", name:"RSS Reader"}`
  in `/widgets/dist/MPWidgets.js`
- Old surface: `observedAttributes` + the `getAttribute("publicationname")` call in
  `/widgets/dist/RssReader.js`; description from `/widgets/dist/WidgetConfigurator.js`
- New: `grep -rho 'customElements\.define(\s*"next-[a-z-]*' packages/embed-sdk/src` → 25
  elements, none for feeds/publications content; `ls src/app/api/embed/` → no feed route
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 2.1, 3

## Where to fix

- new `packages/embed-sdk/src/components/publication-feed.ts` (+ demo page)
- new `src/app/api/embed/publication-feed/route.ts`
- extend `src/services/subscriptionService.ts`, or add a service, to read publication items

## Suggested fix

Small and self-contained — a read-only list widget, closest in shape to
`next-my-groups`: one attribute (`publication-name`, or `publication-id`, which is what the
rest of the new SDK uses for ids), one GET, a card or list render, an empty state.

Check first **where the items live**: `mpp-rss-reader` takes a publication *name*, which
suggests it resolves to a feed MP exposes rather than reading rows directly. Inspect
`/widgets/dist/RssReader.js`'s endpoint before designing the service — if MP publishes an
actual RSS/Atom document, the route becomes a fetch-and-normalise rather than a table
query, and that decision shapes the whole item. I have not established which it is.

Lower priority than C70 and C72, which are the two publication gaps that block a flow
rather than a page.
