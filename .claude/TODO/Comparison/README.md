# Legacy → Next widget comparison findings

**80 items, filed 2026-09-08**, plus C83, filed 2026-09-09 while remediating.

- **Method.** Every legacy MinistryPlatform widget at `mpi.ministryplatform.com/widgets` was
  driven side by side with its `next-*` counterpart in this repo, both pointed at the
  **same MP instance**. Every data difference recorded here is therefore a real difference,
  not two datasets.
- **Coverage.** All 25 `next-*` elements that existed *at the time* were exercised signed out
  and signed in.
- **Checks.** Money, dates and written rows were cross-checked against MP directly through
  the client-credentials API, not read off the screen.
- **Roster today.** **33 registered elements**, re-measured on 2026-10-11 with the commands
  in `CLAUDE.md`. The eight added since the run have no comparison pass, because they are
  the remediation.

> ### Status: closed out, 2026-10-11 (comparison-remediation epic)
>
> **Every item now has a final state.** Of the 81:
>
> | State | Count | Items |
> |---|---|---|
> | **Resolved** | **74** | 64 in the epic (waves W0–W6). C36 was fixed in passing by i18n and closed in W0. Nine were resolved before the epic: C52, C67, C69, C70, C72, C73, C76, C78 and C83. |
> | **Partially resolved** | 1 | **C68**. The `--nw-*` theming tokens shipped (W7a contract, then the W7b conversion of every widget). Still open: `part=` / `::part()`, a per-element `custom-css` attribute, and a domain-level stylesheet, the `GetCustomStyles` equivalent. |
> | **Won't port / won't do / keep ours** | 4 | **C71**: no RSS reader (won't port). **C77**: no `next-user-label` (won't do). **C27**: no Country on custom forms, because `Form_Responses` has no country column (won't port). **C57**: birthdays show month and day only (keep ours). |
> | **Deferred** | 2 | **C74** `mpp-smart-link` and **C75** `mpp-smart-frame`. Both wait on the Tier 3 auth-design decision in [`Plans/ROADMAP-missing-widgets.md`](Plans/ROADMAP-missing-widgets.md). |
>
> The full per-item table is under [Item ledger](#item-ledger--final-state-2026-10-11)
> below. Each item's state links to the resolution section at the foot of its own file.
> The findings sections after that are kept **as filed**: each row is the finding as
> recorded on 2026-09-08, and the bold link beside its number gives its final state.
>
> **Landing on the fix-up branch.** These were done in the epic and land on the final
> fix-up branch that merges after W9:
> - headings in `next-checkout`, `next-pay`, `next-full-calendar` and `next-unsubscribe`,
>   which W8's accessibility probe found missing;
> - `next-pledge-campaign` rendering raw error messages, now routed through `errorText()`;
> - the last three theming-token leftovers: a new `--nw-color-warning` token, which leaves
>   the `theme-tokens.test.ts` ratchet empty;
> - a live check of the `next-opportunity-details` image `$select`.
>
> **Still open after the epic** (none is a defect in a shipped flow):
> - C43: whether to refuse an overpayment or record and flag it, once a real payment vendor
>   is wired in.
> - C48: where payor and billing data comes from for that vendor.
> - C68: the three remaining styling channels.
> - C74 and C75: the auth-design decision.
> - Session and engineering follow-ups: [`Plans/EPIC/README.md`](Plans/EPIC/README.md#outcome).
>
> History: the 2026-09-09 banner recorded C67, C73, the four Tier 1 widgets and C83 as
> resolved; Tier 2 (2026-09-11) added C52 and C76, plus C71 as a won't-port. The epic
> (2026-10-11) closed everything else. How it was run:
> [`Plans/EPIC/README.md`](Plans/EPIC/README.md).

These are **`C`-numbered** deliberately. The numeric items in `.claude/TODO/` are the
dependency-upgrade backlog; this is a separate axis of work and does not continue that
sequence.

- Method, conventions, item template: `.claude/playwright/widget/BRIEF.md`
- Harness — how to reproduce any of this: `.claude/playwright/widget/HARNESS.md`
- Static attribute parity per pair: `.claude/playwright/widget/CONFIG-MAP.md`
- What was actually tested, per widget: `.claude/playwright/widget/tests/*.md`
- Screenshots cited by items: `.claude/playwright/widget/screenshots/`
- Each agent's own filing notes, verbatim: [`PER-BLOCK-NOTES.md`](PER-BLOCK-NOTES.md)

**Severity:** `breaking` = the flow cannot complete, or the data is wrong ·
`functional` = a capability the legacy widget had is missing · `ux` = it works but
behaves worse · `cosmetic` = labels, formats, styling.

## Item ledger — final state (2026-10-11)

How to read the columns:
- **#** links the finding.
- **State** links the resolution section in the finding's own file.
- **By** names the epic workstream that closed it (`W0`–`W7`; see
  [`Plans/EPIC/`](Plans/EPIC/README.md)), or how it was closed before the epic.
- For C39, C79 and C81, **State** links an epic-summary section that collects the work of
  every workstream.
- The finding names come from the file names. The severity is as filed.

| # | Sev | Finding | State | By |
|---|---|---|---|---|
| [C01](C01-event-details-participants-500-signed-in.md) | breaking | event details participants 500 signed in | [**resolved**](C01-event-details-participants-500-signed-in.md#resolution--2026-10-11) | W1 |
| [C02](C02-full-calendar-month-nav-no-refetch.md) | breaking | full calendar month nav no refetch | [**resolved**](C02-full-calendar-month-nav-no-refetch.md#resolution--2026-10-11) | W2 |
| [C03](C03-full-calendar-drops-boundary-straddling-events.md) | functional | full calendar drops boundary straddling events | [**resolved**](C03-full-calendar-drops-boundary-straddling-events.md#resolution--2026-10-11) | W2 |
| [C04](C04-event-finder-no-featured-filter-control.md) | functional | event finder no featured filter control | [**resolved**](C04-event-finder-no-featured-filter-control.md#resolution--2026-10-11) | W2 |
| [C05](C05-event-finder-cards-not-keyboard-activatable.md) | functional | event finder cards not keyboard activatable | [**resolved**](C05-event-finder-cards-not-keyboard-activatable.md#resolution--2026-10-11) | W2 |
| [C06](C06-add-to-calendar-serves-non-public-events.md) | functional | add to calendar serves non public events | [**resolved**](C06-add-to-calendar-serves-non-public-events.md#resolution--2026-10-11) | W2 |
| [C07](C07-event-details-anonymous-basic-contact-401-churn.md) | ux | event details anonymous basic contact 401 churn | [**resolved**](C07-event-details-anonymous-basic-contact-401-churn.md#resolution--2026-10-11) | W2 |
| [C08](C08-full-calendar-modal-no-focus-management.md) | ux | full calendar modal no focus management | [**resolved**](C08-full-calendar-modal-no-focus-management.md#resolution--2026-10-11) | W2 |
| [C09](C09-event-finder-card-dates-omit-year.md) | cosmetic | event finder card dates omit year | [**resolved**](C09-event-finder-card-dates-omit-year.md#resolution--2026-10-11) | W2 |
| [C10](C10-group-finder-cards-not-keyboard-operable.md) | functional | group finder cards not keyboard operable | [**resolved**](C10-group-finder-cards-not-keyboard-operable.md#resolution--2026-10-11) | W3 |
| [C11](C11-group-details-sends-no-inquiry-or-signup-email.md) | functional | group details sends no inquiry or signup email | [**resolved**](C11-group-details-sends-no-inquiry-or-signup-email.md#resolution--2026-10-11) | W3 |
| [C12](C12-group-inquiry-row-missing-name-email-phone.md) | functional | group inquiry row missing name email phone | [**resolved**](C12-group-inquiry-row-missing-name-email-phone.md#resolution--2026-10-11) | W3 |
| [C13](C13-my-groups-signed-out-shows-error-not-signin.md) | functional | my groups signed out shows error not signin | [**resolved**](C13-my-groups-signed-out-shows-error-not-signin.md#resolution--2026-10-11) | W3 |
| [C14](C14-group-details-signup-no-blank-form.md) | functional | group details signup no blank form | [**resolved**](C14-group-details-signup-no-blank-form.md#resolution--2026-10-11) | W3 |
| [C15](C15-group-finder-anonymous-suggest-dead-ends.md) | ux | group finder anonymous suggest dead ends | [**resolved**](C15-group-finder-anonymous-suggest-dead-ends.md#resolution--2026-10-11) | W3 |
| [C16](C16-group-details-inquiry-phone-no-longer-required.md) | ux | group details inquiry phone no longer required | [**resolved**](C16-group-details-inquiry-phone-no-longer-required.md#resolution--2026-10-11) | W3 |
| [C17](C17-group-details-greets-user-surname-first.md) | cosmetic | group details greets user surname first | [**resolved**](C17-group-details-greets-user-surname-first.md#resolution--2026-10-11) | W3 |
| [C18](C18-group-finder-copy-and-format-drift.md) | cosmetic | group finder copy and format drift | [**resolved**](C18-group-finder-copy-and-format-drift.md#resolution--2026-10-11) | W3 |
| [C19](C19-group-details-copy-layout-and-tab-semantics-drift.md) | cosmetic | group details copy layout and tab semantics drift | [**resolved**](C19-group-details-copy-layout-and-tab-semantics-drift.md#resolution--2026-10-11) | W3 |
| [C20](C20-opportunity-finder-attributes-filter-missing.md) | functional | opportunity finder attributes filter missing | [**resolved**](C20-opportunity-finder-attributes-filter-missing.md#resolution--2026-10-11) | W4 |
| [C21](C21-opportunity-response-row-missing-contact-fields.md) | functional | opportunity response row missing contact fields | [**resolved**](C21-opportunity-response-row-missing-contact-fields.md#resolution--2026-10-11) | W4 |
| [C22](C22-opportunity-card-not-keyboard-activatable.md) | functional | opportunity card not keyboard activatable | [**resolved**](C22-opportunity-card-not-keyboard-activatable.md#resolution--2026-10-11) | W4 |
| [C23](C23-plan-your-visit-no-address-autocomplete.md) | functional | plan your visit no address autocomplete | [**resolved**](C23-plan-your-visit-no-address-autocomplete.md#resolution--2026-10-11) | W4 |
| [C24](C24-plan-your-visit-phone-mask-blocks-submit.md) | breaking | plan your visit phone mask blocks submit | [**resolved**](C24-plan-your-visit-phone-mask-blocks-submit.md#resolution--2026-10-11) | W4 |
| [C25](C25-opportunity-one-time-date-shown-as-weekday-plural.md) | functional | opportunity one time date shown as weekday plural | [**resolved**](C25-opportunity-one-time-date-shown-as-weekday-plural.md#resolution--2026-10-11) | W4 |
| [C26](C26-custom-form-no-complete-form-as-picker.md) | functional | custom form no complete form as picker | [**resolved**](C26-custom-form-no-complete-form-as-picker.md#resolution--2026-10-11) | W4 |
| [C27](C27-custom-form-address-has-no-country.md) | functional | custom form address has no country | [**won't port**](C27-custom-form-address-has-no-country.md#resolution--2026-10-11) | W4 |
| [C28](C28-visit-and-form-inputs-have-no-accessible-name.md) | ux | visit and form inputs have no accessible name | [**resolved**](C28-visit-and-form-inputs-have-no-accessible-name.md#resolution--2026-10-11) | W4 |
| [C29](C29-phone-inputs-are-text-not-tel.md) | ux | phone inputs are text not tel | [**resolved**](C29-phone-inputs-are-text-not-tel.md#resolution--2026-10-11) | W4 |
| [C30](C30-giving-widgets-signed-out-error-instead-of-sign-in.md) | functional | giving widgets signed out error instead of sign in | [**resolved**](C30-giving-widgets-signed-out-error-instead-of-sign-in.md#resolution--2026-10-11) | W5 |
| [C31](C31-my-pledges-cancel-button-default-inverted.md) | functional | my pledges cancel button default inverted | [**resolved**](C31-my-pledges-cancel-button-default-inverted.md#resolution--2026-10-11) | W5 |
| [C32](C32-pledge-campaign-accepts-zero-and-absurd-amounts.md) | functional | pledge campaign accepts zero and absurd amounts | [**resolved**](C32-pledge-campaign-accepts-zero-and-absurd-amounts.md#resolution--2026-10-11) | W5 |
| [C33](C33-my-giving-by-month-chart-has-no-values.md) | ux | my giving by month chart has no values | [**resolved**](C33-my-giving-by-month-chart-has-no-values.md#resolution--2026-10-11) | W5 |
| [C34](C34-statement-save-as-pdf-opens-tab-instead-of-downloading.md) | ux | statement save as pdf opens tab instead of downloading | [**resolved**](C34-statement-save-as-pdf-opens-tab-instead-of-downloading.md#resolution--2026-10-11) | W5 |
| [C35](C35-giving-widgets-emit-no-headings.md) | ux | giving widgets emit no headings | [**resolved**](C35-giving-widgets-emit-no-headings.md#resolution--2026-10-11) | W5 |
| [C36](C36-giving-date-format-differs-from-legacy.md) | cosmetic | giving date format differs from legacy | [**resolved (by i18n)**](C36-giving-date-format-differs-from-legacy.md#resolution--fixed-in-passing-by-widget-localisation-closed-2026-10-11-epic-w0) | W0 |
| [C37](C37-my-giving-soft-credit-copy-and-month-labels.md) | cosmetic | my giving soft credit copy and month labels | [**resolved**](C37-my-giving-soft-credit-copy-and-month-labels.md#resolution--2026-10-11) | W5 |
| [C38](C38-paperless-toggle-split-into-separate-element.md) | ux | paperless toggle split into separate element | [**resolved**](C38-paperless-toggle-split-into-separate-element.md#resolution--2026-10-11) | W5 |
| [C39](C39-attribute-changed-callback-ignores-first-set.md) | functional | attribute changed callback ignores first set | [**resolved**](C39-attribute-changed-callback-ignores-first-set.md#resolution--2026-10-11-epic-summary-w9) | W0 |
| [C40](C40-payments-never-recorded-amount-paid-column.md) | breaking | payments never recorded amount paid column | [**resolved**](C40-payments-never-recorded-amount-paid-column.md#resolution--2026-10-11) | W1 |
| [C41](C41-declined-payment-reported-as-processing.md) | breaking | declined payment reported as processing | [**resolved**](C41-declined-payment-reported-as-processing.md#resolution--2026-10-11) | W1 |
| [C42](C42-checkout-500s-for-every-signed-in-user.md) | breaking | checkout 500s for every signed in user | [**resolved**](C42-checkout-500s-for-every-signed-in-user.md#resolution--2026-10-11) | W1 |
| [C43](C43-payment-request-token-unlimited-use.md) | functional | payment request token unlimited use | [**resolved**](C43-payment-request-token-unlimited-use.md#resolution--2026-10-11) | W1 |
| [C44](C44-my-invoices-pay-now-injects-legacy-mpp-checkout.md) | breaking | my invoices pay now injects legacy mpp checkout | [**resolved**](C44-my-invoices-pay-now-injects-legacy-mpp-checkout.md#resolution--2026-10-11) | W1 |
| [C45](C45-my-invoices-list-not-keyboard-reachable.md) | functional | my invoices list not keyboard reachable | [**resolved**](C45-my-invoices-list-not-keyboard-reachable.md#resolution--2026-10-11) | W1 |
| [C46](C46-my-invoices-anonymous-shows-error-not-sign-in.md) | functional | my invoices anonymous shows error not sign in | [**resolved**](C46-my-invoices-anonymous-shows-error-not-sign-in.md#resolution--2026-10-11) | W1 |
| [C47](C47-zero-total-invoice-labelled-paid-in-full.md) | cosmetic | zero total invoice labelled paid in full | [**resolved**](C47-zero-total-invoice-labelled-paid-in-full.md#resolution--2026-10-11) | W1 |
| [C48](C48-pay-collects-and-validates-far-less-than-legacy.md) | functional | pay collects and validates far less than legacy | [**resolved**](C48-pay-collects-and-validates-far-less-than-legacy.md#resolution--2026-10-11) | W1 |
| [C49](C49-make-changes-link-loses-event-and-invoice-ids.md) | functional | make changes link loses event and invoice ids | [**resolved**](C49-make-changes-link-loses-event-and-invoice-ids.md#resolution--2026-10-11) | W1 |
| [C50](C50-online-directory-search-query-too-long.md) | breaking | online directory search query too long | [**resolved**](C50-online-directory-search-query-too-long.md#resolution--2026-10-11) | W6 |
| [C51](C51-profile-non-numeric-phone-silently-wipes-number.md) | breaking | profile non numeric phone silently wipes number | [**resolved**](C51-profile-non-numeric-phone-silently-wipes-number.md#resolution--2026-10-11) | W6 |
| [C52](C52-about-me-contact-attributes-no-counterpart.md) | functional | about me contact attributes no counterpart | [**resolved (pre-epic)**](C52-about-me-contact-attributes-no-counterpart.md#resolution--built-2026-09-11) | Tier 1/2 |
| [C53](C53-auth-required-states-have-no-sign-in-button.md) | ux | auth required states have no sign in button | [**resolved**](C53-auth-required-states-have-no-sign-in-button.md#resolution--2026-10-11) | W6 |
| [C54](C54-user-menu-no-focus-return-on-close.md) | ux | user menu no focus return on close | [**resolved**](C54-user-menu-no-focus-return-on-close.md#resolution--2026-10-11) | W6 |
| [C55](C55-subscriptions-no-bulk-email-opt-out.md) | functional | subscriptions no bulk email opt out | [**resolved**](C55-subscriptions-no-bulk-email-opt-out.md#resolution--2026-10-11) | W6 |
| [C56](C56-user-menu-drops-child-markup-no-custom-links.md) | functional | user menu drops child markup no custom links | [**resolved**](C56-user-menu-drops-child-markup-no-custom-links.md#resolution--2026-10-11) | W6 |
| [C57](C57-my-household-member-birthdays-lose-the-year.md) | cosmetic | my household member birthdays lose the year | [**keep ours**](C57-my-household-member-birthdays-lose-the-year.md#resolution--2026-10-11) | W6 |
| [C60](C60-my-invoices-no-configuration-attributes.md) | functional | my invoices no configuration attributes | [**resolved**](C60-my-invoices-no-configuration-attributes.md#resolution--2026-10-11) | W1 |
| [C61](C61-subscriptions-no-congregation-filter.md) | functional | subscriptions no congregation filter | [**resolved**](C61-subscriptions-no-congregation-filter.md#resolution--2026-10-11) | W6 |
| [C62](C62-my-contribution-statement-no-my-giving-link.md) | functional | my contribution statement no my giving link | [**resolved**](C62-my-contribution-statement-no-my-giving-link.md#resolution--2026-10-11) | W5 |
| [C63](C63-plan-your-visit-user-notification-template.md) | functional | plan your visit user notification template | [**resolved**](C63-plan-your-visit-user-notification-template.md#resolution--2026-10-11) | W4 |
| [C64](C64-group-finder-city-postal-code-not-presettable.md) | functional | group finder city postal code not presettable | [**resolved**](C64-group-finder-city-postal-code-not-presettable.md#resolution--2026-10-11) | W3 |
| [C65](C65-opportunity-details-no-show-full-address.md) | functional | opportunity details no show full address | [**resolved**](C65-opportunity-details-no-show-full-address.md#resolution--2026-10-11) | W4 |
| [C66](C66-checkout-no-receipt-template-id.md) | functional | checkout no receipt template id | [**resolved**](C66-checkout-no-receipt-template-id.md#resolution--2026-10-11) | W1 |
| [C67](C67-no-mp-configurable-labels.md) | functional | no mp configurable labels | [**resolved (pre-epic)**](C67-no-mp-configurable-labels.md#resolved--2026-09-09) | Tier 1/2 |
| [C68](C68-no-custom-css-channel.md) | functional | no custom css channel | [**partial**](C68-no-custom-css-channel.md#resolution--2026-10-11-partial) | W7 |
| [C69](C69-no-prayer-feedback-widget.md) | functional | no prayer feedback widget | [**resolved (pre-epic)**](C69-no-prayer-feedback-widget.md#resolved--2026-09-09-next-prayer-feedback) | Tier 1/2 |
| [C70](C70-no-subscribe-to-publication-widget.md) | functional | no subscribe to publication widget | [**resolved (pre-epic)**](C70-no-subscribe-to-publication-widget.md#resolution--2026-09-09-next-subscribe-to-publication) | Tier 1/2 |
| [C71](C71-no-rss-reader-widget.md) | functional | no rss reader widget | [**won't port**](C71-no-rss-reader-widget.md#resolution--wont-port-decided-2026-09-11) | Tier 2 decision |
| [C72](C72-no-one-click-unsubscribe-widget.md) | functional | no one click unsubscribe widget | [**resolved (pre-epic)**](C72-no-one-click-unsubscribe-widget.md#resolved--2026-09-09) | Tier 1/2 |
| [C73](C73-no-locale-selector-no-localisation.md) | functional | no locale selector no localisation | [**resolved (pre-epic)**](C73-no-locale-selector-no-localisation.md#resolved--2026-09-09) | Tier 1/2 |
| [C74](C74-no-smart-link-widget.md) | functional | no smart link widget | [**deferred**](C74-no-smart-link-widget.md#status--deferred-decided-2026-10-11-comparison-remediation-epic) | — |
| [C75](C75-no-smart-frame-widget.md) | functional | no smart frame widget | [**deferred**](C75-no-smart-frame-widget.md#status--deferred-decided-2026-10-11-comparison-remediation-epic) | — |
| [C76](C76-no-mission-trip-widgets.md) | functional | no mission trip widgets | [**resolved (pre-epic)**](C76-no-mission-trip-widgets.md#resolution--built-2026-09-11) | Tier 1/2 |
| [C77](C77-no-user-label-widget.md) | ux | no user label widget | [**won't do**](C77-no-user-label-widget.md#resolution--wont-do-decided-2026-10-11-comparison-remediation-epic) | — |
| [C78](C78-no-pre-check-widget.md) | functional | no pre check widget | [**resolved (pre-epic)**](C78-no-pre-check-widget.md#resolution) | Tier 1/2 |
| [C79](C79-inconsistent-attribute-naming.md) | cosmetic | inconsistent attribute naming | [**resolved**](C79-inconsistent-attribute-naming.md#resolution--2026-10-11-epic-summary-w9) | W0 |
| [C80](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md) | breaking | mploggedincontactid param breaks signed in invoice reads | [**resolved**](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md#resolution--2026-10-11) | W1 |
| [C81](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md) | functional | auth only widgets show dead error instead of sign in | [**resolved**](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md#resolution--2026-10-11-epic-summary-w9) | W0 |
| [C82](C82-plan-your-visit-syncchildren-discards-child-fields.md) | functional | plan your visit syncchildren discards child fields | [**resolved**](C82-plan-your-visit-syncchildren-discards-child-fields.md#resolution--2026-10-11) | W4 |
| [C83](C83-plan-your-visit-writes-nonexistent-contacts-status-column.md) | functional | plan your visit writes nonexistent contacts status column | [**resolved (pre-epic)**](C83-plan-your-visit-writes-nonexistent-contacts-status-column.md#resolved--2026-09-09) | Tier 1 build |

## Start here — the four cross-cutting items

Fix these before the per-widget items they explain; each is one cause with many symptoms.

| # | Sev | What |
|---|---|---|
| [C80](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md) [**resolved**](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md#resolution--2026-10-11) | breaking | `@MpLoggedInContactId` is passed to a proc that has no such parameter, so **every signed-in `api_MPPW_GetInvoice` read 500s**. Two call sites, two widgets (C01, C42). Works anonymously, which is why it hid. |
| [C81](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md) [**resolved**](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md#resolution--2026-10-11-epic-summary-w9) | functional | **Nine+ auth-only widgets show a dead error with a useless "Try Again" instead of a sign-in prompt** (C13, C30, C46, C53). `requestLogin()` already exists in `base-widget.ts` and nine other components use it. |
| [C67](C67-no-mp-configurable-labels.md) [**resolved (pre-epic)**](C67-no-mp-configurable-labels.md#resolved--2026-09-09) | functional | (With C73.) Widget copy now comes from a TypeScript catalogue in this repo — `en`/`es`/`pt-BR` — plus `MPNextEmbed.setMessages()` for church label renames. Deliberately **not** a `GetLabels` equivalent; no church copy is read from MP. MP-authored *content* is still untranslated and cannot be by this approach — read the file before reopening. |
| [C68](C68-no-custom-css-channel.md) [**partial**](C68-no-custom-css-channel.md#resolution--2026-10-11-partial) | functional | **No widget can be restyled at all** — no `customCss`, no domain stylesheet channel, no theming tokens, no `part=`, and `injectStyles()` *assigns* `adoptedStyleSheets`. Shadow DOM leaves the host page no workaround. All 36 legacy widgets support both channels. |

## breaking (10)

| # | Widget | What |
|---|---|---|
| [C40](C40-payments-never-recorded-amount-paid-column.md) [**resolved**](C40-payments-never-recorded-amount-paid-column.md#resolution--2026-10-11) | checkout / pay | **No payment is ever recorded.** `paymentService` selects `Invoices.Amount_Paid`, a column MP does not have; MP 500s, a bare `catch` swallows it, HTTP 200 throughout. Schema-confirmed — reproduces on every domain. |
| [C24](C24-plan-your-visit-phone-mask-blocks-submit.md) [**resolved**](C24-plan-your-visit-phone-mask-blocks-submit.md#resolution--2026-10-11) | plan-your-visit | **The flow can never complete.** MP's *display* mask `xxx-xxx-xxxx` is used as an HTML `pattern`, so the required phone field rejects every real number. |
| [C50](C50-online-directory-search-query-too-long.md) [**resolved**](C50-online-directory-search-query-too-long.md#resolution--2026-10-11) | online-directory | **No search can run.** The MP query string is 2,100–2,335 chars against IIS's 2048 limit; a full absolute URL is inlined into the `$select`. Scales with base-URL length, so a shorter host masks it. |
| [C51](C51-profile-non-numeric-phone-silently-wipes-number.md) [**resolved**](C51-profile-non-numeric-phone-silently-wipes-number.md#resolution--2026-10-11) | profile | **Silently deletes a stored phone number** when non-numeric text is typed — destroyed in the input handler, before validation can object. Verified against MP: a real number → `null` on a 200. |
| [C80](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md) [**resolved**](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md#resolution--2026-10-11) | event-details + checkout | The shared root cause of the next two. |
| [C42](C42-checkout-500s-for-every-signed-in-user.md) [**resolved**](C42-checkout-500s-for-every-signed-in-user.md#resolution--2026-10-11) | checkout | 500s with a raw MP error **for every signed-in user**. Anonymous checkout works. |
| [C01](C01-event-details-participants-500-signed-in.md) [**resolved**](C01-event-details-participants-500-signed-in.md#resolution--2026-10-11) | event-details | 500s on a signed-in user's participant list. |
| [C44](C44-my-invoices-pay-now-injects-legacy-mpp-checkout.md) [**resolved**](C44-my-invoices-pay-now-injects-legacy-mpp-checkout.md#resolution--2026-10-11) | my-invoices | "Pay Now" injects the **legacy** `<mpp-checkout>` tag with a numeric id where a GUID is required — paying an invoice is a dead end. |
| [C41](C41-declined-payment-reported-as-processing.md) [**resolved**](C41-declined-payment-reported-as-processing.md#resolution--2026-10-11) | checkout | Tells the payer a **declined** payment is "being processed". `checkout-complete.ts` gets this right; `checkout.ts` only branches on `paymentReceived`. |
| [C02](C02-full-calendar-month-nav-no-refetch.md) [**resolved**](C02-full-calendar-month-nav-no-refetch.md#resolution--2026-10-11) | full-calendar | Fetches one fixed 3-month window and **never refetches on month navigation** — paging outside it shows stale or empty data. |

## functional (48)

**Data written wrong or lost**
[C12](C12-group-inquiry-row-missing-name-email-phone.md) [**resolved**](C12-group-inquiry-row-missing-name-email-phone.md#resolution--2026-10-11) group inquiries store NULL name/email/phone for household members ·
[C21](C21-opportunity-response-row-missing-contact-fields.md) [**resolved**](C21-opportunity-response-row-missing-contact-fields.md#resolution--2026-10-11) the same defect in opportunity responses ·
[C82](C82-plan-your-visit-syncchildren-discards-child-fields.md) [**resolved**](C82-plan-your-visit-syncchildren-discards-child-fields.md#resolution--2026-10-11) adding a child wipes every typed child field ·
[C32](C32-pledge-campaign-accepts-zero-and-absurd-amounts.md) [**resolved**](C32-pledge-campaign-accepts-zero-and-absurd-amounts.md#resolution--2026-10-11) a $0.00 (and a $15,999,999,999,984.00) pledge saves as success ·
[C43](C43-payment-request-token-unlimited-use.md) [**resolved**](C43-payment-request-token-unlimited-use.md#resolution--2026-10-11) payment token is unlimited-use for 15 min — resubmit mints a second payment; no overpay guard ·
[C11](C11-group-details-sends-no-inquiry-or-signup-email.md) [**resolved**](C11-group-details-sends-no-inquiry-or-signup-email.md#resolution--2026-10-11) no inquiry / sign-up / leader emails sent at all ·
[C06](C06-add-to-calendar-serves-non-public-events.md) [**resolved**](C06-add-to-calendar-serves-non-public-events.md#resolution--2026-10-11) non-public and cancelled events served to an anonymous token ·
[C03](C03-full-calendar-drops-boundary-straddling-events.md) [**resolved**](C03-full-calendar-drops-boundary-straddling-events.md#resolution--2026-10-11) calendar range filters by containment, not overlap ·
[C39](C39-attribute-changed-callback-ignores-first-set.md) [**resolved**](C39-attribute-changed-callback-ignores-first-set.md#resolution--2026-10-11-epic-summary-w9) configuring a mounted widget from script is a no-op (3 components)

**Keyboard-unreachable primary action** — all four announce `role="link"` but have no anchor and no Enter/Space handler, where legacy used a real `<a href>`
[C05](C05-event-finder-cards-not-keyboard-activatable.md) [**resolved**](C05-event-finder-cards-not-keyboard-activatable.md#resolution--2026-10-11) ·
[C10](C10-group-finder-cards-not-keyboard-operable.md) [**resolved**](C10-group-finder-cards-not-keyboard-operable.md#resolution--2026-10-11) ·
[C22](C22-opportunity-card-not-keyboard-activatable.md) [**resolved**](C22-opportunity-card-not-keyboard-activatable.md#resolution--2026-10-11) ·
[C45](C45-my-invoices-list-not-keyboard-reachable.md) [**resolved**](C45-my-invoices-list-not-keyboard-reachable.md#resolution--2026-10-11)

**A capability the legacy widget had**
[C20](C20-opportunity-finder-attributes-filter-missing.md) [**resolved**](C20-opportunity-finder-attributes-filter-missing.md#resolution--2026-10-11) Attributes filter absent — the config query names a nonexistent column, 500s, swallowed ·
[C26](C26-custom-form-no-complete-form-as-picker.md) [**resolved**](C26-custom-form-no-complete-form-as-picker.md#resolution--2026-10-11) no "Complete Form As" household picker, so a parent cannot complete a form for a child ·
[C14](C14-group-details-signup-no-blank-form.md) [**resolved**](C14-group-details-signup-no-blank-form.md#resolution--2026-10-11) can only sign up a household member ·
[C23](C23-plan-your-visit-no-address-autocomplete.md) [**resolved**](C23-plan-your-visit-no-address-autocomplete.md#resolution--2026-10-11) no address autocomplete, though the helper and MP key channel already exist here ·
[C48](C48-pay-collects-and-validates-far-less-than-legacy.md) [**resolved**](C48-pay-collects-and-validates-far-less-than-legacy.md#resolution--2026-10-11) no payor/billing fields, no ACH option, required-only validation ·
[C55](C55-subscriptions-no-bulk-email-opt-out.md) [**resolved**](C55-subscriptions-no-bulk-email-opt-out.md#resolution--2026-10-11) bulk-email opt-out gone from subscriptions ·
[C56](C56-user-menu-drops-child-markup-no-custom-links.md) [**resolved**](C56-user-menu-drops-child-markup-no-custom-links.md#resolution--2026-10-11) custom menu links silently dropped when signed in ·
[C27](C27-custom-form-address-has-no-country.md) [**won't port**](C27-custom-form-address-has-no-country.md#resolution--2026-10-11) no Country field ·
[C04](C04-event-finder-no-featured-filter-control.md) [**resolved**](C04-event-finder-no-featured-filter-control.md#resolution--2026-10-11) no Featured filter control ·
[C25](C25-opportunity-one-time-date-shown-as-weekday-plural.md) [**resolved**](C25-opportunity-one-time-date-shown-as-weekday-plural.md#resolution--2026-10-11) a one-time opportunity shows as "Fridays" with its date dropped ·
[C31](C31-my-pledges-cancel-button-default-inverted.md) [**resolved**](C31-my-pledges-cancel-button-default-inverted.md#resolution--2026-10-11) cancel hidden by default where legacy shows it ·
[C49](C49-make-changes-link-loses-event-and-invoice-ids.md) [**resolved**](C49-make-changes-link-loses-event-and-invoice-ids.md#resolution--2026-10-11) "Make Changes" loses the ids legacy resolves in

**Configuration attributes with no equivalent** — static, from each legacy bundle's `observedAttributes`
[C60](C60-my-invoices-no-configuration-attributes.md) [**resolved**](C60-my-invoices-no-configuration-attributes.md#resolution--2026-10-11) my-invoices accepts *none* of six ·
[C61](C61-subscriptions-no-congregation-filter.md) [**resolved**](C61-subscriptions-no-congregation-filter.md#resolution--2026-10-11) ·
[C62](C62-my-contribution-statement-no-my-giving-link.md) [**resolved**](C62-my-contribution-statement-no-my-giving-link.md#resolution--2026-10-11) ·
[C63](C63-plan-your-visit-user-notification-template.md) [**resolved**](C63-plan-your-visit-user-notification-template.md#resolution--2026-10-11) ·
[C64](C64-group-finder-city-postal-code-not-presettable.md) [**resolved**](C64-group-finder-city-postal-code-not-presettable.md#resolution--2026-10-11) ·
[C65](C65-opportunity-details-no-show-full-address.md) [**resolved**](C65-opportunity-details-no-show-full-address.md#resolution--2026-10-11) ·
[C66](C66-checkout-no-receipt-template-id.md) [**resolved**](C66-checkout-no-receipt-template-id.md#resolution--2026-10-11) no receipt template — "receipt" appears nowhere in the repo

**Legacy widgets with no counterpart at all**: 11 of 36 legacy tags when filed. Seven are now built, C71 and C77 are closed without a counterpart, and **C74/C75 are deferred**.
[C72](C72-no-one-click-unsubscribe-widget.md) [**resolved (pre-epic)**](C72-no-one-click-unsubscribe-widget.md#resolved--2026-09-09) `next-unsubscribe` ·
[C70](C70-no-subscribe-to-publication-widget.md) [**resolved (pre-epic)**](C70-no-subscribe-to-publication-widget.md#resolution--2026-09-09-next-subscribe-to-publication) `next-subscribe-to-publication` ·
[C78](C78-no-pre-check-widget.md) [**resolved (pre-epic)**](C78-no-pre-check-widget.md#resolution) `next-pre-check` ·
[C69](C69-no-prayer-feedback-widget.md) [**resolved (pre-epic)**](C69-no-prayer-feedback-widget.md#resolved--2026-09-09-next-prayer-feedback) `next-prayer-feedback` ·
[C73](C73-no-locale-selector-no-localisation.md) [**resolved (pre-epic)**](C73-no-locale-selector-no-localisation.md#resolved--2026-09-09) `next-locale-selector` ·
[C76](C76-no-mission-trip-widgets.md) [**resolved (pre-epic)**](C76-no-mission-trip-widgets.md#resolution--built-2026-09-11) the whole mission-trip domain, three tags ·
[C71](C71-no-rss-reader-widget.md) [**won't port**](C71-no-rss-reader-widget.md#resolution--wont-port-decided-2026-09-11) publication feed ·
[C74](C74-no-smart-link-widget.md) [**deferred**](C74-no-smart-link-widget.md#status--deferred-decided-2026-10-11-comparison-remediation-epic) (what `giving.aspx` actually is) ·
[C75](C75-no-smart-frame-widget.md) [**deferred**](C75-no-smart-frame-widget.md#status--deferred-decided-2026-10-11-comparison-remediation-epic) ·
[C52](C52-about-me-contact-attributes-no-counterpart.md) [**resolved (pre-epic)**](C52-about-me-contact-attributes-no-counterpart.md#resolution--built-2026-09-11) self-service contact attributes ·
[C77](C77-no-user-label-widget.md) [**won't do**](C77-no-user-label-widget.md#resolution--wont-do-decided-2026-10-11-comparison-remediation-epic) (filed `ux`)

**Signed-out handling** — see C81
[C13](C13-my-groups-signed-out-shows-error-not-signin.md) [**resolved**](C13-my-groups-signed-out-shows-error-not-signin.md#resolution--2026-10-11) ·
[C30](C30-giving-widgets-signed-out-error-instead-of-sign-in.md) [**resolved**](C30-giving-widgets-signed-out-error-instead-of-sign-in.md#resolution--2026-10-11) ·
[C46](C46-my-invoices-anonymous-shows-error-not-sign-in.md) [**resolved**](C46-my-invoices-anonymous-shows-error-not-sign-in.md#resolution--2026-10-11) ·
plus [C67](C67-no-mp-configurable-labels.md) [**resolved (pre-epic)**](C67-no-mp-configurable-labels.md#resolved--2026-09-09), [C68](C68-no-custom-css-channel.md) [**partial**](C68-no-custom-css-channel.md#resolution--2026-10-11-partial), [C81](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md) [**resolved**](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md#resolution--2026-10-11-epic-summary-w9)

## ux (13)

[C15](C15-group-finder-anonymous-suggest-dead-ends.md) [**resolved**](C15-group-finder-anonymous-suggest-dead-ends.md#resolution--2026-10-11) full form then a 401 dead end ·
[C53](C53-auth-required-states-have-no-sign-in-button.md) [**resolved**](C53-auth-required-states-have-no-sign-in-button.md#resolution--2026-10-11) (see C81) ·
[C28](C28-visit-and-form-inputs-have-no-accessible-name.md) [**resolved**](C28-visit-and-form-inputs-have-no-accessible-name.md#resolution--2026-10-11) 13 of 14 and 20 of 27 fields have no accessible name ·
[C35](C35-giving-widgets-emit-no-headings.md) [**resolved**](C35-giving-widgets-emit-no-headings.md#resolution--2026-10-11) four widgets emit no headings at all ·
[C08](C08-full-calendar-modal-no-focus-management.md) [**resolved**](C08-full-calendar-modal-no-focus-management.md#resolution--2026-10-11) `aria-modal` that traps nothing ·
[C54](C54-user-menu-no-focus-return-on-close.md) [**resolved**](C54-user-menu-no-focus-return-on-close.md#resolution--2026-10-11) focus not returned to the trigger ·
[C29](C29-phone-inputs-are-text-not-tel.md) [**resolved**](C29-phone-inputs-are-text-not-tel.md#resolution--2026-10-11) no numeric keypad on mobile ·
[C33](C33-my-giving-by-month-chart-has-no-values.md) [**resolved**](C33-my-giving-by-month-chart-has-no-values.md#resolution--2026-10-11) chart has no values or tooltip ·
[C34](C34-statement-save-as-pdf-opens-tab-instead-of-downloading.md) [**resolved**](C34-statement-save-as-pdf-opens-tab-instead-of-downloading.md#resolution--2026-10-11) "Save as PDF" opens a popup ·
[C38](C38-paperless-toggle-split-into-separate-element.md) [**resolved**](C38-paperless-toggle-split-into-separate-element.md#resolution--2026-10-11) Go Paperless moved out of the statement widget ·
[C16](C16-group-details-inquiry-phone-no-longer-required.md) [**resolved**](C16-group-details-inquiry-phone-no-longer-required.md#resolution--2026-10-11) leaders lose the callback number ·
[C07](C07-event-details-anonymous-basic-contact-401-churn.md) [**resolved**](C07-event-details-anonymous-basic-contact-401-churn.md#resolution--2026-10-11) pointless token refresh + second 401 ·
[C77](C77-no-user-label-widget.md) [**won't do**](C77-no-user-label-widget.md#resolution--wont-do-decided-2026-10-11-comparison-remediation-epic)

## cosmetic (9)

[C09](C09-event-finder-card-dates-omit-year.md) [**resolved**](C09-event-finder-card-dates-omit-year.md#resolution--2026-10-11) ·
[C17](C17-group-details-greets-user-surname-first.md) [**resolved**](C17-group-details-greets-user-surname-first.md#resolution--2026-10-11) "Thanks, Kehayias Chris!" ·
[C18](C18-group-finder-copy-and-format-drift.md) [**resolved**](C18-group-finder-copy-and-format-drift.md#resolution--2026-10-11) ·
[C19](C19-group-details-copy-layout-and-tab-semantics-drift.md) [**resolved**](C19-group-details-copy-layout-and-tab-semantics-drift.md#resolution--2026-10-11) ·
[C36](C36-giving-date-format-differs-from-legacy.md) [**resolved (by i18n)**](C36-giving-date-format-differs-from-legacy.md#resolution--fixed-in-passing-by-widget-localisation-closed-2026-10-11-epic-w0) ·
[C37](C37-my-giving-soft-credit-copy-and-month-labels.md) [**resolved**](C37-my-giving-soft-credit-copy-and-month-labels.md#resolution--2026-10-11) ·
[C47](C47-zero-total-invoice-labelled-paid-in-full.md) [**resolved**](C47-zero-total-invoice-labelled-paid-in-full.md#resolution--2026-10-11) ·
[C57](C57-my-household-member-birthdays-lose-the-year.md) [**keep ours**](C57-my-household-member-birthdays-lose-the-year.md#resolution--2026-10-11) ·
[C79](C79-inconsistent-attribute-naming.md) [**resolved**](C79-inconsistent-attribute-naming.md#resolution--2026-10-11-epic-summary-w9)

## What passed — measured, not assumed

Recorded because a future change could regress it, and because it bounds the work above.

- **Read/data parity is exact wherever it was measurable.** Event finder 34/34 events,
  identical ids and order, every filter cross-checked against `api_MPPW_SearchEvents`.
  Group finder: all 11 filter combinations returned identical group ids in identical
  order on both sides *and* matched `api_MPPW_SearchGroups` — **no legacy filter is
  missing**. `next-my-groups` matched `api_MPPW_GetMyGroups` exactly. Opportunity finder
  attribute and result-set parity exact on every filter.
- **Money math is exact.** Total giving matched MP to the cent on both systems across
  five years; soft credits listed but correctly excluded from totals; a split gift shown
  as two rows without double-counting; non-deductible badged.
- **Dates hold at the year boundary.** A Dec 31 23:30 gift lands in 2025 and a Jan 1
  00:30 gift in 2026 on both systems — no drift, despite MP's wall-clock storage.
- **No unpublished, full or ended group leaked** on either side.
- **Privacy: ours is stricter than legacy.** Ours nulls unlisted phone/address
  server-side, never sends an email address (only a `canEmail` flag), never sends a birth
  year. Legacy ships all of it to the browser and hides it client-side. Access gates are
  at parity.
- **FullCalendar 7 SRI pre-flight passes** — all four pinned assets 200, zero integrity
  errors, both stylesheets attached, grid matches MP.
- **`next-add-to-calendar` is correct in every value checked** across Google, Outlook,
  M365, Yahoo and the `.ics`, using a fixture containing `&`, `,`, `;`, a newline and
  HTML — including 75-octet line folding.
- **All nine MP `Form_Field_Types`** (including File Upload, Date, Checkbox) render
  identically and store identical `Form_Response_Answers`.
- **Shared `form-validation.ts` is used throughout** — zero native `reportValidity`
  calls observed anywhere.

### Where the new widgets are better than legacy

Legacy writes Suggest-a-Group `Start_Date` in UTC; ours writes domain wall-clock (ours is
correct). Legacy `Inquire` and `SignUp` both 500 after writing their row; ours return 200.
Ours reads the Go Paperless preference correctly and legacy does not (C38). Ours withholds
directory data legacy leaks to the browser. `next-my-pledges` ships a self-service cancel
flow with a verified cancellation email; legacy has none.

## Also settled by this run

- **`.claude/TODO/38` (mp-widget-overrides.css never injected) — confirmed at runtime,
  reading 2 of the two the file offered: the build maintains dead plumbing.** The injected
  `<mpp-user-login>` carries zero attributes (no `customcss`), its shadow root holds only
  MP's own stylesheet, and the control computes to MP's default blue, not brand `#004C97`.
  A fix must derive the URL from `api-host`/`import.meta.url`: `window.__nextEmbedCSSUrl`
  is set only by the generated production loader, so a naive fix works in prod and
  silently no-ops in dev. Distinct from C68 — that is about styling *our* widgets, this is
  about styling *MP's*.
- **`.claude/TODO/39` density dots** confirmed absent by design; not filed.
- **`mpp-event-registration`** renders 0 chars and throws `FormFieldBuilder is not
  defined` — an internal MP sub-component, not a placeable widget. Nothing filed.
- **`mpp-checkout-complete`**'s own bundle throws `at.registerComponent is not a
  function` — an MP-side fault, not filed against us.
- Two suspicions were **disproved** rather than filed: online-directory `householdid`
  (ours reaches parity via a `keyword="hh <id>"` convention — proved against MP), and
  my-invoices client-side search (neither side finds a hidden product name).

## Known gaps in this run

- **Hidden-opportunity exposure is untestable here and carries residual risk.**
  `SearchRow.Hidden` is declared and never read, but the proc returns `Hidden=0` for every
  row on this instance and the flag is not a stored column. Needs a database answer.
- Legacy Plan Your Visit **step 2 is unreachable** (its verify link is a JWT signed with
  MP's secret), so step-2 parity is derived from the vendor bundle's own call sites.
- Legacy payment submits were **not** attempted — MP's gateway configuration is
  API-restricted, so legacy validation, decline handling and receipts are untested.
- Statement **PDF contents** untested — neither widget generates one on this instance.
- C43's duplicate-payment rows, the `Transaction_Code` guard and the checkout success
  state are all masked by C40. **Use the three-reload replay in C43 as C40's acceptance
  test.**
- Not exercised for lack of fixtures or safety: paid and minor registration, `force-login`
  campaigns, a pledge with payments against it, password change, photo upload, household
  member writes, the directory map path, `inquire-full-groups`. Each per-widget log records
  the setup that would unblock it.

## Cleanup still owed — needs a Platform user

The MP REST API refuses these deletes (`table supports direct deletes only`, or 500).
Everything else created during the run was deleted, with teardown verified.

| Records | From |
|---|---|
| `Contacts` 942 ("AnonAgent, ZZTEST"), `Participants` 826 | anonymous event registration |
| `Contacts` 943–945 (renamed **`ZZTEST-DELETE-ME`**), `Participants` 827–829, `Households` 450, `Addresses` 499 | Plan Your Visit submissions |

Left in place **deliberately**: the `dp_Communications` / `dp_Communication_Messages` rows
from the pledge confirmation and cancellation — they are the evidence those emails fired.

## Number blocks (as allocated, so a re-run does not collide)

| Block | Owner | Used |
|---|---|---|
| C01–C09 | events | 9/9 |
| C10–C19 | groups | 10/10 |
| C20–C29 | serving & visit | 10/10 |
| C30–C39 | giving (read) | 10/10 |
| C40–C49 | payments | 10/10 |
| C50–C59 | people | 8/10 |
| C60–C79 | static config parity | 20/20 |
| C80–C89 | cross-cutting, filed at consolidation | 4 — C83 added 2026-09-09 during remediation |
| C90–C99 | harness | 0 — none found |

Five blocks filled completely, which means the run was **block-limited, not
finding-limited**. C82 exists because the serving agent ran out of numbers and recorded the
defect in its test log rather than dropping it; C80 and C81 because two and four agents
respectively found the same root cause independently. Treat a full block on a re-run as a
signal to widen it, not as a finding count.
