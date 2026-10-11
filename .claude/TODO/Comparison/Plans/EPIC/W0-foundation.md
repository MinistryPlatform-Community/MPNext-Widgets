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

Written by the W0 agent on 2026-10-11, branch `ws/w0-foundation`. Everything below already
exists. **Do not fork any of it** — if a primitive is wrong, stop and report it (epic README
rule). Reference consumers to copy from: `my-mission-trips.ts` (sign-in), `pre-check.ts`
(sign-in + reconfigure), `add-to-calendar.ts` (dialogFocus).

### 1. Signed-out state — `MPNextWidget` (`shared/base-widget.ts`)

```ts
protected isNeedsAuth(input: unknown): boolean            // a Response, or a parsed body
protected renderSignInRequired(opts?: SignInRequiredOptions): string
export interface SignInRequiredOptions {
  subject?: string;       // wid for requestLogin / loginRequired; default: tag minus "next-"
  message?: string;       // translated prompt; default common.signInPrompt
  legacyMessage?: string; // translated legacy-mode sentence; default message + common.signInViaPage
  className?: string;     // extra wrapper classes (keep your own layout)
  buttonClass?: string;   // extra button classes (keep your own button look)
}
export const SIGN_IN_REQUIRED_STYLES: string              // include if you pass no classes
```

```ts
const res = await this.fetch("/api/embed/my-giving");
if (this.isNeedsAuth(res)) { this.state = "needs-auth"; this.render(); return; }
if (!res.ok) { /* error state: errorText(body) + Try Again */ }
// render():
case "needs-auth":
  return this.renderSignInRequired({
    subject: "my-giving",
    message: this.t("myGiving.signInPrompt"),
    className: "mg-state", buttonClass: "mg-btn",
  });
```

- `isNeedsAuth` is true for a 401 (or `auth_required` / `session_expired` /
  `invalid_session` in a body) **only when the request's token was public**; a 401 reaching a
  signed-in visitor is an error, not this state. Never test message text.
- `dual`/`hardened`: prompt + `[data-action="login"]` button. `legacy`/unknown: copy only, no
  button; a `loginRequired` event with `detail: { wid, passive: true }` fires once per element.
- **Do not bind `[data-action="login"]` inside the panel** — the base class delegates it.
  Never render Try Again in this state.

### 2. Result cards — `shared/card-link.ts`

```ts
import { cardLink, cardButton, bindCardSelect, isModifiedClick, CARD_LINK_STYLES } from "../shared/card-link";
cardLink(opts: { href: string | null | undefined; className: string; body: string;
                 attrs?: Record<string, string|number|boolean|null|undefined>; target?: string }): string
cardButton(opts: { className: string; body: string; attrs?: Record<...> }): string
bindCardSelect(root: ParentNode, selector: string,
               onSelect: (card: HTMLElement, e: MouseEvent) => boolean | void): void
isModifiedClick(e: MouseEvent): boolean
```

```ts
// getStyles(): `${css}${CARD_LINK_STYLES}`
html += cardLink({ href: this.buildDetailUrl(e.id), className: "ef-card",
                   body: inner /* already escaped */, attrs: { "data-id": e.id } });
// after render — emit only, the anchor navigates:
bindCardSelect(this.root, ".ef-card", (card) => { this.emit("eventSelected", { id: Number(card.dataset.id) }); });
```

`href` null/empty (no `target-url`) → `role="article"` div. `javascript:`/`data:` are
refused. Remove the old `role="link"`, `tabindex` and `window.location` navigation. No
interactive element inside the body. `cardButton` is for `my-invoices` rows (phrasing
content only: spans, not divs). Return `false` from `onSelect` to cancel a *plain* click.

### 3. Labelled form controls — `shared/form-validation.ts`

```ts
import { field, fieldId, FORM_VALIDATION_STYLES, validateForm } from "../shared/form-validation";
field(opts: FieldOptions): string
fieldId(name: string, idPrefix?: string): string   // `${idPrefix}-f-${slug(name)}`
interface FieldOptions {
  name: string; label: string;          // label already translated; field() escapes it
  type?: string;                        // input type | "textarea" | "select"; default "text"
  required?: boolean; autocomplete?: string; inputmode?: string;
  value?: string | number | null; placeholder?: string;
  options?: { value: string; label: string; selected?: boolean; disabled?: boolean }[];
  attrs?: Record<string, string|number|boolean|null|undefined>; // maxlength, pattern, data-*
  describedBy?: string | string[];      // help-text ids (the error id is added by validateForm)
  idPrefix?: string;                    // pass this.instanceId
  wrapperClass?: string;                // default "nw-field"; keep yours, e.g. "cf-field"
  inputClass?: string; labelClass?: string;
}
```

```ts
field({ name: "mobile_phone", label: this.t("fields.mobilePhone"), type: "tel",
        required: true, idPrefix: this.instanceId, wrapperClass: "pyv-field", inputClass: "pyv-input" })
```

`type: "tel"` adds `autocomplete="tel"` + `inputmode="tel"` (C29). A missing required value
in a `field()` control reads **"{label} is required."** (`validation.requiredField`); bare
`validation.required` is unchanged for hand-written markup. `this.instanceId` (`nw1`, `nw2`, …)
is a new protected base-class field.

### 4. Dialog / menu focus — `shared/dialog-focus.ts`

