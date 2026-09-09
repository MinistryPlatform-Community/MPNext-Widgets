# `next-pledge-campaign` — plan

**Items:** C32 (functional — a $0.00 and a $15,999,999,999,984.00 pledge both save as success)
· C39 (functional, shared — its own variant of the attribute bug)
**Cutover verdict: fix before cutover. It writes junk into the church's books and reports success.**
**Owns:** `packages/embed-sdk/src/components/pledge-campaign.ts`,
`src/services/pledgeCampaignService.ts`, `packages/types` (`SavePledgeRequestSchema`),
`src/app/api/embed/pledge-campaign/save/route.ts`

## What the feedback says

The amount input is `<input type="number" min="0" step="0.01" required>` and **nothing else
checks the amount anywhere** — not `submit()`, not `recalcTotal()`, not the route, not the Zod
schema, not `savePledge()`.

| Entered | Client validation | Shown to donor | MP row |
|---|---|---|---|
| *(empty)* | blocked | — | none |
| `-50` | blocked ("Value is out of range") | — | none |
| **`0`** | **passes** | *"thank you for your pledge"* | `Total_Pledge = 0`, `Installments_Planned = 16` |
| **`999999999999`** | **passes** | *"thank you for your pledge"* | `Total_Pledge = 15999999999984` |
| `10` monthly, Sep→Dec | passes | thank-you | `Total_Pledge = 40`, 4 installments ✓ |

`min="0"` is simply the wrong boundary for money: it excludes negatives and admits zero.

## Where the new widget is already better — protect these

Worth stating clearly, because the item's framing could be read as "we are worse":

- **Legacy is worse in every respect except the ceiling.** `#InstallmentAmount` has **no
  `min`** at all, so `-50`, `0` and `999999999999` all pass, MP answers **500**, and the widget
  shows **no message at all** — success or failure. The rows are created anyway
  (`Pledge_ID` 44 at `-800`, 45 at `0`, 46 at `15999999999984`). So legacy has no floor and
  fails silently; ours has a floor at zero and reports success. **Neither is acceptable, and
  ours is the better starting point.**
- **`next-pledge-campaign` is the SDK's reference implementation for headings** —
  `H1: <campaign>`, `H2: Progress`, `H4: $0.00 pledged of $10,000.00 goal`, `H2: Create a
  Pledge`, `H3: Pledge Details`, `H3: Personal Details`, `H3: Contact`. `CROSS-3` §3 points
  four other widgets at this file. Do not lose it.
- It already calls `requestLogin()`, so it is on the right side of `CROSS-1`.
- Installment maths is correct (`10` monthly Sep→Dec → `40` over 4 installments).

## Phase 1 — C32, three layers, cheapest first

**1. The input.** `min="0.01"`.

**2. `submit()`.** After `recalcTotal()`, refuse `totalPledge <= 0` with a **specific** message
— *"Enter a pledge amount greater than $0.00"* — not the generic *"Please complete the pledge
campaign form."* The generic message is why the zero case reads as a form problem rather than
an amount problem.

**3. The schema — this is the layer that actually matters.** Put a `.positive()` plus a sane
ceiling on `SavePledgeRequestSchema` (`installmentAmount`, `totalPledge`) so the route rejects
it **regardless of the client**. Today a scripted POST to `/api/embed/pledge-campaign/save`
can write anything at all; the browser is the only gate.

**On the ceiling:** do not try to derive it from the campaign goal — a donor may legitimately
pledge more than the goal, and a goal-derived cap would reject good pledges. MP's
`Total_Pledge` is a money column, so a flat cap around `1e10` plus a clear message is enough.
Anything past that is certainly a typo.

## Why the amounts matter more than they look

Every $0.00 submit puts a real `Pledges` row in the church's books. It appears in
`next-my-pledges`, in MP's pledge reports, and it **counts toward `numberOfPledges` on the
campaign progress bar** — so it inflates the campaign's own headline. Someone in the church
office has to find and delete it.

The absurd case is worse: one mistyped amount writes a sixteen-trillion-dollar pledge that
skews the campaign's pledged total and its progress bar **for everyone who loads the page** —
and the donor is told "thank you".

## Phase 2 — C39, this widget's own variant

`pledge-campaign.ts` does not carry the `oldValue !== null` guard the three giving widgets do.
It has a different bug of the same family:

```ts
if (oldValue === newValue) return;
if (name === "campaign-id" && this.campaign) this.init();
```

It re-inits **only when a campaign is already loaded**, so setting `campaign-id` on a widget
whose first load failed does nothing — the widget is stuck in its error state permanently, and
the obvious recovery (point it at a different campaign) is unavailable. Normalise to the shared
`reconfigure()` convention in `CROSS-4`.

## Do better than parity

- **Validate the pledge, not just the amount.** The real question a donor gets wrong is not
  the number, it is the *schedule*: an end date before the start, a frequency that yields one
  installment, a total that does not match what they meant. `submit()` already has a
  campaign-end-date guard — extend that block into a single coherent "does this pledge make
  sense" check, and **show the computed schedule back before submitting**: *"16 monthly
  installments of $25.00, Jan 2026 – Apr 2027, totalling $400.00."* That prevents the whole
  class rather than catching one boundary.
- **A confirmation step is cheap here and valuable.** This is a financial commitment with no
  review screen on either system.
- **Server-side money validation is a pattern, not an instance.** The same argument applies to
  `paymentService`'s missing amount ceiling (C43 in `checkout-pay.md`). Both are "the client is
  the only gate on a money value". Worth a shared Zod money refinement — positive, two decimal
  places, sane ceiling — used by both.

## Acceptance

- A `0` pledge is refused with a message naming the amount, client-side **and** by the route.
- A scripted POST with `totalPledge: 15999999999984` is rejected by the schema.
- A negative amount is still refused (unchanged).
- `10` monthly Sep→Dec still saves `Total_Pledge = 40` over 4 installments (regression guard).
- Setting `campaign-id` on a widget whose first load failed re-inits it.
- The heading outline is unchanged — this widget is the reference for `CROSS-3` §3.

## Cleanup owed from the comparison run

The eight test `Pledges` rows on campaign 6 were deleted at the end of the run. The
`dp_Communications` / `dp_Communication_Messages` rows from the pledge confirmation and
cancellation were **left in place deliberately** — they are the evidence those emails fired.

## Depends on / unblocks

Independent. C39 → `CROSS-4`. Consider building the shared money refinement here and reusing it
in `checkout-pay.md` C43.
