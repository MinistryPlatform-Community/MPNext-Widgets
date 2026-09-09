# my-contribution-statement — comparison test log

- **New**: `next-my-contribution-statement` — http://localhost:5173/demo-my-contribution-statement.html
- **Old**: My Contribution Statement — https://mpi.ministryplatform.com/widgets/my_contribution_statement.aspx
- **Tested**: 2026-09-08 by subagent giving (read side, block C30–C39)
- **Auth state(s) tested**: signed out (clean context) / signed in as PLAYWRIGHT_MP_USERNAME (Contact_ID 98, Household_ID 85, Donor_ID 6)
- **Script**: `.claude/playwright/widget/scripts/giving/new-baseline.mjs`, `stmt-deep2.mjs`, `old-stmt.mjs`, `old-deep2.mjs`, `signedout.mjs`, `kbd.mjs`
- **Config parity**: legacy page sets `mygivingwidgettargeturl="./RsvpEvents"`. The new widget accepts **no attributes at all**, so there is nothing to mirror; the missing link-out is already filed as `C62` and is not re-filed here. The sample site's value is itself nonsense (it points at a page hosting a tag MPWidgets.js does not know), so only the existence of the option is meaningful.

## What I tested

1. **There were no statements to compare.** `api_MPPW_GetMyContributionStatements @ContactId=98` returned zero rows, and the whole MP instance held only three `Contribution_Statements` rows, all for households 1–2 and none with a file attached. Both widgets would have shown their empty state and the comparison would have been vacuous.
2. So I built fixtures: two `Contribution_Statements` rows for Household 85 (`Statement_ID` 5 = 2025, 6 = 2024, `Accounting_Company_ID` 1, `Statement_Type_ID` 2, `Contact_Record` 98) and attached a real one-page PDF to each via `MPHelper.uploadFiles` (`FileId` 839/840). Discovered in the process that the proc returns nothing for a statement with no attached file — `Last_Statement_File` alone is not enough.
3. Re-ran the proc to confirm both years now come back with `File_Name`, `Unique_Name`, `Extension`, `Accounting_Company_Name`.
4. Baseline render on both, signed in. Enumerated every visible control, its tag/type/class, and the heading outline.
5. Compared the year selector: which years, in what order, which is selected by default.
6. Clicked **Save as PDF** on both and recorded exactly what the browser did — `page.on("download")` vs `ctx.on("page")`.
7. Fetched the `Download_Url` the new widget hands out, checked status, content type, byte length and that the PDF contained the marker text I had written into it. Then fetched the same URL from a never-authenticated context.
8. Switched to 2024 and downloaded again, to confirm the year selection actually drives which file is fetched.
9. Signed-out render, both systems, with every API status recorded.
10. 390×844 screenshot, both systems. Tab order and focus rings.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders, no console errors | yes | yes | **pass** |
| 2 | Groups by accounting company | `H2: Your Church Name` | `Your Church Name` | **pass** |
| 3 | Years offered | 2025, 2024 | 2025, 2024 | **pass — matches MP** |
| 4 | Default selected year | 2025 (most recent) | 2025 (most recent) | **pass** |
| 5 | Year control type | radio group (`input[type=radio].statement-year-button`, `id` = the file GUID) | two buttons (`.year-btn`, active class) | **parity in effect** |
| 6 | Download control label | `Save as PDF` | `Save as PDF` | **pass — identical** |
| 7 | What the control does | fires a browser **download**, `suggestedFilename = ZZTEST-Statement-2025.pdf` | `window.open(url, "_blank", "noopener")` — a popup tab | **diff → C34** |
| 8 | URL requested | `…/ministryplatformapi/files/57625614-…` | byte-identical | **pass** |
| 9 | File actually served | — | `200 application/pdf`, 410 bytes, contains `ZZTEST 2025 Contribution Statement` | **pass — right file** |
| 10 | Selecting 2024 changes the file | — | requests `…/files/7b4ea4ee-…` (the 2024 GUID) | **pass** |
| 11 | Statement URL requires auth | no (anonymous GET → `200 application/pdf`) | no — same MP URL | **parity**; MP's design, recorded in C34, not filed against us |
| 12 | Go Paperless toggle present | **yes**, inline | **no** — split into `next-statement-preferences` | **diff → C38** |
| 13 | My Giving link-out | `See My Giving Page >` | absent | already `C62` |
| 14 | Signed out | warning alert + `[Login]` (and the paperless label still visible) | red "Unable to Load / Authentication required" + dead "Try Again" | **diff → C30** |
| 15 | Empty-state copy (no statements) | *"Please login…"* alert only | *"No statements currently available."* | not comparable — legacy has no empty state for a signed-in donor with no statements |
| 16 | Headings | `H1: My Contribution Statements`, `H2: Your Church Name` | none | **diff → C35** |
| 17 | 390x844 | renders | renders | **pass** |
| 18 | Keyboard | radios reachable, arrow-key group semantics | both year buttons + Save as PDF reachable, visible focus rings | **parity** |

