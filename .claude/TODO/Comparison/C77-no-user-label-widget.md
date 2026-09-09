# C77. Legacy `mpp-user-label` has no counterpart — no way to render a single MP Application Label into a page

**Widget:** none (old: `mpp-user-label`, "User Defined Labels" — no sample page)
**Severity:** ux
**Confidence:** confirmed — MPWidgets.js loader table + the configurator's own metadata; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

MPWidgets.js knows the tag:

```js
{tag:"mpp-user-label", script:"/dist/UserLabels.js", name:"User Label"}
```

Its `observedAttributes` is `[]`, but `UserLabels.js` reads `name` and `bare` via
`getAttribute(...)`, and the configurator documents both:

- **Label Name** — `name` (**required**) — "Label Name defined in Application Labels"
- **Bare Text** — `bare` — "Determines whether to include CSS selectors or just a bare
  text object"

So it is a one-string element: name a label a church has defined in MP's Application
Labels, get that string rendered — wrapped in the widget's markup by default, or as bare
text with `bare="true"` so it can sit inline in a sentence.

Its purpose is to let the *page around* the widgets speak the same configured vocabulary
as the widgets themselves. A church that renamed "Groups" to "Life Groups" in MP puts
`<mpp-user-label name="groupsLabel" bare="true">` in its own heading and never has the
page and the widget disagree.

The sample site does not place this tag; it was found in the loader table. To compare it
you must place the tag yourself — see CONFIG-MAP.md section 5.

## New behaviour

No such element exists in the 25-element `next-*` roster — and it could not exist yet,
because the mechanism it depends on is absent too. There is no Application Labels reader
anywhere in this repo: no labels route under `src/app/api/embed/` (27 directories) and no
`GetLabels` equivalent in `packages/embed-sdk/src/`. That is the subject of **C67**, of
which this item is the smallest visible symptom.

## Why it matters

Filed at `ux` rather than `functional` because a church can hard-code the word into its own
page markup, which is a real workaround — unlike C67, where Shadow DOM leaves no way in.
What it loses is single-sourcing: rename the label in MP and the widgets follow while the
surrounding page does not, so a site drifts into using two names for the same ministry. On
its own that is a papercut; the reason it is worth a number is that it documents the
Application Labels dependency, and it is the natural first consumer of whatever C67 builds
— a good end-to-end test of the label pipeline before 25 widgets are converted onto it.

## Evidence

- Loader table `ut=[…]` in `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js`
  (offset ~684 900) — the `mpp-user-label` entry quoted above
- Old surface: `getAttribute("name")` / `getAttribute("bare")` in
  `https://mpi.ministryplatform.com/widgets/dist/UserLabels.js`; both documented in the
  `WidgetDetails.configurationItems` record in `/widgets/dist/WidgetConfigurator.js`
  (`observedAttributes` there is `[]` — the attributes are read at construction, not
  observed for change)
- No sample page: the tag appears on none of the 21 fetched pages
- New: 25-element roster has no label element; `ls src/app/api/embed/` has no labels route;
  `grep -rn 'GetLabels|getLabels' packages/embed-sdk/src src` → no matches
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 3, 5, and C67

## Where to fix

- new `packages/embed-sdk/src/components/user-label.ts` (+ demo page)
- depends on the labels endpoint and shared resolver proposed in **C67**

## Suggested fix

**Blocked on C67 — do not build it first.** Once a labels endpoint and a shared resolver
exist, this is the cheapest possible consumer: attributes `name` (required) and `bare`,
one lookup, one text node.

One deliberate difference from legacy worth considering: `bare="true"` exists so the string
can be dropped inline, but a Shadow DOM element cannot inherit the host page's typography
for its shadow content the way legacy's markup-free mode implies. If `bare` is meant to
mean "renders as if it were host-page text", this element may want to skip the shadow root
entirely and write into its own light DOM — the only element in the SDK that would. Decide
that explicitly rather than by default; a bare label that renders in the wrong font is
worse than no bare mode.

Lowest priority of the eleven missing widgets. If C67 is judged out of scope, close this as
"won't do" alongside it rather than leaving it open.
