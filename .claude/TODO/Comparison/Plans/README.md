# Remediation plans — 82 comparison findings, grouped into work

Written 2026-09-09 from the 82 `C`-numbered items in
[`../`](..) (see [`../README.md`](../README.md) for the findings themselves).

## The goal these plans serve

**Not 100% coherence with the legacy widgets — a great experience in the new ones.** The
comparison run is *feedback*, not a specification. Every plan therefore says, per item, one of:

- **fix as filed** — legacy was right and we regressed;
- **fix differently** — the finding is real, the suggested fix is not the best one;
- **do better than both** — the finding exposes something neither system does well;
- **keep ours / won't port** — ours is better, or the capability should not come across.

Every plan carries a **"Where the new widget is already better — protect these"** section, so a
parity-driven fix does not quietly undo an improvement. Those are not rhetorical: the run found
real ones (see *What the new widgets already do better*, below).

## Decisions taken 2026-09-09

| Question | Decision |
|---|---|
| The eleven missing legacy widgets | **Ranked roadmap, not eleven plans** → [`ROADMAP-missing-widgets.md`](ROADMAP-missing-widgets.md). **Tier 1 was then picked up and built (2026-09-09)**, so four of them now have a plan each, written at implementation time as the roadmap intended. |
| Labels (C67), theming (C68), locale (C73) | **All three committed as real workstreams** → [`CROSS-5`](CROSS-5-theming-labels-locale.md) |
| What `next-pay` is | **A sandbox stand-in for a vendor-hosted payment page.** Resolves C48; reshapes the token contract → [`checkout-pay.md`](checkout-pay.md) |
| Sequencing driver | **First real church cutover** — ordered by what blocks a pilot going live |

## How the files are organised

Five **cross-cutting** plans come first: they are shared causes with many symptoms, and fixing
them per-widget would mean writing the same fix eight or ten times. Each widget plan points at
them rather than restating them.

Then one plan **per widget**, except where the unit of work is genuinely a flow rather than a
widget: the three payment widgets share one blocking bug and one response payload, and the two
statement widgets exist as a pair precisely because C38 is about the split.

| File | Covers |
|---|---|
| [`CROSS-1-signed-out-and-auth-states.md`](CROSS-1-signed-out-and-auth-states.md) | C81 · C13 · C30 · C46 · C53 · C15 |
| [`CROSS-2-invoice-proc-parameter.md`](CROSS-2-invoice-proc-parameter.md) | C80 · C01 · C42 |
| [`CROSS-3-accessibility.md`](CROSS-3-accessibility.md) | C05 · C10 · C22 · C45 · C28 · C35 · C29 · C08 · C54 · C19 |
| [`CROSS-4-attribute-plumbing-and-naming.md`](CROSS-4-attribute-plumbing-and-naming.md) | C39 · C79 |
| [`CROSS-5-theming-labels-locale.md`](CROSS-5-theming-labels-locale.md) | C68 · C67 · C73 · C77 · C36 · the copy rows of C09/C18/C19/C37 |
| [`ROADMAP-missing-widgets.md`](ROADMAP-missing-widgets.md) | C52 · C69–C78 — **Tier 1 built; six gaps remain** |
| [`unsubscribe.md`](unsubscribe.md) | C72 — **built** (`next-unsubscribe`) |
| [`prayer-feedback.md`](prayer-feedback.md) | C69 — **built** (`next-prayer-feedback`) |
| [`subscribe-to-publication.md`](subscribe-to-publication.md) | C70 — **built** (`next-subscribe-to-publication`) |
| [`pre-check.md`](pre-check.md) | C78 — **built** (`next-pre-check`) |
| [`add-to-calendar.md`](add-to-calendar.md) | C06 |
| [`checkout-pay.md`](checkout-pay.md) | C40 · C41 · C42 · C43 · C47 · C48 · C49 · C66 |
| [`contribution-statements.md`](contribution-statements.md) | C34 · C38 · C62 (+ C30, C35) |
| [`custom-form.md`](custom-form.md) | C26 · C27 (+ C28, C29) |
| [`event-details.md`](event-details.md) | C01 · C07 |
| [`event-finder.md`](event-finder.md) | C04 · C09 (+ C05) |
| [`full-calendar.md`](full-calendar.md) | C02 · C03 (+ C08) |
| [`group-details.md`](group-details.md) | C11 · C12 · C14 · C16 · C17 · C19 |
| [`group-finder.md`](group-finder.md) | C15 · C18 · C64 (+ C10) |
| [`my-giving.md`](my-giving.md) | C33 · C37 (+ C30, C35, C36, C39, C79) |
| [`my-groups.md`](my-groups.md) | C13 · C39 · C79 |
| [`my-household.md`](my-household.md) | C57 (+ C53, C79) |
| [`my-invoices.md`](my-invoices.md) | C44 · C60 (+ C45, C46) |
| [`my-pledges.md`](my-pledges.md) | C31 (+ C30, C35, C36, C39, C79) |
| [`online-directory.md`](online-directory.md) | C50 |
| [`opportunity-details.md`](opportunity-details.md) | C21 · C65 (+ C28, C29) |
| [`opportunity-finder.md`](opportunity-finder.md) | C20 · C25 (+ C22) |
| [`plan-your-visit.md`](plan-your-visit.md) | C24 · C82 · C23 · C63 (+ C28) |
| [`pledge-campaign.md`](pledge-campaign.md) | C32 (+ C39) |
| [`profile.md`](profile.md) | C51 (+ C53, C55) |
| [`subscriptions.md`](subscriptions.md) | C55 · C61 (+ C53) |
| [`user-menu.md`](user-menu.md) | C56 (+ C54) |

