# pledge-campaign — comparison test log

- **New**: `next-pledge-campaign` — http://localhost:5173/demo-pledge-campaign.html
- **Old**: Make a Pledge — https://mpi.ministryplatform.com/widgets/pledge_campaign.aspx
- **Tested**: 2026-09-08 by subagent giving (read side, block C30–C39)
- **Auth state(s) tested**: signed out (clean context) / signed in as PLAYWRIGHT_MP_USERNAME (Contact_ID 98, Household_ID 85)
- **Script**: `.claude/playwright/widget/scripts/giving/new-baseline.mjs`, `pc-new.mjs`, `pc-new2.mjs`, `pc-old.mjs`, `pc-old2.mjs`, `signedout.mjs`

## Making the comparison like-for-like

The two pages point at different campaigns, and the legacy page's campaign is closed:

- legacy markup: `<mpp-pledge-campaign pledgecampaignid="5" pledgeemailtemplate="528" suggestedamounts="30,50,100">` — campaign 5 is `Annual Appeal`, and MP says `Allow_Online_Pledge = false`, so *both* widgets correctly refuse new pledges there. Its `pledgeemailtemplate="528"` also does not exist (`dp_Communications` has no row 528), which is why legacy 500s on every save from that page.
- demo markup: `campaign-id="3"` (`MyChurch Test Mission Trip`, goal $5.00, already 1,100% pledged), no email template.

So I created a **third** campaign both could use and drove both at it: `Pledge_Campaigns` 6 = `ZZTEST-Giving-Compare`, goal $10,000, 2026-01-01 → 2027-12-31, `Allow_Online_Pledge = true`, `Pledge_Beyond_End_Date = false`, thank-you message set, description set. On the new side I replaced the element with one carrying `campaign-id="6" pledge-email-template="65" suggested-amounts="30,50,100"`; on the legacy side I used `page.route` to rewrite the single `pledgecampaignid="5"` in the fetched `.aspx` to `"6"` (CONFIG-MAP §5). No repo file was edited.

## What I tested

1. Baseline render of both pages as shipped (campaign 5 / campaign 3), signed in and signed out.
2. Both widgets at campaign 6, and then a **field-by-field** dump: every `input`/`select`/`button` with its `id`, `type`, `name`, `required`, default `value`, `min`/`max`/`step`, associated label text, visibility, and full option list.
3. Campaign progress rendering: pledged/goal amounts, the two percentages, the goal label.
4. The **"Make a Pledge as"** household picker: option order, values, default selection, and what happens to the contact block when a member vs Blank Form is chosen.
5. Frequency list: labels and values, on both.
6. **Validation matrix on both systems**: empty submit, `-50`, `0`, non-numeric, `999999999999`.
7. Whether the new form surfaces the native `reportValidity` popup (it must not) and whether the shared `form-validation.ts` markers appear.
8. The campaign-end-date guard: an end date past the campaign's own end.
9. A **legitimate submit** on the new widget ($10 monthly, 2026-09-08 → 2026-12-08) and verification of the resulting `Pledges` row in MP field by field.
10. The post-submit state and **Create Another Pledge** reset.
11. The **Blank Form** branch: which contact fields become required and whether empty submit is blocked.
12. The already-pledged warning.
13. 390×844 screenshots on both.

## Results

### Structure and configuration

