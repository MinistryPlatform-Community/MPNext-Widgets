# 34. `CLAUDE.md` still describes a 5-widget repo that now ships 25

**Depends on:** nothing. (Do it after any in-flight branch that adds a widget,
so the counts are not stale again on merge.)
**Risk:** none in production — no code changes. But it is a **correctness risk
for every agent and new contributor**: `CLAUDE.md` is loaded as project
instructions on every session, and the parts that are wrong are the parts
people use to decide where code lives and what exists.
**Size:** ~45 minutes, mostly verification. It is a rewrite of four sections,
not a find-and-replace.

> Filed by the item-31 agent on 2026-09-07, from a drift the item-32 agent
> noticed while working on `full-calendar.ts`. **Pre-existing** and unrelated
> to either fix.

## Why

`CLAUDE.md` opens with:

> Contains **5 embed SDK widgets** (user-menu, add-to-calendar, full-calendar,
> profile, my-invoices)

and repeats the number in the Structure tree and again as a bolded list near
the end of "Widget Architecture". Measured on `dev` at 2026-09-07:

| Claim in `CLAUDE.md` | Actual |
|---|---|
| 5 widgets | **25** registered `next-*` custom elements |
| — | **25** `packages/embed-sdk/demo-*.html` demo pages |
| — | **30** files in `packages/embed-sdk/src/components/` (25 widgets + 5 `full-calendar-*` sub-modules: `cards`, `list`, `mini-cal`, `modal`, `styles`) |
| — | **14** of those define an `attributeChangedCallback` |
| "Widget API endpoints (subset for 5 widgets)" | **27** directories under `src/app/api/embed/` |
| 7 services listed | **~30** files in `src/services/` |

The full element list:
`next-add-to-calendar`, `next-checkout`, `next-checkout-complete`,
`next-custom-form`, `next-event-details`, `next-event-finder`,
`next-full-calendar`, `next-group-details`, `next-group-finder`,
`next-my-contribution-statement`, `next-my-giving`, `next-my-groups`,
`next-my-household`, `next-my-invoices`, `next-my-pledges`,
`next-online-directory`, `next-opportunity-details`,
`next-opportunity-finder`, `next-pay`, `next-plan-your-visit`,
`next-pledge-campaign`, `next-profile`, `next-statement-preferences`,
`next-subscriptions`, `next-user-menu`.

Concretely, an agent reading these instructions concludes that
`next-event-finder` and `next-checkout` do not exist in this repo, that
`src/services/` has seven entries, and that the `api/embed` tree is a
deliberately trimmed subset. All three are wrong, and each one sends work to
the wrong place.

## Affected sections of `CLAUDE.md`

1. **Overview** (line ~5) — "Contains 5 embed SDK widgets (user-menu,
   add-to-calendar, full-calendar, profile, my-invoices)".
2. **Structure** (the code fence, ~lines 9-23) — `app/api/embed/` is annotated
   "(subset for 5 widgets)"; `src/components/` is annotated "5 Web Components".
3. **Widget Architecture** — the bolded **"5 widgets"** line listing the five
   element names.
4. **Services (src/services/)** — the enumerated list of seven services
   (`addToCalendar`, `fullCalendar`, `profile`, `subscription`, `user`,
   `invoice`, `domainTimezone`).

Everything else in the file (auth, date/time, conventions, Key Files) was
re-checked while filing this and is **accurate**; do not churn it.

## Steps

1. Re-count at the time of the fix — the numbers above are a 2026-09-07
   snapshot and the repo is moving:
   - elements: `grep -rho "customElements.define(\"[a-z-]*" packages/embed-sdk/src | sort -u`
     (excluding `mpp-user-login`, which is MP's own element, not ours)
   - demo pages: `ls packages/embed-sdk/demo-*.html | wc -l`
   - api routes: `ls src/app/api/embed`
   - services: `ls src/services/*.ts | grep -v test`
2. Rewrite section 1 with the real count and **no exhaustive list** — a list of
   25 in the Overview is noise and goes stale on the next widget. Say what the
   catalogue is and point at `packages/embed-sdk/src/components/` and the demo
   pages as the source of truth.
3. Fix the two Structure annotations. Note the `full-calendar-*` sub-modules
   explicitly, since "30 files, 25 widgets" is otherwise confusing.
4. Replace the bolded "5 widgets" line. If a full list is wanted anywhere, put
   it here (one place), not in three.
5. Replace the enumerated service list with the pattern plus a pointer to the
   directory; the singleton convention is the useful part, not the roster.
6. Consider adding a one-line "these counts drift — verify before relying on
   them" note, or drop the counts entirely in favour of the commands in step 1.
   Prefer whichever a future reader is less likely to trust wrongly.

## Testing

- No code changes, so no test changes: `pnpm test:run` and `pnpm lint` should
  be untouched at their baselines.
- The real check is manual: re-run the step-1 commands and confirm every number
  and name in the rewritten sections matches the output.
- Grep the whole file for the literal `5 widgets`, `five widgets` and each of
  the five old element names to be sure no fourth copy was missed.

## Done when

`CLAUDE.md` no longer states or implies that this repo has five widgets, the
Structure tree and Services section describe what is actually on disk, and the
counts either match a fresh measurement or have been replaced by a pointer at
the source of truth.