All 82 items are accounted for.

---

## Sequenced for a first church cutover

### Stage 0 — the week that unblocks everything else

Small, mostly one-line, and each one turns a dead surface into a working one.

| Fix | Effect |
|---|---|
| **C24** delete `phonePattern()` | `next-plan-your-visit` goes from *completely unsubmittable* to working. One deletion. |
| **C40** drop `Invoices.Amount_Paid` from the select | Payments start being recorded at all. |
| **CROSS-2** drop `@MpLoggedInContactId` (2 lines, 2 services) | Signed-in checkout and signed-in registration start working. |
| **C51** stop `formatPhone` destroying input | Stops deleting members' phone numbers on a 200. |
| **C50** compute the image URL in JS | `next-online-directory` can run a search at all. |
| **C06** add the public-visibility predicate | Stops serving non-public event data to anonymous callers. |

### Stage 1 — the classes (cutover blockers)

- **CROSS-1** — signed-out is a state, not a failure. Ten widgets; one base-class helper.
  *The single most visible "the new widgets are broken" impression a pilot church will form.*
- **CROSS-3 class 1** — the `cardLink()` primitive. Four finders currently have no keyboard
  path from a result list to a detail page.
- **CROSS-4 (C39)** — late attribute sets are ignored. Blocks C31 and any CMS-rendered embed.
- **`checkout-pay.md` C41/C43** — stop telling a declined payer their money is on its way;
  close the double-charge vector before C40 makes it real.
- **`my-invoices.md` C44** — take Route A (link out). Fixes the dead `mpp-checkout` injection
  *and* most of C45.
- **`full-calendar.md` C02/C03** — stop showing an empty December and stop dropping retreats.
- **`group-details.md` C11/C12** — inquiries currently go nowhere and arrive anonymous.
- **`my-pledges.md` C31** — flip the cancel default (ship with C39 and the C79 rename).

### Stage 2 — what a migrating church visibly loses

`group-details` C14/C16 · `custom-form` C26/C27 · `opportunity-finder` C20/C25 ·
`opportunity-details` C21/C65 · `subscriptions` C55/C61 · `user-menu` C56 ·
`plan-your-visit` C23/C63 · `event-finder` C04 · `contribution-statements` C34/C38/C62 ·
`my-invoices` C60 · `group-finder` C64 · `pledge-campaign` C32 · `my-giving` C33/C37 ·
`checkout-pay` C49/C66

### Stage 3 — platform and polish

**CROSS-5** in its own order (tokens → `custom-css` → labels → locale → `next-user-label`),
the rest of **CROSS-3**, **CROSS-4 (C79)**, and the remaining cosmetics — which mostly stop
being open questions once labels land.

### Stage 4 — roadmap

~~[`ROADMAP-missing-widgets.md`](ROADMAP-missing-widgets.md), starting with the C72 question that
could be answered in an afternoon.~~

**Partly done, 2026-09-09.** The C72 question was answered (no — MP generates no unsubscribe
link, so the severity stood) and all four **Tier 1** widgets were built ahead of stages 1–3,
because they are the items that block a cutover outright rather than degrading one. Six gaps
remain; the roadmap's Tier 2–4 rankings are still open, with one caveat recorded there: every
estimate in that file was made without the legacy **server** source, which is on disk at
`S:\MP\mp-Widgets` and settled several questions the file treats as unknown.