| # | Check | Old (`mpp-pledge-campaign`) | New (`next-pledge-campaign`) | Verdict |
|---|---|---|---|---|
| 1 | Renders, element upgraded | yes | yes | **pass** |
| 2 | Console errors | a bare `404` on every load | none | **new is better** |
| 3 | Campaign title / description | `H1` + description | `H1` + description | **pass** |
| 4 | Missing description | *"No campaign description found"* | nothing rendered | cosmetic, not filed |
| 5 | Progress amounts (campaign 6, empty) | `$0.00 pledged of $10,000.00 Goal` | `$0.00 pledged of $10,000.00 goal` | case-only diff, not filed |
| 6 | Progress percentages | `1.42% received 33.687% pledged` (campaign 5) | same formatting shape | **pass** |
| 7 | Suggested amount buttons | `input[type=button]` `$30` `$50` `$100` | `button` `$30` `$50` `$100` | **pass** |
| 8 | Total display | `Total Pledge:` + hidden `#TotalPledge` | `Total Pledge` + `#pc-total-value` | cosmetic, not filed |
| 9 | Amount field | `type=number`, `required`, **no `min`**, no `step` | `type=number`, `required`, `min="0"`, `step="0.01"` | see validation |
| 10 | Frequency options | `Select Frequency=`, Weekly=52, Every Other Week=26, Twice Per Month=24, Monthly=12, Annually=2, One Time=1 | `-- Select --=`, then the **same six labels and values** | **pass** |
| 11 | Start date | `required`, `min` = tomorrow (`2026-09-09`), **no `max`** | `required`, `min` = today (`2026-09-08`), `max` = campaign end | **new is better** (cannot start after the campaign ends) |
| 12 | End date | **`required`**, default = campaign end − 1 day | **optional**, default = campaign end | **diff, new is more permissive** — allows a genuine one-time pledge |
| 13 | Household picker options | `Blank Form=`, Chris=98, Sarah=99, Aiden=161, Jillian=170 | Chris=98, Sarah=99, Aiden=161, Jillian=170, `Blank Form=` | order differs; **same 4 members, same ids** |
| 14 | Picker default | `98` (signed-in contact) | `98` | **pass** |
| 15 | Contact block with a member selected | visible, **empty**, labelled `First Name*` / `Last Name*` / `Email*` but `required = false` | visible, **prefilled** from the member, labels without `*`, `required = false` | **new is better** |
| 16 | Contact block on Blank Form | fields cleared | fields cleared, `required = true` on first/last/email | **pass** |
| 17 | Already-pledged warning | *"You have already made a Pledge for this Campaign. Please ensure you want to pledge again."* (rendered at the bottom) | identical text (rendered above the form) | **pass** |
| 18 | Closed campaign (campaign 5) | renders the **whole form** plus *"This Campaign is no longer accepting new Pledges."* | renders the warning **only**, no form | **new is better** |
| 19 | Anonymous render | full form, contact fields required | full form, contact fields required | **pass** |
| 20 | Headings | `H1`/`H2`/`H3`/`H4` outline | **same outline** — the one widget of my five that does this properly | **pass** |
| 21 | 390x844 | renders | renders | **pass** |

### Validation matrix

Both at campaign 6, signed in, member selected.

| Input | Old | New | Verdict |
|---|---|---|---|
| empty submit | inline `Required` on amount + frequency, plus `mppw-alert__warning` *"Please complete pledge campaign form!"*; **no native popup** | inline *"This field is required."* on amount + frequency (`mpx-field-error`), plus banner *"Please complete the pledge campaign form."*; **no native popup** (`novalidate` set) | **pass, parity** |
| `-50` | **accepted**; `POST SavePledge`; MP 500; **no message shown at all**; `Pledges` 44 created with `Total_Pledge = -800` | **blocked** — *"Value is out of range."* on the field + banner | **new is better** |
| `0` | **accepted**; MP 500; no message; `Pledges` 45 created with `Total_Pledge = 0` | **accepted** — thank-you shown; `Pledges` 42/43 created with `Total_Pledge = 0` | **both wrong → C32** |
| non-numeric (`abc`) | cannot be typed into `type=number` | cannot be typed into `type=number` | **parity** |
| `999999999999` | **accepted**; MP 500; no message; `Pledges` 46 created with `Total_Pledge = 15999999999984` | **accepted** — thank-you shown; `Pledges` 47 created with the same value | **both wrong → C32** |
| end date past campaign end | no guard observed (no `max` on start, end defaults inside the window) | blocked with *"You cannot give past the campaign end date (12/31/2027)."* | **new is better** |
| Blank Form, empty contact fields | inline `Required` | three × *"This field is required."* + banner | **pass, parity** |

### The legitimate submit

$10, Monthly, 2026-09-08 → 2026-12-08. Widget showed `Total Pledge $40.00` before submit, then the campaign's own thank-you message (*"ZZTEST thank you for your pledge."*) and the button became **Create Another Pledge**; pressing it cleared the form.