## Findings filed

- `C30-giving-widgets-signed-out-error-instead-of-sign-in.md` — signed-out error panel instead of a sign-in prompt.
- `C34-statement-save-as-pdf-opens-tab-instead-of-downloading.md` — `window.open` instead of a download; label says "Save as PDF".
- `C35-giving-widgets-emit-no-headings.md` — legacy's `H1`/`H2` outline is gone.
- `C38-paperless-toggle-split-into-separate-element.md` — the Go Paperless control moved out of this widget.

Not re-filed: `C62` (My Giving link-out), `C67` (no MP-configurable labels), `C68` (no `customCss`).

## Where the new widget is better

- **The year selector is a labelled control with visible state.** Legacy's radios use the file GUID as the `id` and carry no text of their own; ours are plain buttons with an explicit active class.
- **Real empty state.** A signed-in donor with no statements sees *"No statements currently available."*; legacy shows the year block with nothing in it.
- The download URL is exposed in the API payload as `Download_Url`, which made verification straightforward — legacy builds it in the browser.

## Not tested / blocked

- **Deductible / non-deductible split, header/church info, household-vs-individual scoping inside the statement itself.** Neither widget generates the PDF — both just serve a file MP's statement routine produced, and this MP instance has no genuine generated statement to inspect. My fixture PDFs were hand-made, so their contents say nothing about MP's statement layout. To test this properly someone needs MP to run a real statement generation for a household with mixed deductible/non-deductible giving; that is an MP-side batch job, not something either widget controls.
- **Multiple accounting companies.** Only one (`Accounting_Company_ID` 1) exists here, so the multi-group render path (both widgets group by company) is unexercised.
- **Statement year selection beyond two years** and the ordering of more than two years.
- **`mygivingwidgettargeturl`** — no equivalent to drive; `C62` covers it.

## MP data created and cleaned up

`Contribution_Statements` 5 (2025) and 6 (2024) for Household 85, plus the two attached files (`FileId` 839, 840, `UniqueFileId` `57625614-a5b0-4588-9053-c1a7e7b74558` and `7b4ea4ee-cc2e-4e05-85f3-b2027c2d74a8`). Files deleted first, then the statement rows, at the end of the run.

## Screenshots

- `screenshots/my-contribution-statement-old-initial.png` — legacy baseline
- `screenshots/my-contribution-statement-new-initial.png` — new baseline
- `screenshots/my-contribution-statement-old-authed.png` — legacy signed in, showing the paperless toggle and My Giving link this widget no longer has (C38, C62)
- `screenshots/my-contribution-statement-new-authed.png` — new signed in, year buttons + Save as PDF
- `screenshots/my-contribution-statement-old-signedout.png` and `my-contribution-statement-new-signedout.png` — the C30 pair
- `screenshots/my-contribution-statement-old-mobile.png` and `my-contribution-statement-new-mobile.png` — 390x844
