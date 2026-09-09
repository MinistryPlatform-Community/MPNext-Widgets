# C35. Four giving widgets emit no heading elements at all; the legacy widgets they replace emit a full `h1`/`h3`/`h4` outline

**Widget:** `next-my-giving`, `next-my-pledges`, `next-my-contribution-statement`, `next-statement-preferences` (old: My Giving, My Pledges, My Contribution Statement)
**Severity:** ux
**Confidence:** confirmed — enumerated `h1…h6` in every shadow root on both systems with the same data loaded.
**Found:** 2026-09-08, comparison run

## Old behaviour

| Legacy widget | Headings found in the shadow root |
|---|---|
| `mpp-my-giving` | `H1: My Giving` |
| `mpp-my-pledges` | `H1: My Pledges`, then per pledge `H3: ZZTEST-Giving-Compare`, `H4: Chris Kehayias`, `H3: $0.00 of $1,200.00 (0%)` |
| `mpp-my-contribution-statement` | `H1: My Contribution Statements`, `H2: Your Church Name` |

A screen-reader user can list the headings and jump straight to a pledge, or to the
accounting company whose statement they want.

## New behaviour

| New widget | Headings found |
|---|---|
| `next-my-giving` | **none** — the title is `<div class="title">My Giving</div>`; "By Month", "By Program", "Donations" are all `<div>`s |
| `next-my-pledges` | **none** — campaign name is `<div class="pledge-name">`, owner `<div class="pledge-owner">`, progress `<div class="progress-text">` |
| `next-my-contribution-statement` | **none** — `<div class="title">`, `<div class="company-name">` |
| `next-statement-preferences` | **none** — `<div class="title">Contribution Statements</div>` |

For contrast, `next-pledge-campaign` in the same package *does* do this properly
(`H1: ZZTEST-Giving-Compare`, `H2: Progress`, `H4: $0.00 pledged of $10,000.00 goal`,
`H2: Create a Pledge`, `H3: Pledge Details`, `H3: Personal Details`, `H3: Contact`) — so
this is an inconsistency inside our own SDK, not a house style.

Two related observations from the same pass, for whoever picks this up:

- Keyboard reachability and focus rings are otherwise fine. Tab order in all four is
  logical and every control shows the default `outline: auto` ring. Two notes: the
  `next-statement-preferences` checkbox is styled `opacity: 0; width: 0`, so it takes
  focus but its focus ring has nothing to draw around (legacy's is `display: none` and
  not focusable at all, so ours is still an improvement in reachability); and
  `next-my-giving`'s month `<select>` has no `<label>` or `aria-label` — but neither does
  legacy's `#monthSelector`, so that part is parity, not a regression.
- `next-my-pledges`' progress bar is `<div class="progress-track">` + `progress-fill`
  with no `role="progressbar"` / `aria-valuenow`. The dollar figure is in adjacent text,
  so the information is not lost, but the bar itself is invisible to assistive tech.

## Why it matters

These are the pages a donor visits to do their taxes and manage their money, and they
are exactly the pages where a church has the strongest reason to care about
accessibility. Losing the heading outline is a regression against a legacy widget that
had one — the sort of thing that surfaces in a customer's accessibility audit after
migration, not before.

## Evidence

- Screenshots (both systems, same data):
  `.claude/playwright/widget/screenshots/my-giving-new-initial.png` /
  `my-giving-old-authed.png`, `my-pledges-new-initial.png` / `my-pledges-old-authed.png`,
  `my-contribution-statement-new-authed.png` / `my-contribution-statement-old-authed.png`
- Probes run in-page against each shadow root:
  `[...sr.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(x => x.tagName + ":" + x.textContent.trim())`
  → `[]` for all four new widgets; the legacy values are in the table above.
- Keyboard pass output (`.claude/playwright/widget/scripts/giving/kbd.log`) records the tab sequence and computed
  `outline` for every focusable control in all four.
- Scripts: `.claude/playwright/widget/scripts/giving/giving-deep.mjs`, `.claude/playwright/widget/scripts/giving/giving-old-deep.mjs`,
  `.claude/playwright/widget/scripts/giving/pledges-deep.mjs`, `.claude/playwright/widget/scripts/giving/stmt-deep2.mjs`, `.claude/playwright/widget/scripts/giving/kbd.mjs`

## Where to fix

- `packages/embed-sdk/src/components/my-giving.ts` — `renderMain` (`.title`),
  `renderByMonthChart` / `renderByProgramChart` (`.chart-title`),
  `renderDonationsList` (`.section-label`)
- `packages/embed-sdk/src/components/my-pledges.ts` — `renderMain` (`.title`),
  `renderPledgeCard` (`.pledge-name`, `.pledge-owner`)
- `packages/embed-sdk/src/components/my-contribution-statement.ts` — `renderList`
  (`.title`), `renderGroup` (`.company-name`)
- `packages/embed-sdk/src/components/statement-preferences.ts` — the `.title` div
- Pattern to copy: `packages/embed-sdk/src/components/pledge-campaign.ts`

## Suggested fix

Swap the tag, keep the class — `<h1 class="title">`, `<h2 class="chart-title">`,
`<h3 class="pledge-name">` and so on — and add `h1,h2,h3,h4 { font: inherit; margin: 0 }`
to each widget's style block so nothing moves visually. While in `my-pledges`, add
`role="progressbar" aria-valuenow/aria-valuemin/aria-valuemax` to `.progress-track` and
give `next-statement-preferences`' hidden checkbox a `:focus-visible` outline on the
`.slider` it is paired with. All of it is mechanical; none of it changes layout.