MP row, read back: `Pledge_ID 48`, `Donor_ID 6`, `Pledge_Campaign_ID 6`, `Pledge_Status_ID 4` (Pending), `Total_Pledge 40`, `Installments_Planned 4`, `Installments_Per_Year 4`, `First_Installment_Date 2026-09-08T00:00:00`, `Notes` carrying the first name / last name / email / phone block. Every field is what the form said, **including the date — no timezone shift**: the widget sent `2026-09-08` and MP stored `2026-09-08T00:00:00`. Confirmation email fired (`dp_Communication_Messages` rows 1062–1065 across the run's saves, addressed to the test user).

`Installments_Per_Year 4` looks odd for a monthly pledge, but it is `Math.min(months, 12)` — a faithful port of the legacy calculation, which produced `Installments_Per_Year 12` for its own 16-month spans by the same formula. Parity, not a finding.

## Findings filed

- `C32-pledge-campaign-accepts-zero-and-absurd-amounts.md` — a $0.00 pledge (and a $15.99tn one) saves and reports success; verified in MP. Legacy shares the gap and additionally accepts negatives while reporting nothing at all.

Not filed, recorded here instead (my C30–C39 block was exhausted by higher-severity items and these are pure label/order differences): `Goal` vs `goal`; `Total Pledge:` vs `Total Pledge`; `Select Frequency` vs `-- Select --` as the placeholder; `Blank Form` first vs last in the household picker; *"No campaign description found"* vs rendering nothing; warning banner above the form rather than below it. The mechanism behind all of them — no MP-configurable label channel — is `C67`.

## Where the new widget is better

- **Negative amounts are blocked** client-side (`min="0"`), where legacy accepts them and writes a negative pledge.
- **The campaign-end-date guard works** and names the date: *"You cannot give past the campaign end date (12/31/2027)."* Legacy has no equivalent message and no `max` on the start date, so it will happily start a pledge after the campaign has closed.
- **A closed campaign shows no form.** Legacy renders the entire form and a **Create Pledge** button under a "no longer accepting new Pledges" notice — a dead-end that invites a submit which then 500s.
- **Failures are reported.** Legacy's save failures are completely silent: the pledge row appears, MP returns 500, and the widget says nothing either way.
- **The contact block is prefilled** from the selected household member instead of showing four empty starred fields next to a member's name.
- **No console 404** on load; legacy emits one every time.
- **Create Another Pledge** is an explicit, labelled reset.

## Not tested / blocked

- **`pledge-email-template` parity of content.** Ours sends template 65 and the message row appears with tokens replaced; legacy's page points at template 528, which does not exist in this MP instance, so legacy's email body could not be produced for comparison.
- **The anonymous ("blank form") save path end to end.** `resolveContactId` will match on name + email/phone or create a minimal `Contacts` row. I did not submit anonymously, because a miss would have created a real Contact record in the church's database and the match/create branch is the risky half — worth a dedicated pass with a disposable name, and it belongs to whoever owns contact creation.
- **`force-login` campaigns.** Campaign 6 has `forceLogin` false (MP has no column driving it true here), so the sign-in panel branch (`Please sign in to make a pledge for this campaign.` + a **Sign In** button that *does* call `requestLogin`) was never rendered. It is the correct pattern the widgets in `C30` are missing, and it is worth confirming on a campaign that sets it.
- **`id-parameter-name` / campaign id from the query string.** New-only attribute; not exercised.
- **`Pledge_Campaign_Type_ID`-specific rendering**, event-linked campaigns (`Event_ID`), and `customFormId`/`customFormGuid` campaigns — no fixtures for those.
- **Legacy at campaign 3** (the demo's default), which would have let me compare the over-100% progress bar rendering. Ours renders `1,100% pledged` and clamps the bar to 100%; legacy's clamp is untested.

## MP data created and cleaned up

`Pledge_Campaigns` 6 (`ZZTEST-Giving-Compare`) and every pledge on it: 40, 41 (fixtures for the my-pledges test), 42, 43, 47, 48 (created by the **new** widget during validation and the legitimate submit), 44, 45, 46 (created by the **legacy** widget during its validation matrix). All nine pledge rows and the campaign were deleted at the end of the run; the campaign existed only for this test, so nothing else referenced it. The confirmation-email `dp_Communications` rows were left in place as evidence (see the my-pledges log for the same note).

## Screenshots

- `screenshots/pledge-campaign-old-initial.png` — legacy as shipped (campaign 5, closed, form still rendered)
- `screenshots/pledge-campaign-new-initial.png` — new as shipped (campaign 3)
- `screenshots/pledge-campaign-old-zztest.png` and `pledge-campaign-new-zztest.png` — **the like-for-like pair**, both at campaign 6
- `screenshots/pledge-campaign-new-validation-empty.png`, `-validation-negative.png`, `-validation-absurd.png`
- `screenshots/pledge-campaign-old-validation-empty.png`, `-validation-negative.png`, `-validation-zero.png`, `-validation-absurd.png`
- `screenshots/pledge-campaign-new-past-end-date.png` — the campaign-end-date guard
- `screenshots/pledge-campaign-new-blank-form-validation.png` — Blank Form required-field errors
- `screenshots/pledge-campaign-new-submitted.png` — thank-you + Create Another Pledge
- `screenshots/pledge-campaign-new-signedout.png` and `pledge-campaign-old-signedout.png` — anonymous render, both
- `screenshots/pledge-campaign-new-mobile.png` and `pledge-campaign-old-mobile.png` — 390x844
