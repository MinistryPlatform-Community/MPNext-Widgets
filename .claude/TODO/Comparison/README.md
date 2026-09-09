# Legacy → Next widget comparison findings

**80 items, filed 2026-09-08.** Every legacy MinistryPlatform widget at
`mpi.ministryplatform.com/widgets` driven side by side with its `next-*` counterpart in
this repo, both pointed at the **same MP instance**, so every data difference recorded
here is a real difference and not two datasets. All 25 `next-*` elements were exercised
signed out and signed in; money, dates and written rows were cross-checked against MP
directly via the client-credentials API rather than read off the screen.

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

## Start here — the four cross-cutting items

Fix these before the per-widget items they explain; each is one cause with many symptoms.

| # | Sev | What |
|---|---|---|
| [C80](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md) | breaking | `@MpLoggedInContactId` is passed to a proc that has no such parameter, so **every signed-in `api_MPPW_GetInvoice` read 500s**. Two call sites, two widgets (C01, C42). Works anonymously, which is why it hid. |
| [C81](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md) | functional | **Nine+ auth-only widgets show a dead error with a useless "Try Again" instead of a sign-in prompt** (C13, C30, C46, C53). `requestLogin()` already exists in `base-widget.ts` and nine other components use it. |
| [C67](C67-no-mp-configurable-labels.md) | functional | **RESOLVED 2026-09-09** (with C73). Widget copy now comes from a TypeScript catalogue in this repo — `en`/`es`/`pt-BR` — plus `MPNextEmbed.setMessages()` for church label renames. Deliberately **not** a `GetLabels` equivalent; no church copy is read from MP. MP-authored *content* is still untranslated and cannot be by this approach — read the file before reopening. |
| [C68](C68-no-custom-css-channel.md) | functional | **No widget can be restyled at all** — no `customCss`, no domain stylesheet channel, no theming tokens, no `part=`, and `injectStyles()` *assigns* `adoptedStyleSheets`. Shadow DOM leaves the host page no workaround. All 36 legacy widgets support both channels. |

## breaking (10)

| # | Widget | What |
|---|---|---|
| [C40](C40-payments-never-recorded-amount-paid-column.md) | checkout / pay | **No payment is ever recorded.** `paymentService` selects `Invoices.Amount_Paid`, a column MP does not have; MP 500s, a bare `catch` swallows it, HTTP 200 throughout. Schema-confirmed — reproduces on every domain. |
| [C24](C24-plan-your-visit-phone-mask-blocks-submit.md) | plan-your-visit | **The flow can never complete.** MP's *display* mask `xxx-xxx-xxxx` is used as an HTML `pattern`, so the required phone field rejects every real number. |
| [C50](C50-online-directory-search-query-too-long.md) | online-directory | **No search can run.** The MP query string is 2,100–2,335 chars against IIS's 2048 limit; a full absolute URL is inlined into the `$select`. Scales with base-URL length, so a shorter host masks it. |
| [C51](C51-profile-non-numeric-phone-silently-wipes-number.md) | profile | **Silently deletes a stored phone number** when non-numeric text is typed — destroyed in the input handler, before validation can object. Verified against MP: a real number → `null` on a 200. |
| [C80](C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md) | event-details + checkout | The shared root cause of the next two. |
| [C42](C42-checkout-500s-for-every-signed-in-user.md) | checkout | 500s with a raw MP error **for every signed-in user**. Anonymous checkout works. |
| [C01](C01-event-details-participants-500-signed-in.md) | event-details | 500s on a signed-in user's participant list. |
| [C44](C44-my-invoices-pay-now-injects-legacy-mpp-checkout.md) | my-invoices | "Pay Now" injects the **legacy** `<mpp-checkout>` tag with a numeric id where a GUID is required — paying an invoice is a dead end. |
| [C41](C41-declined-payment-reported-as-processing.md) | checkout | Tells the payer a **declined** payment is "being processed". `checkout-complete.ts` gets this right; `checkout.ts` only branches on `paymentReceived`. |
| [C02](C02-full-calendar-month-nav-no-refetch.md) | full-calendar | Fetches one fixed 3-month window and **never refetches on month navigation** — paging outside it shows stale or empty data. |

