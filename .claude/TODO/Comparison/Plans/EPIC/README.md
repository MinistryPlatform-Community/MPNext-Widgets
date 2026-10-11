# EPIC — Comparison remediation (`epic/comparison-remediation`)

Written 2026-10-11. This epic closes every open `C`-numbered finding in
[`../../`](../../), fanned out across parallel subagents working in git worktrees.

**Branch model (decided 2026-10-11):** the epic branch `epic/comparison-remediation` is cut
from `dev`. Each workstream runs on its own branch in its own worktree, cut from the epic's
head at the start of its wave. When the workstream's gates pass, it is **merged into the
epic locally**, with no PR per theme. A single `epic/comparison-remediation → dev` PR opens
when every wave has landed.

The per-widget plans in [`../`](../) are still the design source for *what* to build. These
files add three things they lack:
- the **current status** of each item, re-verified against the code on 2026-10-11 (the
  per-widget plans are dated 2026-09-09 and predate i18n, Tier 1 and Tier 2);
- **which files each workstream owns**, so parallel worktrees don't collide;
- the **merge protocol**.

Where a per-widget plan and these files disagree, these files win. Each conflict is listed
under *Stale-plan corrections* in the workstream file.

## Item ledger: all 81 findings

| State | Items |
|---|---|
| **Already resolved** (before this epic) | C52 · C67 · C69 · C70 · C71 (won't port) · C72 · C73 · C76 · C78 · C83 |
| **Fixed in passing, close in W0** | **C36**. i18n moved `my-giving`/`my-pledges` dates onto `this.fmt.date(…, "medium")`. The only `"en-US"` left in the SDK is `calendar-links.ts:100`, which is deliberate. |
| **Won't do (decided 2026-10-11)** | **C77** `next-user-label`. It was designed for an MP labels endpoint that was rejected. Today the host page can write the word itself, and `MPNextEmbed.setMessages` renames labels across widgets. Close it under C77's own fallback clause. |
| **Deferred out of this epic (decided 2026-10-11)** | **C74** `next-smart-link` · **C75** `next-smart-frame`. Both still need the Tier 3 auth-design decision (user PII merged into a URL handed to a third party). They stay open in the roadmap. |
| **Open → this epic** | the remaining 66, assigned below |

## Waves and workstreams

```
Wave 0  ─ W0 Foundation (1 agent, sequential)  ─────────────►  merge → epic
                                                                    │
Wave 1  ─┬ W1 Payments & invoices ─┐                               │ cut from epic
         ├ W2 Events & calendar    │                                ▼
         ├ W3 Groups               ├─ 6 agents in parallel worktrees ─► merge each → epic
         ├ W4 Serving, visit, forms│   (merge order: W1 W2 W3 W4 W5 W6)
         ├ W5 Giving               │
         └ W6 People & account    ─┘
                                                                    │
Wave 2  ─┬ W7a Theming tokens: contract (1 agent) ─► merge → W7b fan-out (6 agents, by family)
         └ W8 QA guards & e2e (1 agent, parallel with W7) ─────► merge → epic
                                                                    │
Close   ─ W9 Docs & ledger closeout (me) ─► epic → dev PR
```

| WS | File | Items | Size |
|---|---|---|---|
| **W0** | [W0-foundation.md](W0-foundation.md) | C81 (helper) · C39 (convention) · C79 (guard + rule) · C68 (`injectStyles` push) · C28/C29 (`field()` primitive) · C05/C10/C22 (`cardLink()`) · C08/C54 (`dialogFocus()`) · close C36 / C77 | M — shared primitives only |
| **W1** | [W1-payments-invoices.md](W1-payments-invoices.md) | C80 · C01 · C42 · C40 · C41 · C43 · C47 · C48 · C49 · C66 · C44 · C45 · C46 · C60 | **L**: the cutover-critical one |
| **W2** | [W2-events-calendar.md](W2-events-calendar.md) | C02 · C03 · C04 · C05 · C06 · C07 · C08 · C09 | M |
| **W3** | [W3-groups.md](W3-groups.md) | C10 · C11 · C12 · C13 · C14 · C15 · C16 · C17 · C18 · C19 · C64 | M–L |
| **W4** | [W4-serving-visit-forms.md](W4-serving-visit-forms.md) | C20 · C21 · C22 · C23 · C24 · C25 · C26 · C27 · C28 · C29 · C63 · C65 · C82 | L |
| **W5** | [W5-giving.md](W5-giving.md) | C30 · C31 · C32 · C33 · C34 · C35 · C37 · C38 · C62 | M |
| **W6** | [W6-people-account.md](W6-people-account.md) | C50 · C51 · C53 · C54 · C55 · C56 · C57 · C61 | M |
| **W7** | [W7-theming-tokens.md](W7-theming-tokens.md) | C68 (tokens; `part=` / `custom-css` / domain sheet are **out of scope**, decided 2026-10-11) | M, mechanical |
| **W8** | [W8-qa-guards.md](W8-qa-guards.md) | The four test gaps from `Plans/README.md`, plus two guard tests | M |

Each per-widget slice of C39 (reconfigure), C79 (kebab rename) and C81 (adopt the sign-in
helper) belongs to the workstream that owns that widget. W0 only builds the primitive and
the guard.

### Why this partition

- **Each wave-1 theme owns its components, services and routes exclusively.** The table in
  *File ownership* is the contract. Its one deliberate cross-theme reach is
  `src/services/eventDetailsService.ts`, owned by **W1**, because C01 is the C80 line. W2
  touches only `event-details.ts` (the component), not the service.
- **Everything shared is built once, in W0, before the fan-out.** That covers
  `base-widget.ts`, `form-validation.ts`, and new `shared/*` helpers. Without that,
  `cardLink()` would be written four times, `field()` three times and the sign-in panel
  ten times. **Wave-1 agents must not edit `packages/embed-sdk/src/shared/**`.** If a
  primitive is wrong, the agent stops and reports it; it does not fork its own copy.
- **Theming runs last** because it rewrites the CSS of all 33 components. Running it
  alongside wave 1 would conflict with every theme.

## File ownership (wave 1)

| Path | Owner |
|---|---|
| `packages/embed-sdk/src/shared/**`, `i18n/*.ts` (not `locales/`), `src/lib/embed/**` | **W0 only**. Read-only in wave 1. |
| `checkout*.ts`, `pay.ts`, `my-invoices.ts` · `paymentService`, `checkoutService`, `invoiceService`, **`eventDetailsService`** · `api/embed/{checkout,pay,payment,invoices}/**`, `api/embed/event-details/participants/**` · `packages/types/src/payment-token.ts` | **W1** |
| `full-calendar*.ts`, `event-finder.ts`, `event-details.ts`, `add-to-calendar.ts` · `fullCalendarService`, `addToCalendarService`, `eventFinderService` · `api/embed/{full-calendar,add-to-calendar,event-finder}/**` | **W2** |
| `group-finder.ts`, `group-details.ts`, `my-groups.ts` · `groupsService` (and any `groupFinder*`) · `api/embed/{group-*,my-groups}/**` · `packages/types/src/group*.ts` | **W3** |
| `opportunity-*.ts`, `plan-your-visit.ts`, `custom-form.ts` · `opportunity*Service`, `planYourVisitService`, `customFormService` · `api/embed/{opportunity-*,plan-your-visit,custom-form}/**` · matching types | **W4** |
| `my-giving.ts`, `my-pledges.ts`, `my-contribution-statement.ts`, `statement-preferences.ts`, `pledge-campaign.ts`, `my-mission-trips.ts` (sign-in adoption only) · giving/pledge/statement services + routes + types | **W5** |
| `online-directory.ts`, `profile.ts`, `my-household.ts`, `subscriptions.ts`, `user-menu.ts`, `contact-attributes.ts` (sign-in adoption only) · `onlineDirectoryService`, `profileService`, `householdService`, `subscriptionService` · `src/lib/providers/ministry-platform/utils/http-client.ts` (C50) · matching routes + types | **W6** |

**Shared-by-convention files (expect textual conflicts; resolve them mechanically):**
- `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/*.ts`: add keys **only inside your
  own namespace object**, and append new keys at the end of that object. Note that
  `giving.ts` holds the checkout/pay/subscriptions namespaces too, and `groups.ts` holds
  opportunity-finder/opportunity-details. Before you add a key, check which namespace
  object you are in.
- `packages/embed-sdk/i18n-sources/{es,pt-BR}.json`: **never hand-resolve.** On conflict,
  take the epic's side, then run `pnpm i18n:sync` on the merged tree.
- Demo pages `packages/embed-sdk/demo-*.html`: each belongs to the owner of its widget.

## Rules every workstream agent follows

1. **Read `CLAUDE.md` first.** The repo-wide rules most often broken here:
   - every user-visible string goes through `this.t()` (the i18n ratchet `BUDGET` is
     empty, so any English literal fails the run) and goes into **en, es and pt-BR**;
   - no `+` between template literals;
   - `sqlLiteral` comes from `services/_shared/mp-lookup.ts`;
   - MP datetimes go through `DomainTimezoneService`;
   - API errors are `{ error: <snake_case_code>, message }`, with a catalogue entry for
     every code (`error-codes.test.ts`).
2. **Verify every MP column or procedure against the schema before writing to it.** Use the
   MinistryPlatform MCP `mp_lookup`/`mp_schema`, or the models under
   `src/lib/providers/ministry-platform/models/`. C40, C20 and C83 were all phantom columns.
3. **One commit per C-item where practical**, with a message such as
   `fix(checkout): record payments without the phantom Amount_Paid column (C40)`.
   Unrelated items go in separate commits.
4. **Append a `## Resolution — <date>` section to each C-file you close.** State what was
   done, what was decided, and anything deliberately left open. Do **not** edit
   `Comparison/README.md` or `Plans/README.md`; W9 owns those indexes, so they don't
   conflict six ways.
5. **Gates before reporting done**, all run in the worktree:
   `pnpm test:run` · `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm i18n:check` ·
   `pnpm build:sdk`. Report the output. Where it is cheap, add a unit test that would have
   caught the defect.
6. **Do not** push, open PRs, bump dependencies, or edit files owned by another workstream.
   If a fix truly needs a foreign file, finish everything else and report the exact change
   needed; the integrator applies it.
7. **No live MP writes without teardown.** Most fixes are verifiable by unit test plus
   schema check. Where a live write is the only proof (C40, C12/C21), create, assert and
   delete, and record any record the API refuses to delete in the C-file. The
   *Cleanup still owed* table in `Comparison/README.md` is the precedent.

## Merge protocol (integrator: the main session)

1. Wave 0 lands on the epic. Then `git worktree`s for wave 1 are cut from the **same** epic
   commit.
2. Merge wave-1 branches in the order **W1 → W2 → W3 → W4 → W5 → W6** with `--no-ff`.
   Payments merges first because it is the cutover blocker and touches the most types.
3. After **each** merge, run the full gate on the epic. On an i18n-sources conflict, follow
   the rule above. On a locale `.ts` conflict, keep both sides' keys.
4. Wave 2 is cut from the epic after all six wave-1 merges.
5. Close-out: W9 updates the indexes and the item ledger, re-measures the CLAUDE.md
   roster, and opens one PR to `dev`.

## W9: Close-out (integrator)

- Update `Comparison/README.md` and `Plans/README.md`:
  - mark each item resolved, with a link to its resolution;
  - move C74/C75 to "deferred";
  - move C77 to "won't do";
  - list the C68 channels still open (`part=`, `custom-css`, the domain stylesheet).
- Re-measure the CLAUDE.md roster and counts using the Overview commands. Add the new
  conventions: `renderSignInRequired`, `cardLink`, `field`, `dialogFocus`, `reconfigure`,
  `readAttr`, `--nw-*` tokens, and kebab-case attributes.
- Migration-notes lines:
  - C71: no RSS reader;
  - C57: birthdays show without the year;
  - C27: no Country, if the decision is won't port;
  - the renamed attributes and their one-release aliases.
- Run the full gate plus `pnpm test:e2e:widget`.
- Open the single PR `epic/comparison-remediation → dev`.

## Agent brief template (used for every worktree agent)

> You are workstream **Wn** of the comparison-remediation epic, working in your own git
> worktree on branch `ws/wn-<slug>`, which was cut from `epic/comparison-remediation`.
>
> 1. Read `CLAUDE.md`, `.claude/TODO/Comparison/Plans/EPIC/README.md`, your file
>    `Plans/EPIC/Wn-*.md`, and **W0's "How to consume" section**.
> 2. Read the C-files and design-source plans your file names.
> 3. Work the items in the listed order, one commit per item.
> 4. Stay inside your ownership table.
> 5. Append resolution sections to the C-files you close.
> 6. Run every gate.
>
> When you finish, report:
> - the commits;
> - the gate output;
> - each item's final state (fixed, won't port with the reason, or blocked with the reason);
> - any change needed in a file you do not own.
>
> Do not push, do not open PRs, and do not edit files you do not own.

