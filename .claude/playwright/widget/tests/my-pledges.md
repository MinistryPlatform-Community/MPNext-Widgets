# my-pledges — comparison test log

- **New**: `next-my-pledges` — http://localhost:5173/demo-my-pledges.html
- **Old**: My Pledges — https://mpi.ministryplatform.com/widgets/my_pledges.aspx
- **Tested**: 2026-09-08 by subagent giving (read side, block C30–C39)
- **Auth state(s) tested**: signed out (clean context) / signed in as PLAYWRIGHT_MP_USERNAME (User_ID 98, Contact_ID 98, Donor_ID 6)
- **Script**: `.claude/playwright/widget/scripts/giving/new-baseline.mjs`, `pledges-deep.mjs`, `old-cancel.mjs`, `signedout.mjs`, `kbd.mjs`
- **Config parity**: legacy page sets `hidecancelbuttonpledge="false"`. The new widget accepts the identical attribute name and `cancelpledgeemailtemplate` verbatim (CONFIG-MAP §2.12, §4.11 — "full parity"), but its **default is inverted**, so the demo page as shipped is *not* like-for-like. I mirrored the legacy config explicitly before testing the cancel flow, and filed the default difference separately (`C31`).

## What I tested

1. Ground truth: `api_MPPW_GetMyPledges @UserId=98` returned **zero** pledges, so there was nothing to compare. Created two fixtures on a purpose-built campaign.
2. Fixtures: `Pledge_Campaigns` 6 = `ZZTEST-Giving-Compare` (goal $10,000, 2026-01-01 → 2027-12-31, `Allow_Online_Pledge = true`, `Show_On_My_Pledges = true`); `Pledges` 40 (Donor 6, $1,200, 12 installments from 2026-01-01, status Active) and 41 (Donor 6, $600, 6 installments from 2026-02-01, status Active).
3. Baseline render, both systems, signed in. Compared card content field by field against MP: status label, campaign name, owner name, progress amounts, percentage, installment count, first installment date.
4. Counted cancel controls on the new widget **as the demo page ships it** (no attributes).
5. Set `hidecancelbuttonpledge="false"` + `cancelpledgeemailtemplate="65"` with `setAttribute` on the live element and waited — nothing changed (→ `C39`). Replaced the element with a fresh one carrying the same attributes and the controls appeared.
6. Walked the whole cancel flow on the new widget: **Cancel Pledge** → inline confirm (*"Cancel this pledge?"* / **Cancel pledge** / **Keep**) → pressed **Keep** and confirmed the confirm block disappears → re-opened → confirmed.
7. Verified the cancel in MP: `Pledges.Pledge_Status_ID` for 40.
8. Verified the cancellation **email** in MP rather than a mailbox: found the `dp_Communications` row and its `dp_Communication_Messages` recipient row, including the token replacement.
9. Cancelled the *other* pledge (41) through the **legacy** widget and captured its confirm UX and its request, then verified MP.
10. Signed-out render, both systems, with API statuses.
11. 390×844 screenshots, both. Tab order, focus rings, headings, progress-bar semantics.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders, no console errors | yes | yes | **pass** |
| 2 | Pledge count | 2 | 2 | **pass — matches MP** |
| 3 | Status label | `Active` | `Active` | **pass** |
| 4 | Campaign name | `ZZTEST-Giving-Compare` | same | **pass** |
| 5 | Owner name | `Chris Kehayias` | `Chris Kehayias` | **pass** |
| 6 | Progress text | `$0.00 of $1,200.00 (0%)` | `$0.00 of $1,200.00 (0%)` | **pass — character-identical** |
| 7 | Second pledge | `$0.00 of $600.00 (0%)` | same | **pass** |
| 8 | Installment line | `12 installments beginning 01/01/2026` | `12 installments beginning Jan 1, 2026` | **diff → C36** |
| 9 | `pledgeTotalToDate` when MP returns `SubTotalAmount = null` | `$0.00` | `$0.00` | **pass** |
| 10 | Cancel control, demo page as shipped | present (page sets the attribute) | **absent** — default inverted | **diff → C31** |
| 11 | Cancel control after mirroring legacy config | present | present, only on Active pledges | **pass** |
| 12 | Confirmation step | native `confirm("Are you sure you would like to cancel this pledge?")` | inline *"Cancel this pledge?"* + **Cancel pledge** / **Keep** | **new is better** |
| 13 | Cancel writes MP | `GET …/PledgeCampaignApi/CancelMyPledge?pledgeId=41` → `Pledge_Status_ID = 3` | `POST /api/embed/my-pledges` → `Pledge_Status_ID = 3` | **pass — same result** |
| 14 | Card re-renders after cancel | yes, `Discontinued` | yes, `Discontinued`, plus *"Pledge canceled"* | **pass** |
| 15 | Cancel control removed after cancel | yes | yes (status is no longer Active) | **pass** |
| 16 | Cancellation email | none — the sample page sets no template, so legacy sends nothing | `dp_Communications` 4141 → `dp_Communication_Messages` 1061, `To: "Kehayias, Chris" <chris.kehayias@acst.com>`, body token-replaced to *"Dear Chris,"* | **pass, new-only as configured** |
| 17 | Ownership check on cancel | server-side (MP session) | `verifyPledgeOwnedByContact` → 403 if the pledge is not the caller's | **pass** |
| 18 | Success/failure feedback | none | *"Pledge canceled"* / *"Error canceling the pledge, please try again."* | **new is better** |
| 19 | `setAttribute` after upgrade reconfigures the widget | yes (unconditional reload) | **no** | **diff → C39** |
| 20 | Signed out | warning alert + `[Login]` | red "Unable to Load / Authentication required" + dead "Try Again" | **diff → C30** |
| 21 | Empty state (no pledges) | nothing beyond the login alert | *"You are not associated with any pledges."* | **new is better** |
| 22 | Headings | `H1: My Pledges`, per card `H3` campaign / `H4` owner / `H3` progress | none | **diff → C35** |
| 23 | Progress bar semantics | — | `div` pair, no `role="progressbar"` | folded into C35 |
| 24 | 390x844 | renders | renders, cards stack | **pass** |
| 25 | Keyboard (cancel enabled) | cancel is an `<a>` with no `href` | real `<button>`s, focus rings visible | **new is better** |
| 26 | Campaign image / placeholder | image when present | image, else a heart SVG with `aria-label="Pledge"` | **pass** |

