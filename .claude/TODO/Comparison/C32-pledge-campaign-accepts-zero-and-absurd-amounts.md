# C32. `next-pledge-campaign` accepts a $0.00 pledge — and a $15,999,999,999,984.00 one — and writes both to MP as a success

**Widget:** `next-pledge-campaign` (old: Make a Pledge)
**Severity:** functional
**Confidence:** confirmed — submitted each case in the browser and read the resulting `Pledges` rows back out of MP with the client-credentials API.
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy is no better and in one way worse. `mpp-pledge-campaign`'s
`#InstallmentAmount` is `type="number"` with **no `min`**, so `-50`, `0` and
`999999999999` all pass client validation, `POST …/PledgeCampaignApi/SavePledge` fires,
MP answers **500** (`{StatusCode: 500, Message: , SecondaryStatusCode: null}` in the
console) — and the widget shows **no message at all**, success or failure. The pledge
row is nevertheless created: `Pledge_ID` 44 (`Total_Pledge = -800`), 45 (`0`), 46
(`15999999999984`) all came from the legacy widget.

So legacy: no floor, silent failure. Ours: a floor at zero only, and it reports success.

## New behaviour

`packages/embed-sdk/src/components/pledge-campaign.ts` renders the amount as
`<input type="number" min="0" step="0.01" required>`, and nothing else checks the
amount — not `submit()`, not `recalcTotal()`, not
`src/app/api/embed/pledge-campaign/save/route.ts`, not `SavePledgeRequestSchema`, not
`PledgeCampaignService.savePledge()`.

Measured, on ZZTEST campaign 6:

| Amount entered | Frequency | Client validation | Result shown | MP row |
|---|---|---|---|---|
| *(empty)* | *(none)* | "This field is required." ×2 + banner | blocked | none |
| `-50` | Monthly | "Value is out of range." + banner | blocked | none |
| `0` | Monthly | **passes** | *"ZZTEST thank you for your pledge."* | `Pledge_ID` 42, 43 — `Total_Pledge = 0`, `Installments_Planned = 16` |
| `abc` | — | impossible to type into `type=number` | n/a | none |
| `999999999999` | Monthly | **passes** | *"ZZTEST thank you for your pledge."* | `Pledge_ID` 47 — `Total_Pledge = 15999999999984` |
| `10` | Monthly, Sep 8 → Dec 8 | passes | thank-you | `Pledge_ID` 48 — `Total_Pledge = 40`, `Installments_Planned = 4` ✓ correct |

`min="0"` is the wrong boundary for money: it excludes negatives but admits zero.

## Why it matters

Every $0.00 submit puts a real `Pledges` row in the church's books — it shows up in
`next-my-pledges` and in MP's own pledge reports as a Pending pledge for nothing, it
counts toward `numberOfPledges` on the campaign progress bar, and someone in the church
office has to find and delete it. The absurd-value case is worse: a single mistyped
amount writes a sixteen-trillion-dollar pledge that skews the campaign's pledged total
and its progress bar for everyone who loads the page, and the donor is told
"thank you". There is no server-side floor or ceiling to fall back on, so a scripted
POST to `/api/embed/pledge-campaign/save` can write anything at all.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/pledge-campaign-new-validation-empty.png`,
  `pledge-campaign-new-validation-negative.png`,
  `pledge-campaign-new-validation-absurd.png`, `pledge-campaign-new-submitted.png`;
  legacy: `pledge-campaign-old-validation-zero.png`,
  `pledge-campaign-old-validation-negative.png`, `pledge-campaign-old-validation-absurd.png`
- MP verification:
  `GET /tables/Pledges?$select=Pledge_ID,Total_Pledge,Installments_Planned,Pledge_Status_ID&$filter=Pledge_Campaign_ID = 6`
  returned `Total_Pledge` values `0, 0, -800, 0, 15999999999984, 15999999999984, 40`
  across the eight rows created during this run. All were deleted at the end of the run.
- Network: `200 POST /api/embed/pledge-campaign/save` for the zero and absurd cases
  (i.e. the API reported success)
- Scripts: `.claude/playwright/widget/scripts/giving/pc-new.mjs`, `.claude/playwright/widget/scripts/giving/pc-new2.mjs`, `.claude/playwright/widget/scripts/giving/pc-old2.mjs`

## Where to fix

- `packages/embed-sdk/src/components/pledge-campaign.ts` — the amount input
  (`renderAmountRow`) and the `submit()` guard block that already handles the
  campaign-end-date case
- `packages/types/src/…` — `SavePledgeRequestSchema` (`installmentAmount`,
  `totalPledge`)
- `src/services/pledgeCampaignService.ts:224-267` — `savePledge`

## Suggested fix

Three layers, cheapest first: change the input to `min="0.01"`; add an explicit check in
`submit()` after `recalcTotal()` that refuses `totalPledge <= 0` with a specific message
("Enter a pledge amount greater than $0.00") rather than the generic
"Please complete the pledge campaign form."; and put a positive-with-upper-bound
refinement on the Zod schema so the route rejects it regardless of the client — a
`.positive()` plus a sane ceiling (MP's `Total_Pledge` is a money column, so anything
past ~1e10 is certainly a typo). I would not try to guess the ceiling from the campaign
goal; a flat cap plus a warning is enough.
