# statement-preferences — comparison test log

- **New**: `next-statement-preferences` — http://localhost:5173/demo-statement-preferences.html
- **Old**: the **Go Paperless** control **inside** `mpp-my-contribution-statement` — https://mpi.ministryplatform.com/widgets/my_contribution_statement.aspx
- **Tested**: 2026-09-08 by subagent giving (read side, block C30–C39)
- **Auth state(s) tested**: signed out (clean context) / signed in as PLAYWRIGHT_MP_USERNAME (Contact_ID 98, Donor_ID 6)
- **Script**: `.claude/playwright/widget/scripts/giving/new-baseline.mjs`, `stmt-deep2.mjs`, `old-stmt.mjs`, `paperless-matrix.mjs`, `signedout.mjs`, `kbd.mjs`
- **Not new-only.** The BRIEF listed this widget as having no legacy counterpart; CONFIG-MAP §2.8 corrected that and this log follows the correction — the legacy statement widget carries the same control inline, writing through `/Api/ContributionsApi/SetStatementMethod?goPaperless=<bool>`. Tested as an old-vs-new pair.

## What I tested

1. Read the MP field both sides target: `Donors` for `Contact_ID = 98` → `Donor_ID 6`, `Statement_Method_ID 2`. Looked up the lookup table: `Statement_Methods` = `1 Postal Mail`, `2 Email/Online`, `4 No Statement Needed` — **three** values behind a boolean toggle on both systems.
2. Baseline render, new widget, signed in. Read the checkbox's `checked` state and compared it with MP.
3. **Read-state matrix**: set `Statement_Method_ID` to 1, then 2, then 4 through the API, and after each write reloaded *both* the new widget and the legacy statement page, recording what each showed.
4. Round-tripped the new widget: flipped the toggle, waited for the `PUT`, read the success message, re-read `Donors` from MP, then reloaded the page and re-read the toggle.
5. Toggled the legacy control and captured the request it issues and the resulting MP value.
6. Signed-out render of the new widget, with API statuses.
7. Error path: what the widget shows when the API returns 404 (no donor record) — traced in source and confirmed the branch exists (`hasDonor = false` → *"No donor record found for your account."*); not reachable for this user, who has a donor row.
8. 390×844 screenshot. Tab order, focus ring, label association.

## Results

| # | Check | Old (inline control) | New (`next-statement-preferences`) | Verdict |
|---|---|---|---|---|
| 1 | Renders, no console errors | yes | yes | **pass** |
| 2 | Label copy | `Go Paperless! Get Statements online/via email.` | `Go Paperless! Get statements online/via email.` | trivial case diff, not filed |
| 3 | Reads MP `Statement_Method_ID = 1` | shows **checked** (wrong) | shows unchecked | **new is correct** |
| 4 | Reads MP `Statement_Method_ID = 2` | shows checked | shows checked | **pass** |
| 5 | Reads MP `Statement_Method_ID = 4` | shows **checked** (wrong) | shows unchecked | **new is correct** |
| 6 | Write on → MP value | `goPaperless=true` → `2` | `PUT {"paperless":true}` → `2` | **pass — same field, same value** |
| 7 | Write off → MP value | `goPaperless=false` → `1` (verified) | `PUT {"paperless":false}` → `1` (verified) | **pass** |
| 8 | Persists across reload | n/a (legacy re-renders checked regardless) | yes — reload showed the flipped state | **pass** |
| 9 | Success feedback | none | *"Statement method updated"* | **new is better** |
| 10 | Failure feedback | none | reverts the toggle + *"Error updating the statement method, please try again."* (source path; not forced in this run) | **new is better** |
| 11 | Optimistic update then revert on failure | n/a | implemented | **new is better** |
| 12 | Control present on the statement page at all | yes, inline | **no** — needs a second element | **diff → C38** |
| 13 | Third `Statement_Method` value (`4 No Statement Needed`) expressible | no | no — silently becomes `1` if the toggle is touched | **parity**, recorded in C38 rather than filed separately |
| 14 | Signed out | (page shows the warning + `[Login]`) | red "Unable to Load / Authentication required" + dead "Try Again" | **diff → C30** |
| 15 | Headings | `H1`/`H2` on the host widget | none | **diff → C35** |
| 16 | 390x844 | renders | renders | **pass** |
| 17 | Keyboard reachable | **no** — legacy's `#StatementMethod` is `display:none` | yes — focusable | **new is better** |
| 18 | Focus indicator visible | n/a | outline drawn on a `0px`-wide, `opacity:0` input, so effectively invisible | minor, folded into C35 |
| 19 | Label association | `label.mpp-card-multiselect--checkbox` wrapping | `label[for="paperless-toggle"]` | **pass** |
| 20 | Toggle disabled while saving | n/a | yes (`disabled` during the PUT) | **new is better** |

## Findings filed

- `C38-paperless-toggle-split-into-separate-element.md` — the control left the statement widget, so a one-for-one tag swap loses it. Carries the read-state matrix and the shared three-value-to-boolean gap.
- `C30-giving-widgets-signed-out-error-instead-of-sign-in.md` — signed-out error panel.
- `C35-giving-widgets-emit-no-headings.md` — includes the invisible focus ring on this widget's hidden checkbox.

## Where the new widget is better

- **It actually reads the donor's preference.** This is the headline result: legacy renders the checkbox checked no matter what `Statement_Method_ID` says, so a donor on Postal Mail is told they are already paperless. Ours reads the real value in all three states.
- **It tells you the write happened** (*"Statement method updated"*) and, on failure, reverts the toggle and says so. Legacy is silent either way.
- **It is keyboard reachable.** Legacy's input is `display:none`, so the control cannot be operated without a pointer.
- The toggle is disabled while the `PUT` is in flight, so a double-click cannot race two writes.

## Not tested / blocked

- **The 404 "no donor record" branch.** The test user has `Donor_ID 6`, and I was not willing to delete a donor row to force it. The code path is straightforward (`res.status === 404` → `hasDonor = false` → *"No donor record found for your account."*) but it is unexercised here.
- **A forced PUT failure**, to confirm the optimistic-update revert visually. Would need request interception on the demo page; the source path is clear and the state machine is simple, but I have not seen it on screen.
- **Whether the legacy write path differs for `Statement_Type_ID` / `Statement_Frequency_ID`.** Both widgets only touch `Statement_Method_ID`; the other two donor columns were unchanged by every write I observed (`Statement_Type_ID` stayed 2, `Statement_Frequency_ID` stayed 2), so nothing is being clobbered — but I did not test a donor whose type/frequency differ from the defaults.

## MP data created and changed

No rows created. `Donors.Statement_Method_ID` for `Donor_ID 6` was written repeatedly during the matrix (1 → 2 → 4 → 1, plus the widget round-trips) and **restored to its original value of `2`** at the end of the run.

## Screenshots

- `screenshots/statement-preferences-new-initial.png` — baseline, signed in, toggle reflecting MP
- `screenshots/statement-preferences-new-authed.png` — same, after the read-state matrix
- `screenshots/statement-preferences-new-flipped.png` — after the write: toggle off + *"Statement method updated"*
- `screenshots/statement-preferences-new-signedout.png` — the C30 state
- `screenshots/statement-preferences-new-mobile.png` — 390x844
- `screenshots/my-contribution-statement-old-authed.png` — the legacy inline control, for the pair comparison
- `screenshots/my-contribution-statement-old-paperless-toggled.png` and `my-contribution-statement-old-paperless-write.png` — legacy toggle before/after the `SetStatementMethod` write