## Findings filed

- `C31-my-pledges-cancel-button-default-inverted.md` — legacy shows Cancel when the attribute is omitted; we hide it.
- `C39-attribute-changed-callback-ignores-first-set.md` — `setAttribute` after upgrade does not re-render.
- `C30-giving-widgets-signed-out-error-instead-of-sign-in.md` — signed-out error panel.
- `C35-giving-widgets-emit-no-headings.md` — legacy's `H1`/`H3`/`H4` outline and the missing `role="progressbar"`.
- `C36-giving-date-format-differs-from-legacy.md` — `Jan 1, 2026` vs `01/01/2026`.

## Where the new widget is better

- **The cancel confirmation is in-page.** Legacy uses `window.confirm`, which is suppressed in several embedded/webview contexts and cannot be styled or made accessible; ours is an inline confirm with an explicit **Keep** escape, and it does not block the page.
- **The cancel result is reported.** Legacy re-fetches and hopes; ours prints *"Pledge canceled"* or a specific error and reverts nothing silently.
- **Ownership is enforced in our own API** (`verifyPledgeOwnedByContact` → 403) rather than relying solely on MP's session scoping.
- **The cancellation email is a first-class part of the flow** and was verified end to end (template read, tokens replaced, `dp_Communication_Messages` row created for the right contact). Legacy has the same capability but the sample page never configures it, so nothing is sent there.
- **A real empty state**: *"You are not associated with any pledges."*
- Cancel controls are buttons, so the flow is keyboard operable; legacy's is an `<a>` with no `href`.

## Not tested / blocked

- **A pledge with actual payments against it**, i.e. `SubTotalAmount > 0`, to compare the progress bar at a partial percentage and the `Completed` status label. Both fixtures had no donations allocated to them; creating allocated donations against a pledge would have meant writing `Donation_Distributions.Pledge_ID` rows and re-running MP's rollup, which I judged too invasive for the value.
- **The `Pending` and `Completed` status branches.** Only `Active` and `Discontinued` were observable. `STATUS_LABELS` in the new widget maps all four, but the badge colours for the other two are unverified against legacy.
- **A pledge on a campaign with `Show_On_My_Pledges = false`.** Campaign 5 (`Annual Appeal`) has that flag off; I did not create a pledge there to confirm both widgets suppress it identically.
- **`cancelpledgeemailtemplate` on the legacy widget.** The sample page sets no template, so legacy's email path is unexercised — I could not compare the email body legacy would produce against ours. Ours reproduces `EmailManager.CreateEmail`'s token scheme (verified by the *"Dear Chris,"* substitution in the queued message).
- **Cancelling someone else's pledge.** The 403 path is in the route and covered by unit-level reasoning, but I did not attempt it with a second user's token.

## MP data created and cleaned up

`Pledge_Campaigns` 6 (`ZZTEST-Giving-Compare`) and `Pledges` 40, 41 — created for this test, both subsequently cancelled as part of the flow, and all deleted at the end of the run along with the campaign. The cancellation `dp_Communications` row (4141) and its message row were left in place: they are the *evidence* the email fired, and deleting communication history is more invasive than leaving one queued sample-template message addressed to the test user. Recorded here so it is not a mystery later.

## Screenshots

- `screenshots/my-pledges-old-initial.png` — legacy baseline, both pledges Active, Cancel present
- `screenshots/my-pledges-new-initial.png` — new baseline, same data
- `screenshots/my-pledges-new-default-nocancel.png` — demo page as shipped: two Active pledges, no cancel control (C31), unchanged by `setAttribute` (C39)
- `screenshots/my-pledges-new-cancel-enabled.png` — same data with the legacy config mirrored
- `screenshots/my-pledges-new-cancel-confirm.png` — the inline confirm step
- `screenshots/my-pledges-new-after-cancel.png` — `Discontinued` + *"Pledge canceled"*
- `screenshots/my-pledges-old-authed.png` — legacy signed in, heading outline visible
- `screenshots/my-pledges-old-after-cancel.png` — legacy after cancelling pledge 41
- `screenshots/my-pledges-new-signedout.png` and `my-pledges-old-signedout.png` — the C30 pair
- `screenshots/my-pledges-new-mobile.png` and `my-pledges-old-mobile.png` — 390x844