## functional (48)

**Data written wrong or lost**
[C12](C12-group-inquiry-row-missing-name-email-phone.md) group inquiries store NULL name/email/phone for household members ·
[C21](C21-opportunity-response-row-missing-contact-fields.md) the same defect in opportunity responses ·
[C82](C82-plan-your-visit-syncchildren-discards-child-fields.md) adding a child wipes every typed child field ·
[C32](C32-pledge-campaign-accepts-zero-and-absurd-amounts.md) a $0.00 (and a $15,999,999,999,984.00) pledge saves as success ·
[C43](C43-payment-request-token-unlimited-use.md) payment token is unlimited-use for 15 min — resubmit mints a second payment; no overpay guard ·
[C11](C11-group-details-sends-no-inquiry-or-signup-email.md) no inquiry / sign-up / leader emails sent at all ·
[C06](C06-add-to-calendar-serves-non-public-events.md) non-public and cancelled events served to an anonymous token ·
[C03](C03-full-calendar-drops-boundary-straddling-events.md) calendar range filters by containment, not overlap ·
[C39](C39-attribute-changed-callback-ignores-first-set.md) configuring a mounted widget from script is a no-op (3 components)

**Keyboard-unreachable primary action** — all four announce `role="link"` but have no anchor and no Enter/Space handler, where legacy used a real `<a href>`
[C05](C05-event-finder-cards-not-keyboard-activatable.md) ·
[C10](C10-group-finder-cards-not-keyboard-operable.md) ·
[C22](C22-opportunity-card-not-keyboard-activatable.md) ·
[C45](C45-my-invoices-list-not-keyboard-reachable.md)

**A capability the legacy widget had**
[C20](C20-opportunity-finder-attributes-filter-missing.md) Attributes filter absent — the config query names a nonexistent column, 500s, swallowed ·
[C26](C26-custom-form-no-complete-form-as-picker.md) no "Complete Form As" household picker, so a parent cannot complete a form for a child ·
[C14](C14-group-details-signup-no-blank-form.md) can only sign up a household member ·
[C23](C23-plan-your-visit-no-address-autocomplete.md) no address autocomplete, though the helper and MP key channel already exist here ·
[C48](C48-pay-collects-and-validates-far-less-than-legacy.md) no payor/billing fields, no ACH option, required-only validation ·
[C55](C55-subscriptions-no-bulk-email-opt-out.md) bulk-email opt-out gone from subscriptions ·
[C56](C56-user-menu-drops-child-markup-no-custom-links.md) custom menu links silently dropped when signed in ·
[C27](C27-custom-form-address-has-no-country.md) no Country field ·
[C04](C04-event-finder-no-featured-filter-control.md) no Featured filter control ·
[C25](C25-opportunity-one-time-date-shown-as-weekday-plural.md) a one-time opportunity shows as "Fridays" with its date dropped ·
[C31](C31-my-pledges-cancel-button-default-inverted.md) cancel hidden by default where legacy shows it ·
[C49](C49-make-changes-link-loses-event-and-invoice-ids.md) "Make Changes" loses the ids legacy resolves in

**Configuration attributes with no equivalent** — static, from each legacy bundle's `observedAttributes`
[C60](C60-my-invoices-no-configuration-attributes.md) my-invoices accepts *none* of six ·
[C61](C61-subscriptions-no-congregation-filter.md) ·
[C62](C62-my-contribution-statement-no-my-giving-link.md) ·
[C63](C63-plan-your-visit-user-notification-template.md) ·
[C64](C64-group-finder-city-postal-code-not-presettable.md) ·
[C65](C65-opportunity-details-no-show-full-address.md) ·
[C66](C66-checkout-no-receipt-template-id.md) no receipt template — "receipt" appears nowhere in the repo