## Decisions taken for this epic

| Question | Decision |
|---|---|
| Branching | Epic off `dev`; worktree branches merged into it locally; one PR epic→dev (2026-10-11) |
| C74 / C75 | **Deferred**; not in this epic (2026-10-11) |
| C77 | **Won't do** (2026-10-11) |
| C68 scope | **Fix `injectStyles` + `--nw-*` tokens only.** `part=`, `custom-css` and a domain stylesheet stay open, recorded in C68 (2026-10-11) |
| C36 | Closed as fixed by i18n |
| C57 | **Proposed: keep ours** (month and day only). The code comment at `my-household.ts:352` records it as deliberate ("celebrates a birthday, not an age"), and `my-household.md` recommends the same. W6 records the resolution; reopen only on instruction. |
| C27 Country | `Form_Responses` has **no country column**, so the plan's "persist in the submit route" is impossible. **Proposed:** add Country only if MP's custom-form address block writes back to `Addresses` (W4 checks). Otherwise record it as won't port. |
| C02 cards scope | Follow `full-calendar.md`: add a `cards-scope="month|rolling"` attribute, default `month` |
| C06 private events | Strict public-only predicate now. The staff relaxation waits until someone asks for it. |
| C48 | The product half is settled (`next-pay` is a sandbox stand-in). Do the format validation now. Where payor/billing data comes from stays a vendor-integration question. |
