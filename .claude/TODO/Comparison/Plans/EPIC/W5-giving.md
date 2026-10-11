# W5 — Giving (wave 1)

**Branch:** `ws/w5-giving`

**Items:** C30 · C31 · C32 · C33 · C34 · C35 · C37 · C38 · C62. This workstream also fixes C39
in `my-giving`, `my-pledges` and `pledge-campaign`, and does the C79 renames for
`hidesoftcredits`, `hidecancelbuttonpledge` and `cancelpledgeemailtemplate`.

**Design source:** `Plans/my-giving.md`, `Plans/my-pledges.md`, `Plans/pledge-campaign.md`,
`Plans/contribution-statements.md`

**Owns:**
- Components: `my-giving.ts`, `my-pledges.ts`, `my-contribution-statement.ts`,
  `statement-preferences.ts`, `pledge-campaign.ts`. Also `my-mission-trips.ts`, but only if W0's
  reference conversion needs a follow-up.
- Services, routes and types for giving, pledges, statements and pledge campaigns.
- In `locales/*/giving.ts`: the `myGiving`, `myPledges`, `statements`, `statementPreferences`
  and `pledgeCampaign` namespaces. **Not** `checkout`/`pay` (W1) or `subscriptions` (W6).
- Matching demo pages.

**Status at 2026-10-11:** all open. C36 is closed by W0.

## Order

1. **C30 — four widgets show an error instead of a sign-in prompt.** `my-giving.ts:170-182`,
   `my-pledges.ts:189-193`, `my-contribution-statement.ts:135-139` and
   `statement-preferences.ts:140-144` all need to move to W0's `renderSignInRequired()`.
   Follow CROSS-1 Phase 2: show the widget heading and a muted skeleton behind the prompt.
2. **C39 and C79 — attribute handling.**
   - Move `my-giving.ts:57-61`, `my-pledges.ts:52-56` and `pledge-campaign.ts:125-130`
     (`&& this.campaign`) to W0's `reconfigure()`.
   - Rename the attributes to `hide-soft-credits`, `hide-cancel-button-pledge` and
     `cancel-pledge-email-template`, reading them through `readAttr`. Then delete the three
     allowlist entries.
3. **C31 — cancel button default.** At `my-pledges.ts:31-33`, show the cancel button by
   default; `hide-cancel-button-pledge="true"` hides it. This depends on step 2. Keep the
   verified cancellation email (see the `my-pledges-cancel-email-scope` memory: the full
   cancel flow ships in v1).
4. **C32 — pledge amount limits.**
   - Validate the amount on both client and server: greater than 0, with a sane ceiling.
   - Client: `pledge-campaign.ts:874` and `submit()` at `:366-410`, using `form-validation`
     `customValidators`.
   - Server: `SavePledgeRequestSchema` (`packages/types/src/pledge-campaign.ts:91-106`) gets
     `.positive()` and a `.max(...)`, and the save route rejects anything outside that.
   - Work out the ceiling from the campaign's goal, or use a fixed bound. Record which was
     chosen.
5. **C35 — headings.**
   - Give the four widgets a real heading outline: `<h1|h2 class="title">` etc., with a
     `h1,h2,h3,h4 { font: inherit; margin: 0 }` reset. Copy the pattern from
     `pledge-campaign`.
   - Add a `heading-level` attribute, default 2.
   - In `my-pledges`, give `.progress-track` `role="progressbar"` and its `aria-value*`
     attributes.
   - In `statement-preferences`, add a `:focus-visible` ring on the `.slider`.
6. **C33 — chart values.** In `my-giving.ts:276-330`, show values on or above each bar, add a
   `<title>` per bar, and provide a visually-hidden table alternative. Re-check the
   months-shown cap at `:279` and the hide-on-month-select at `:263` against `my-giving.md`.
7. **C37 — soft-credit copy and month labels.**
   - Show the year on individual month options (`:230`).
   - Show the soft-credit note whenever soft credits exist, not only while the box is ticked
     (`:401`).
   - Change the wording to include "excluded from total". Update en, es and pt-BR, then run
     `pnpm i18n:sync`.
8. **C34 — PDF download.** Replace `window.open` at `my-contribution-statement.ts:109` with
   an `<a download>` / blob fetch, as `contribution-statements.md` recommends. If that fails
   (CORS), fall back to opening a tab.
9. **C38 — Go Paperless toggle.** Follow `contribution-statements.md`'s recommendation for the
   split: an opt-in `show-paperless-toggle` attribute that embeds the preference control. Keep
   the existing `statement-preferences` element, and keep reading `Statement_Method_ID`
   correctly (legacy doesn't).
10. **C62 — link to My Giving.** Add a `my-giving-url` attribute to
    `my-contribution-statement`; there are no attributes today.

## Protect

- Money matches MP to the cent, soft credits stay excluded, and split gifts are not
  double-counted.
- Year boundaries hold: a Dec 31 23:30 gift lands in 2025.
- The pledge-campaign heading outline.
- The `my-pledges` cancel flow and its email.
- `Statement_Method_ID` correctness.

## Stale-plan corrections

- C36 is already done (`fmt.date "medium"`), so skip "sweep in CROSS-5".
- Copy goes through the catalogue in all three locales.
- Some line numbers have moved; the ones above are current.

## Acceptance

- Each design-source plan's acceptance criteria pass.
- All four widgets work signed out in both `legacy` and `dual` mode.
- Setting attributes late takes effect.
- Pledges of $0 and $1e13 are rejected by the route.
- Every giving widget emits headings.
- The guard allowlist has lost the three giving spellings.
- Epic gates are green.
