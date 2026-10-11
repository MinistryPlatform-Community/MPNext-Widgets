# Legacy → Next widget comparison (closed)

In September 2026 every legacy MinistryPlatform widget (`mpp-*`) was driven side by side
with its `next-*` counterpart against the same MP instance, and each difference was filed as
a `C`-numbered finding (81 in all). The comparison was **closed out by the
comparison-remediation epic on 2026-10-11** (PR #60 into `dev`). Closed findings, the
per-widget plans and the epic's workstream files were then **deleted**; they remain in git
history, e.g. `git log --all -- '.claude/TODO/Comparison/C01*'` or
`git log --all -- .claude/TODO/Comparison/Plans/`. Durable developer guidance from the epic
lives in `.claude/references/widget-building-blocks.md`. The table below keeps the
`C`-numbers cited in code comments and commit messages meaningful. The method and harness
are in `.claude/playwright/widget/` (`BRIEF.md`, `HARNESS.md`, `CONFIG-MAP.md`, `tests/*.md`).

`C`-numbers are a separate axis from the numbered items in `.claude/TODO/`; they do not
continue that sequence.

## Still open

| # | What | State |
|---|---|---|
| [C68](C68-no-custom-css-channel.md) | Theming channels beyond the `--nw-*` tokens: `part=`, a `custom-css` attribute, a domain stylesheet | partial |
| [C74](C74-no-smart-link-widget.md) | `mpp-smart-link` has no counterpart | deferred (auth-design decision) |
| [C75](C75-no-smart-frame-widget.md) | `mpp-smart-frame` has no counterpart | deferred (auth-design decision) |

Follow-ups the epic surfaced that are not C-findings are numbered items in
[`../README.md`](../README.md) (40 onward).

## Every finding, final state

Severity as filed: `breaking` = the flow cannot complete, or the data is wrong ·
`functional` = a legacy capability is missing · `ux` = works but behaves worse ·
`cosmetic` = labels, formats, styling. There is no C58 or C59.

| # | Sev | Finding | Outcome |
|---|---|---|---|
| C01 | breaking | event details participants 500 signed in | resolved |
| C02 | breaking | full calendar month nav no refetch | resolved |
| C03 | functional | full calendar drops boundary straddling events | resolved |
| C04 | functional | event finder no featured filter control | resolved |
| C05 | functional | event finder cards not keyboard activatable | resolved |
| C06 | functional | add to calendar serves non public events | resolved |
| C07 | ux | event details anonymous basic contact 401 churn | resolved |
| C08 | ux | full calendar modal no focus management | resolved |
| C09 | cosmetic | event finder card dates omit year | resolved |
| C10 | functional | group finder cards not keyboard operable | resolved |
| C11 | functional | group details sends no inquiry or signup email | resolved |
| C12 | functional | group inquiry row missing name email phone | resolved |
| C13 | functional | my groups signed out shows error not signin | resolved |
| C14 | functional | group details signup no blank form | resolved |
| C15 | ux | group finder anonymous suggest dead ends | resolved |
| C16 | ux | group details inquiry phone no longer required | resolved |
| C17 | cosmetic | group details greets user surname first | resolved |
| C18 | cosmetic | group finder copy and format drift | resolved |
| C19 | cosmetic | group details copy layout and tab semantics drift | resolved |
| C20 | functional | opportunity finder attributes filter missing | resolved |
| C21 | functional | opportunity response row missing contact fields | resolved |
| C22 | functional | opportunity card not keyboard activatable | resolved |
| C23 | functional | plan your visit no address autocomplete | resolved |
| C24 | breaking | plan your visit phone mask blocks submit | resolved |
| C25 | functional | opportunity one time date shown as weekday plural | resolved |
| C26 | functional | custom form no complete form as picker | resolved |
| C27 | functional | custom form address has no country | won't port |
| C28 | ux | visit and form inputs have no accessible name | resolved |
| C29 | ux | phone inputs are text not tel | resolved |
| C30 | functional | giving widgets signed out error instead of sign in | resolved |
| C31 | functional | my pledges cancel button default inverted | resolved |
| C32 | functional | pledge campaign accepts zero and absurd amounts | resolved |
| C33 | ux | my giving by month chart has no values | resolved |
| C34 | ux | statement save as pdf opens tab instead of downloading | resolved |
| C35 | ux | giving widgets emit no headings | resolved |
| C36 | cosmetic | giving date format differs from legacy | resolved |
| C37 | cosmetic | my giving soft credit copy and month labels | resolved |
| C38 | ux | paperless toggle split into separate element | resolved |
| C39 | functional | attribute changed callback ignores first set | resolved |
| C40 | breaking | payments never recorded amount paid column | resolved |
| C41 | breaking | declined payment reported as processing | resolved |
| C42 | breaking | checkout 500s for every signed in user | resolved |
| C43 | functional | payment request token unlimited use | resolved (vendor follow-up: TODO 42) |
| C44 | breaking | my invoices pay now injects legacy mpp checkout | resolved |
| C45 | functional | my invoices list not keyboard reachable | resolved |
| C46 | functional | my invoices anonymous shows error not sign in | resolved |
| C47 | cosmetic | zero total invoice labelled paid in full | resolved |
| C48 | functional | pay collects and validates far less than legacy | resolved (vendor follow-up: TODO 43) |
| C49 | functional | make changes link loses event and invoice ids | resolved |
| C50 | breaking | online directory search query too long | resolved |
| C51 | breaking | profile non numeric phone silently wipes number | resolved |
| C52 | functional | about me contact attributes no counterpart | resolved |
| C53 | ux | auth required states have no sign in button | resolved |
| C54 | ux | user menu no focus return on close | resolved |
| C55 | functional | subscriptions no bulk email opt out | resolved |
| C56 | functional | user menu drops child markup no custom links | resolved |
| C57 | cosmetic | my household member birthdays lose the year | keep ours |
| C60 | functional | my invoices no configuration attributes | resolved |
| C61 | functional | subscriptions no congregation filter | resolved |
| C62 | functional | my contribution statement no my giving link | resolved |
| C63 | functional | plan your visit user notification template | resolved |
| C64 | functional | group finder city postal code not presettable | resolved |
| C65 | functional | opportunity details no show full address | resolved |
| C66 | functional | checkout no receipt template id | resolved |
| C67 | functional | no mp configurable labels | resolved |
| C68 | functional | [no custom css channel](C68-no-custom-css-channel.md) | partial |
| C69 | functional | no prayer feedback widget | resolved |
| C70 | functional | no subscribe to publication widget | resolved |
| C71 | functional | no rss reader widget | won't port |
| C72 | functional | no one click unsubscribe widget | resolved |
| C73 | functional | no locale selector no localisation | resolved |
| C74 | functional | [no smart link widget](C74-no-smart-link-widget.md) | deferred |
| C75 | functional | [no smart frame widget](C75-no-smart-frame-widget.md) | deferred |
| C76 | functional | no mission trip widgets | resolved |
| C77 | ux | no user label widget | won't do |
| C78 | functional | no pre check widget | resolved |
| C79 | cosmetic | inconsistent attribute naming | resolved |
| C80 | breaking | mploggedincontactid param breaks signed in invoice reads | resolved |
| C81 | functional | auth only widgets show dead error instead of sign in | resolved |
| C82 | functional | plan your visit syncchildren discards child fields | resolved |
| C83 | functional | plan your visit writes nonexistent contacts status column | resolved |

## Cross-cutting plan labels

Code comments cite these plan names; the plans themselves are deleted.

| Label | Theme |
|---|---|
| CROSS-1 | Signed-out and auth-required states (C13, C30, C46, C53, C81) |
| CROSS-2 | The invoice procedure parameter (C80, C01, C42) |
| CROSS-3 | Accessibility: real links for cards, labelled controls, dialog focus, headings |
| CROSS-4 | Attribute plumbing and naming (C39, C79) |
| CROSS-5 | Theming, labels and locale (C67, C68, C73, C77) |