```ts
import { dialogFocus, type DialogFocusHandle, type DialogCloseReason } from "../shared/dialog-focus";
dialogFocus(container: HTMLElement,
            trigger: HTMLElement | null | (() => HTMLElement | null | undefined),
            opts?: { initialFocus?: HTMLElement | string | null; trapTab?: boolean;  // default true
                     onEscape?: () => void; restoreOnOutsideClick?: boolean })     // default false
  : DialogFocusHandle   // { release(reason?: "escape" | "outside" | "programmatic"): void; readonly active: boolean }
```

```ts
// open:
this.render();
this.modalFocus = dialogFocus(this.root.querySelector(".fc-modal")!, () => this.lastTrigger,
                              { onEscape: () => this.closeModal() });
// close (after re-render):
this.modalFocus?.release(reason);   // "outside" for an outside click → focus not stolen back
this.modalFocus = null;
```

A modal dialog keeps `trapTab` on; a `role="menu"` passes `trapTab: false`. Pass the trigger
as a function if your render replaces it.

### 5. Reconfigure — `MPNextWidget`

```ts
protected painted: boolean                         // set true yourself after the first paint
attributeChangedCallback(name, oldValue, newValue) // base default: oldValue !== newValue → reconfigure()
protected reconfigure(): void                      // no-op before painted / when disconnected; else reload()
protected reload(): void                           // override this
```

```ts
connectedCallback() {
  this.injectStyles(this.getStyles());
  void this.initLocale().then(() => { this.render(); this.painted = true; void this.load(); });
}
protected override reload(): void {
  this.data = null; this.state = "loading"; this.render(); void this.load();
}
// and DELETE your own attributeChangedCallback (or keep it only to filter names, then call this.reconfigure()).
```

Never guard on `oldValue !== null` or on "already loaded". A subclass must not declare its own
`private painted` / `private reconfigure` (TypeScript rejects it).

### 6. Attribute naming — `MPNextWidget` + guard

```ts
static readonly attributeAliases: Readonly<Record<string, string>>   // { "kebab-name": "oldname" }
protected readAttr(name: string, legacyAlias?: string): string | null // warns once per class on fallback
```

```ts
static readonly attributeAliases = { "hide-soft-credits": "hidesoftcredits" };
static get observedAttributes() {
  return ["api-host", "hide-soft-credits", ...Object.values(this.attributeAliases)];
}
private get hideSoftCredits() { return this.readAttr("hide-soft-credits") === "true"; }
```

Then **delete the entry from `LEGACY_SPELLINGS` in
`packages/embed-sdk/src/components/observed-attributes.test.ts` in the same commit** — the
ratchet fails while a renamed spelling is still listed. Owners: W5 `hidesoftcredits`,
`hidecancelbuttonpledge`, `cancelpledgeemailtemplate`; W3 `hidegrouplife`; W6
`hideaddhouseholdmember`. (This test file is the one W0 file wave 1 edits — delete-only.)

### 7. `injectStyles` — nothing to do

It now adds the widget's sheet once and replaces only that sheet; host-adopted sheets
survive. Call it as before. Tokens (`--nw-*`) are W7.

### 8. `mp_unavailable`

```ts
return NextResponse.json({ error: "mp_unavailable", message: "MP did not respond" }, { status: 503 });
// widget: this.errorText(body) → "This service is temporarily unavailable. Please try again in a few minutes."
```

Already in en / es / pt-BR; no `WIRE_CODE_KEYS` entry needed. It is a 5xx-class fault, so the
widget shows it with Try Again (unlike `needs-auth`).

### Shared escaping — `shared/html.ts`

`escapeHtml(value: unknown): string`, `escapeAttr` (alias), `renderAttrs(attrs): string`
(drops `false`/`null`/`undefined`, `true` → bare attribute, invalid names dropped).

### Deviations from this plan (W0, 2026-10-11)

- **§1** The legacy-mode `loginRequired` fires automatically once per element (with
  `detail.passive: true`), since with no button nothing else could fire it. `isNeedsAuth`
  decides by the token's `sub` when it is readable and only falls back to
  `isAuthenticated()` otherwise, so a 401 to a signed-in visitor is an error, not a sign-in
  loop. `my-mission-trips.test.ts`'s "button pressed" test was split into a dual case and a
  legacy case: it asserted a legacy-mode button, which is what this plan removes.
- **§1/§5** `pre-check.ts` was converted onto the sign-in helper as well as reconfigure (its
  private `renderSignInRequired` collided with the new protected one), and
  `subscribe-to-publication.ts` onto reconfigure (its private `painted`/`reconfigure`
  collided). Both are mechanical; their suites pass unchanged.
- **§3** `validation.required` was not given an optional slot (the ICU subset has no optional
  placeholders); the named version is a sibling key, `validation.requiredField`, used when the
  control came from `field()`. es/pt-BR phrase it around "the field" for gender agreement.
- **§4** `add-to-calendar` now also returns focus to the trigger after choosing a provider or
  toggling closed (previously focus dropped to `<body>` when the re-render detached it).
  Escape and outside-click behave exactly as before.
- **§6** The guard cannot check "contains a hyphen when more than one word" (it cannot see
  word boundaries); the regex plus the ratchet is what is enforced.
- **§7** The widget sheet is placed *before* host sheets rather than appended after them, so
  a host override wins on equal specificity.
