# W0 — Foundation: shared primitives (wave 0, runs alone)

**Branch:** `ws/w0-foundation` (worktree, cut from `epic/comparison-remediation`)
**Owns:** `packages/embed-sdk/src/shared/**`, `packages/embed-sdk/src/i18n/locales/*/core.ts`
(the `common.*` / `errors.*` / `validation.*` keys only), new guard tests, `CLAUDE.md` (Code
Conventions section only), and the C36 / C77 resolution sections.
**Does not touch:** any `components/*.ts` except to prove a primitive in **one** reference
consumer, named per primitive below. Converting the other widgets is wave 1's job.

The point of W0 is that seven wave-1 agents consume these primitives without each inventing
its own. Keep each one small, documented with a short JSDoc header, and unit-tested in jsdom.

## 1. Signed-out state: `renderSignInRequired()` (C81 core; CROSS-1 Phase 1)

Status 2026-10-11: still open. `base-widget.ts` has no needs-auth state. `fetch()` retries
once on a 401 (`:165-177`). `requestLogin()` (`:426-438`) does nothing visible in `legacy`
mode. There are about 14 hand-rolled signed-out panels, including
`my-mission-trips.ts:267/284-288`, `contact-attributes.ts:245/308-312` and
`online-directory.ts:140,267,396`. Use those three as the reference behaviour.

Build on `MPNextWidget`:
- `isNeedsAuth(res | payload)`. True on a `401` while the current token is public
  (`sub === "public"`) or `authSession.isAuthenticated()` is false. **Never infer from
  message text.**
- `renderSignInRequired({ message?, subject? }): string` plus a binder for
  `[data-action="login"]` → `requestLogin(subject)`. **Mode-aware**:
  - `dual` / `hardened` → a real Sign In button.
  - `legacy` → instructional copy and **no button**. The cancelable `loginRequired` event
    still fires, so a host page can intercept it.
  - Get the mode from `AuthSession`. Do not add a second `/auth/config` fetch.
- Catalogue keys in `core.ts`, all three locales. Reuse `common.signIn`,
  `common.signInPrompt`, `errors.authRequired`. Add a legacy-mode sentence
  (`common.signInViaPage`) and nothing else.
- **No "Try Again" in this state.** Retry is for 5xx and network faults only.
- **Reference consumer:** convert `my-mission-trips.ts` onto the helper (it is the cleanest
  hand-rolled one), to prove the API. Every other widget is converted in wave 1.

## 2. `cardLink()` (CROSS-3 class 1: C05 · C10 · C22, and C45 as the button variant)

`shared/card-link.ts`:
- `cardLink({ href, className, body, attrs })` renders the card body inside a real
  `<a href>`, with `:focus-visible` on the anchor and no `role` / `tabindex` on the wrapper.
- When `href` is null, it renders the current `role="article"` div.
- A button variant `cardButton()` serves in-widget detail rows (`my-invoices`).
- Export a small CSS snippet that each widget includes in `getStyles()`.
- The existing click listener stays purely to `emit()` the `*Selected` event; it must not
  `preventDefault` a modified click (Ctrl, Meta, Shift, middle button).
- **No component conversion in W0.** Unit-test only.

## 3. `field()` in `form-validation.ts` (C28 · C29; C19's generic "required" message)

- `field({ name, label, type, required, autocomplete, inputmode, attrs, describedBy })`
  emits `<label for=id>` + the control. The `id` is a stable slug of `name` plus the
  widget's instance prefix, so two widgets on one page cannot collide.
- `requiredStar()` goes inside the label. `aria-describedby` points at the error node
  `form-validation.ts` already renders.
- `type: "tel"` implies `autocomplete="tel"` and `inputmode="tel"`.
- Change `validation.required` to support a `{label}` slot. **Keep the bare version** for
  callers without a label, so wave 1 does not break. This covers C19 row 10's
  "which field?" complaint.