---

## Three primitives that pay for themselves — **all three built, 2026-09-09**

Named across several plans. Building any of them for one widget without extracting it is how we
end up with four hand-rolled versions.

**They now exist, and the Tier 1 build is the proof they were worth extracting** — four widgets
consumed them and none hand-rolled one:

| Primitive | Where |
|---|---|
| `sendTemplateMessage` | `src/services/messageTemplateService.ts` — two named methods, one per MP template table |
| Sealed anonymous action tokens | `src/lib/embed/action-token.ts` (stateless) + `pending-action.ts` (single-use, payload in the store) |
| An anonymous-write route convention | `src/lib/embed/anonymous-write.ts` — `withAnonymousWrite` |

Two notes for whoever consumes them next. The **token primitive is two things, not one**,
because C69 needed a store-backed handle (a 2000-character payload signs into a 3KB URL) and
C72 needed a stateless one (an unsubscribe link must survive 180 days in a mail archive) — the
single-use one is built on the stateless one. And `withAnonymousWrite` means the *user* is
anonymous, **not the request**: a widget JWT is still required and the origin still
allowlisted.

The original descriptions follow, for the reasoning.

1. **`sendTemplateMessage(templateId, to, mergeData)`** on the MP provider — wanted by C11
   (group inquiries), C66 (payment receipts), C69 and C70 (roadmap).
   `planYourVisitService.ts` already implements it inline; extract that.
2. **Server-side back-fill of denormalised contact columns** — C12, C21 and C26 are the same
   defect in three services. Same shape, same security argument: never trust the client for a
   contact the user merely *selected*.
3. **Shared UI primitives in `packages/embed-sdk/src/shared/`** — `cardLink()`,
   `field()` in `form-validation.ts`, `dialogFocus()`, and `renderSignInRequired()` on
   `MPNextWidget`. Between them they close about fifteen items and stop the next widget
   reopening them.

## Four test gaps that let these classes survive

Worth adding with the fixes, not after. The run is explicit that **each class survived because
nothing checked**:

1. **A signed-out spec for every auth-only widget**, run in both `legacy` and `dual` modes.
   Ten widgets shipped a dead error panel because no test loaded them anonymously.
2. **A signed-in case on every invoice/participant path.** C80's whole character is that it is
   invisible anonymously — an anonymous-only test asserts the working half. Same shape as
   `.claude/TODO/37-*`.
3. **An accessibility probe over every demo page** — accessible names, no `role="link"` without
   an `href`, focus inside every `aria-modal` dialog, at least one heading per widget.
4. **Assertions on built query strings and on data the live dataset lacks** — C50's 2,305-char
   URL and C03's multi-day event are both invisible against today's MPI data.

Plus two guard tests in the spirit of `src/lib/no-template-concat.test.ts`: kebab-case
`observedAttributes` (`CROSS-4`), and a catch that returns an empty result must log
(`opportunity-finder.md` C20).

## What the new widgets already do better

Recorded so no plan quietly undoes it:

- **Privacy in the directory** is stricter than legacy — unlisted phone/address nulled
  server-side, no email address sent, no birth year. Legacy ships all of it to the browser and
  hides it client-side.
- **`next-my-pledges` has a self-service cancel flow with a verified cancellation email.**
  Legacy has none — and ours is currently switched off by a default (C31).
- **We read `Statement_Method_ID` correctly and legacy does not** — legacy shows "Go Paperless"
  as already on for a donor on Postal Mail.
- **Suggest-a-Group writes `Start_Date` in domain wall-clock; legacy writes UTC.**
- **Legacy's `Inquire` and `SignUp` both 500 after writing their row. Ours return 200.**
- **`next-user-menu`'s account modal** replaces legacy's link out to MP's OAuth profile page.
- **`next-subscriptions` saves per toggle**; legacy needs an Update button.
- **`next-add-to-calendar` is correct in every value checked** across five formats, including
  RFC 5545 75-octet line folding — with no CDN dependency at all.
- **`next-pledge-campaign` has a full heading outline**; four other widgets have none, and it
  is the pattern they should copy.
- **Read/data parity is exact wherever it was measurable** — event finder 34/34, all eleven
  group-finder filter combinations, opportunity attribute and result parity, money to the cent
  across five years, and no year-boundary drift on either side.

**The pattern in the findings is not that the data layer is wrong — it is almost entirely
right. It is that the shell around it regressed.** That is a much better problem to have, and
it is why most of this backlog is shared primitives rather than per-widget rewrites.
