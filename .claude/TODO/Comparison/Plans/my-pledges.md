# `next-my-pledges` — plan

**Items:** C31 (functional) · C30 (functional, shared) · C39 (functional, shared) ·
C35 (ux, shared) · C36 (cosmetic, shared) · C79 (cosmetic, shared)
**Cutover verdict: C31 + C30 before cutover. C31 silently switches off a working feature.**
**Owns:** `packages/embed-sdk/src/components/my-pledges.ts`

## What the feedback says

**C31 is the item that matters and it is one line.**

```ts
// my-pledges.ts:37-39
return (this.getAttribute("hidecancelbuttonpledge") || "true").toLowerCase() !== "false";
```

Attribute absent → `"true"` → **no Cancel control at all**. Legacy's is the opposite:

```js
this.hideCancelButton = this.getAttribute("hidecancelbuttonpledge") || !1
```

Attribute absent → `false` → the Cancel Pledge control renders on every Active pledge. (The
vendor's own configurator metadata claims the default is `true`, contradicting its shipped
code. The code is what runs.)

So a church that pastes `<next-my-pledges></next-my-pledges>` — the exact shape of the
copy-paste snippet the SDK advertises — gets a **read-only pledge list**, where the legacy
widget gave donors self-service cancel. `demo-my-pledges.html` sets no attributes, so the
demo shows the feature switched off too, and it renders two Active pledges with
`[data-action="request-cancel"]` count **0**.

The capability ships fully working: set the attribute and the whole flow runs — cancel →
`Pledge_Status_ID` 3 → confirmation email queued and verified in `dp_Communications`.

**And C39 makes it worse in exactly the wrong place.** The one attribute a migrating pledge
site most needs to set is also one that **cannot be set from script after mount**, because
`attributeChangedCallback` guards on `oldValue !== null` (`:57-61`). Setting it on a live
element changed nothing; only replacing the element worked.

The rest: **C30** signed-out error panel, **C35** zero headings, **C36** `Jan 1, 2026` vs
legacy's `01/01/2026`, **C79** `hidecancelbuttonpledge` / `cancelpledgeemailtemplate` in flat
lowercase.

## Where the new widget is already better — protect these

This widget is one of the run's explicit "new is better" findings:

> **`next-my-pledges` ships a self-service cancel flow with a verified cancellation email;
> legacy has none.**

That matches the standing project memory (*my-pledges v1 ships full cancel flow + cancellation
email, not deferred*). The feature is real, tested against MP, and currently **switched off by
a default**. That is the whole plan in one sentence.

Also: pledge data and money formatting match legacy exactly (`$0.00 of $1,200.00 (0%)`).

## Phase 1 — C31, flip the default

```ts
return (this.getAttribute("hide-cancel-button-pledge") || "false").toLowerCase() === "true";
```

Hide only when explicitly told to, matching legacy. Every migrated site otherwise loses the
feature silently and the support burden lands on the church office — a donor who wants to stop
a pledge phones instead.

### The counter-argument, and why it does not win

Cancel is a destructive action, so making it opt-in is defensible. But:

- Legacy's omission switched it **on**, so migration is a silent regression for every existing
  customer.
- We ship a *better* version of the feature than legacy (with a confirmation email), and
  shipping it off by default means nobody sees it.
- A donor cancelling their own pledge is not a dangerous action; it is the whole point of a
  self-service pledge page.

**If the opt-in default is kept anyway**, then it must be visible: set
`hidecancelbuttonpledge="false"` in `demo-my-pledges.html` and in the customer snippet so the
flow is at least reachable and testable, and record the regression in the migration notes.
Right now the feature is invisible to a customer *and* to us.

### The companion question — settle it now

Legacy's metadata says *"If Hide Cancel Button = false, this value must be configured"* for
`cancelpledgeemailtemplate`. **Ours silently cancels with no email when it is unset.** A donor
who cancels a pledge and receives nothing has no record that it happened, and neither does the
church. Either require the template when cancel is enabled (refuse to render the control and
warn), or send from a sensible domain default. Do not leave the third option — cancel silently
— in place.

## Phase 2 — C39, so C31 can actually be configured

Per `CROSS-4`: drop the `oldValue !== null` half of the guard at `:57-61`. Without this, a host
that creates the element and *then* sets `hide-cancel-button-pledge="false"` — the natural
two-step shape for a CMS block — gets the read-only list forever, with no error. C31 and C39
should land in the same change; each halves the value of the other.

## Phase 3 — the shared items

- **C30** — signed-out panel → `CROSS-1`. Call sites `:69-90` and `:180-192`. Legacy's wording
  is *"Please login to view your pledges"*.
- **C35** — `<div class="title">` → `<h1>`, `.pledge-name` → `<h3>`, `.pledge-owner` → `<h4>`,
  plus `font: inherit; margin: 0`. **And give `.progress-track` a `role="progressbar"` with
  `aria-valuenow`/`valuemin`/`valuemax`** — the dollar figure is in adjacent text so the
  information is not lost, but the bar itself is invisible to assistive tech. See `CROSS-3` §3.
- **C36** — keep the long form; sweep for consistency in `CROSS-5`.
- **C79** — rename `hidecancelbuttonpledge` → `hide-cancel-button-pledge` and
  `cancelpledgeemailtemplate` → `cancel-pledge-email-template`, accepting the old spellings as
  warning aliases for one release. See `CROSS-4`.

Note the ordering trap: **do the C79 rename and the C31 default flip in the same change**, or
a host setting the old spelling gets the old default and a host setting the new spelling gets
the new one, which is the most confusing possible intermediate state.

## Do better than parity

- **A pledge page should show what happens next, not only what was promised.** Ours shows
  campaign, owner, total and progress. The donor's real questions are "when is my next
  installment" and "am I on track" — the data is there (`Installments_Planned`, first
  installment date, amounts) and neither system answers them.
- **Cancel deserves a real confirmation step, not a browser dialog.** The flow already works;
  since we are the only system that has it, we get to design it: what happens to installments
  already paid, whether the donor can restart, and what the email says. That is worth ten
  minutes of thought before the default is flipped on for every customer.
- **The progress bar is the widget's one visual and it is inert.** With `role="progressbar"`
  and a value label it becomes the fastest answer on the page.

## Acceptance

- `<next-my-pledges></next-my-pledges>` with no attributes renders a Cancel control on every
  Active pledge.
- `hide-cancel-button-pledge="true"` hides it; the legacy spelling still works and warns once.
- Setting either attribute on a mounted widget re-renders it.
- Cancelling sends a confirmation email, or the control refuses to render with a warning when
  no template is configured.
- Anonymous load renders a sign-in prompt.
- Headings and `role="progressbar"` are present.

## Depends on / unblocks

**C31 needs C39** to be configurable at all, and should ship with the C79 rename. C30 →
`CROSS-1`, C35 → `CROSS-3`, C36 → `CROSS-5`. Nothing depends on this file.