- Unit-test only.

## 4. `dialogFocus(container, trigger, { restoreOnOutsideClick })` (C08 · C54)

Lift the pattern from `add-to-calendar.ts` (focus the first option on open `:335`, restore
to the trigger on Escape). It moves focus in on open, traps Tab while open, returns focus
to the trigger on close, and does **not** steal focus back on an outside-click close.
**Reference consumer:** move `add-to-calendar.ts` onto it, so there is one implementation.

## 5. Reconfigure convention (C39 core; CROSS-4 §1, §4)

`pre-check.ts:140-150` and `subscribe-to-publication.ts:129-134` already implement it.
Promote it to the base class:
- a `protected painted = false` flag;
- `protected reconfigure(): void`, a no-op before first paint that calls a subclass
  `reload()` hook after it.

Document the rule in the base-class JSDoc: *observed attribute changes call
`reconfigure()`; never guard on `oldValue !== null` or on "entity already loaded".* Convert
**`pre-check.ts`** to the base version as the reference. Wave 1 converts the 11 buggy
widgets listed in the theme files.

## 6. Attribute naming guard (C79 core; CROSS-4 C79 §3–4)

- `packages/embed-sdk/src/components/observed-attributes.test.ts`. For every component,
  each `observedAttributes` entry must match `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`.
- Add a **ratchet allowlist** of the five legacy spellings (`hidesoftcredits`,
  `hidegrouplife`, `hideaddhouseholdmember`, `hidecancelbuttonpledge`,
  `cancelpledgeemailtemplate`) that fails when an entry becomes unused. W3, W5 and W6 then
  delete their entries as they rename.
- Add `readAttr(kebab, legacyAlias?)` to the base class. It reads the kebab name, falls
  back to the alias, and `console.warn`s **once** per element class on the fallback.
- Add to `CLAUDE.md` Code Conventions: *widget attributes are kebab-case; a legacy alias is
  read via `readAttr` for one release.*

## 7. `injectStyles` stops replacing sheets (C68 part 1)

`base-widget.ts:194` currently does `this.root.adoptedStyleSheets = [sheet]`. Change it to
append the widget sheet once and replace only that sheet on re-inject. Any sheet a host
adds into the shadow root must survive a re-render. Add a jsdom test (a constructed sheet
pushed in by "the host" is still present after `render()`). **Do not** add tokens here;
that is W7.

## 8. Error-code convention for payment/checkout routes (C42 remainder)

No route edits in W0; W1 does those. Confirm `WIRE_CODE_KEYS` / `errorText` cover a generic
`mp_unavailable` code, and add the key to all three locales so W1 only has to emit it.

## 9. Close C36 and C77

- Append resolution sections to:
  - **C36**: fixed by i18n. Cite `my-giving.ts:441` and `my-pledges.ts:242`, and note that
    the `calendar-links.ts:100` `en-US` is deliberate.
  - **C77**: won't do, decided 2026-10-11. Give the reason from the epic README.
- Strike C77's dependency line in `ROADMAP-missing-widgets.md` §Tier 4 and in
  `CROSS-5-theming-labels-locale.md` §5. Edit those lines only.

## Acceptance

- New helpers have unit tests: `card-link.test.ts`, the `field()` cases in
  `form-validation.test.ts`, `dialog-focus.test.ts`, and base-widget tests for needs-auth
  (both modes), reconfigure and `readAttr`.
- The three reference consumers (`my-mission-trips`, `add-to-calendar`, `pre-check`) behave
  identically. Their existing tests pass unchanged.
- Gates are green: `pnpm test:run`, `pnpm lint`, `pnpm exec tsc --noEmit`,
  `pnpm i18n:check`, `pnpm build:sdk`.
- A short **"How to consume"** block at the foot of this file, written by the W0 agent: one
  snippet per primitive. The wave-1 briefs point there.

## How to consume

_(W0 agent fills this in on completion.)_