**Legacy widgets with no counterpart at all** — 11 of 36 legacy tags
[C72](C72-no-one-click-unsubscribe-widget.md) **one-click unsubscribe — an unsubscribe link in a sent email has nowhere to land** ·
[C70](C70-no-subscribe-to-publication-widget.md) anonymous email-verified opt-in ·
[C76](C76-no-mission-trip-widgets.md) the whole mission-trip domain, three tags ·
[C78](C78-no-pre-check-widget.md) event pre-check / check-in QR ·
[C69](C69-no-prayer-feedback-widget.md) prayer & feedback ·
[C71](C71-no-rss-reader-widget.md) publication feed ·
[C73](C73-no-locale-selector-no-localisation.md) **RESOLVED 2026-09-09** — `next-locale-selector` ·
[C74](C74-no-smart-link-widget.md) (what `giving.aspx` actually is) ·
[C75](C75-no-smart-frame-widget.md) ·
[C52](C52-about-me-contact-attributes-no-counterpart.md) self-service contact attributes ·
[C77](C77-no-user-label-widget.md) (filed `ux`)

**Signed-out handling** — see C81
[C13](C13-my-groups-signed-out-shows-error-not-signin.md) ·
[C30](C30-giving-widgets-signed-out-error-instead-of-sign-in.md) ·
[C46](C46-my-invoices-anonymous-shows-error-not-sign-in.md) ·
plus [C67](C67-no-mp-configurable-labels.md), [C68](C68-no-custom-css-channel.md), [C81](C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md)

## ux (13)

[C15](C15-group-finder-anonymous-suggest-dead-ends.md) full form then a 401 dead end ·
[C53](C53-auth-required-states-have-no-sign-in-button.md) (see C81) ·
[C28](C28-visit-and-form-inputs-have-no-accessible-name.md) 13 of 14 and 20 of 27 fields have no accessible name ·
[C35](C35-giving-widgets-emit-no-headings.md) four widgets emit no headings at all ·
[C08](C08-full-calendar-modal-no-focus-management.md) `aria-modal` that traps nothing ·
[C54](C54-user-menu-no-focus-return-on-close.md) focus not returned to the trigger ·
[C29](C29-phone-inputs-are-text-not-tel.md) no numeric keypad on mobile ·
[C33](C33-my-giving-by-month-chart-has-no-values.md) chart has no values or tooltip ·
[C34](C34-statement-save-as-pdf-opens-tab-instead-of-downloading.md) "Save as PDF" opens a popup ·
[C38](C38-paperless-toggle-split-into-separate-element.md) Go Paperless moved out of the statement widget ·
[C16](C16-group-details-inquiry-phone-no-longer-required.md) leaders lose the callback number ·
[C07](C07-event-details-anonymous-basic-contact-401-churn.md) pointless token refresh + second 401 ·
[C77](C77-no-user-label-widget.md)

## cosmetic (9)

[C09](C09-event-finder-card-dates-omit-year.md) ·
[C17](C17-group-details-greets-user-surname-first.md) "Thanks, Kehayias Chris!" ·
[C18](C18-group-finder-copy-and-format-drift.md) ·
[C19](C19-group-details-copy-layout-and-tab-semantics-drift.md) ·
[C36](C36-giving-date-format-differs-from-legacy.md) ·
[C37](C37-my-giving-soft-credit-copy-and-month-labels.md) ·
[C47](C47-zero-total-invoice-labelled-paid-in-full.md) ·
[C57](C57-my-household-member-birthdays-lose-the-year.md) ·
[C79](C79-inconsistent-attribute-naming.md)

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
| C80–C89 | cross-cutting, filed at consolidation | 3 |
| C90–C99 | harness | 0 — none found |

Five blocks filled completely, which means the run was **block-limited, not
finding-limited**. C82 exists because the serving agent ran out of numbers and recorded the
defect in its test log rather than dropping it; C80 and C81 because two and four agents
respectively found the same root cause independently. Treat a full block on a re-run as a
signal to widen it, not as a finding count.
