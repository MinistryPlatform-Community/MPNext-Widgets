# Widget building blocks — how to consume them

Reference for the shared primitives in `packages/embed-sdk/src/shared/` and the theming-token
conventions. `CLAUDE.md` ("Widget Building Blocks", "Theming Tokens") states the rules; this
file carries the signatures and copy-ready snippets.

Both sections were first written on 2026-10-11 during the comparison-remediation epic: §1 by
its foundation workstream (W0), §2 by its theming workstream (W7). The epic's plan files have
since been deleted; see git history if you need them.

---

## 1. Shared primitives

Everything below already exists. **Do not fork any of it.** If a primitive is wrong, fix it in
`shared/`. Reference consumers to copy from: `my-mission-trips.ts` (sign-in), `pre-check.ts`
(sign-in + reconfigure), `add-to-calendar.ts` (dialogFocus).

### 1.1 Signed-out state — `MPNextWidget` (`shared/base-widget.ts`)

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
  `invalid_session` in a body) **only when the request's token was public**. It decides by the
  token's `sub` when that is readable, and falls back to `isAuthenticated()` otherwise. A 401
  reaching a signed-in visitor is an error, not this state. Never test message text.
- `dual`/`hardened`: prompt + `[data-action="login"]` button. `legacy`/unknown: copy only, no
  button; a `loginRequired` event with `detail: { wid, passive: true }` fires once per element.
- **Do not bind `[data-action="login"]` inside the panel** — the base class delegates it.
  Never render Try Again in this state.

### 1.2 Result cards — `shared/card-link.ts`

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
refused. No `role="link"`, `tabindex` or `window.location` navigation. No interactive element
inside the body. `cardButton` is for rows that act in place, such as `my-invoices` (phrasing
content only: spans, not divs). Return `false` from `onSelect` to cancel a *plain* click.

### 1.3 Labelled form controls — `shared/form-validation.ts`

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

`type: "tel"` adds `autocomplete="tel"` + `inputmode="tel"`. A missing required value in a
`field()` control reads **"{label} is required."** (`validation.requiredField`; es/pt-BR
phrase it around "the field" for gender agreement). Bare `validation.required` is unchanged
for hand-written markup. `this.instanceId` (`nw1`, `nw2`, …) is a protected base-class field
that keeps ids unique when two widgets share a page.

### 1.4 Dialog / menu focus — `shared/dialog-focus.ts`

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

A modal dialog keeps `trapTab` on (it descends open shadow roots); a `role="menu"` passes
`trapTab: false`. Pass the trigger as a function if your render replaces it.

### 1.5 Reconfigure on late attribute changes — `MPNextWidget`

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
// Do not declare your own attributeChangedCallback (or keep it only to filter names, then call this.reconfigure()).
```

Never guard on `oldValue !== null` or on "already loaded". A subclass must not declare its own
`private painted` / `private reconfigure` (TypeScript rejects it).

### 1.6 Attribute naming — `MPNextWidget` + guard

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

`components/observed-attributes.test.ts` enforces kebab-case on `observedAttributes`; alias
values are exempt. It cannot check "contains a hyphen when more than one word" (it cannot see
word boundaries), so the regex is what is enforced. A brand-new attribute gets no alias.

### 1.7 `injectStyles` — nothing to do

It adds the widget's sheet once and replaces only that sheet, placed *before* any
host-adopted sheets, so a host override survives re-render and wins on equal specificity.
Call it as before. Tokens are §2.

### 1.8 `mp_unavailable`

```ts
return NextResponse.json({ error: "mp_unavailable", message: "MP did not respond" }, { status: 503 });
// widget: this.errorText(body) → "This service is temporarily unavailable. Please try again in a few minutes."
```

Already in en / es / pt-BR; no `WIRE_CODE_KEYS` entry needed. It is a 5xx-class fault, so the
widget shows it with Try Again (unlike the signed-out state).

### 1.9 Shared escaping — `shared/html.ts`

`escapeHtml(value: unknown): string`, `escapeAttr` (alias), `renderAttrs(attrs): string`
(drops `false`/`null`/`undefined`, `true` → bare attribute, invalid names dropped).

---

## 2. Theming tokens — how to convert a stylesheet

The reference conversion is `components/event-finder.ts` (`getStyles()`). The token table and
defaults live in `shared/theme-tokens.ts`; README "Theming" is the customer-facing contract.

### 2.1 Read the resolved name, never the public one

A church **sets** `--nw-color-primary`. Widget CSS **reads** `var(--_nw-color-primary)`.
Note the underscore. `base-widget.injectStyles()` prepends a `:host` block to every widget
sheet that declares `--_nw-X: var(--nw-X, <default>)`. You add nothing to the widget.

Do not write `var(--nw-color-primary)` in a component, and do not declare `--nw-*` anywhere.
If you declare the public name on `:host`, `:root { --nw-… }` stops working: a declared value
beats an inherited one.

`theme-tokens.test.ts` fails on any `var(--_nw-…)` name that has no token behind it.

### 2.2 Tokens and the exact raw values they replace

Replace **exact matches only**. A value that differs even slightly stays literal. That is the
"keep the per-component value" rule, and it is what keeps the visual diff at zero.

| Raw value (case-insensitive) | Becomes |
|---|---|
| `#004C97` | `var(--_nw-color-primary)` |
| `#002855` | `var(--_nw-color-secondary)` |
| `#F1BE48` as a highlight (Featured badge, summary stripe) | `var(--_nw-color-accent)` |
| `#F1BE48` meaning pending / warning / amount due | `var(--_nw-color-warning)` |
| `#009CDE` | `var(--_nw-color-info)` |
| `#86AD3F` | `var(--_nw-color-success)` |
| `#FF6D6A` | `var(--_nw-color-error)` |
| `#2D2926` | `var(--_nw-color-text)` |
| `#474747` | `var(--_nw-color-text-subtle)` |
| `#6b7280` | `var(--_nw-color-muted)` |
| `white` / `#fff` / `#ffffff` as a **background** of a card, panel or input | `var(--_nw-color-surface)` |
| `white` / `#fff` as **text on a primary background** | `var(--_nw-color-on-primary)`, or `--_nw-button-fg` on a primary button |
| `#f3f4f6` | `var(--_nw-color-surface-muted)` |
| `#e5e7eb` (borders, dividers) | `var(--_nw-color-border)` |
| `#d1d5db` (form-control borders) | `var(--_nw-color-border-strong)` |
| `#b91c1c` (error text) | `var(--_nw-color-error-text)` |
| a `ui-sans-serif, system-ui, …` font stack | `var(--_nw-font-family)` |
| `font-size: 14px` | `var(--_nw-font-size-base)` |
| `line-height: 1.5` | `var(--_nw-line-height)` |
| `font-weight: 700` on a heading or card title only (not badges or amounts) | `var(--_nw-font-weight-heading)` |
| `border-radius: 8px` | `var(--_nw-radius)` (on the primary button use `--_nw-button-radius`) |
| `border-radius: 12px` | `var(--_nw-radius-lg)` |
| the `1px` in `border: 1px solid <token colour>` | `var(--_nw-border-width)` |
| `box-shadow: 0 1px 2px rgba(0,0,0,0.05)` | `var(--_nw-shadow)` |
| `box-shadow: 0 4px 10px rgba(0,0,0,0.08)` | `var(--_nw-shadow-hover)` |
| `4px` `8px` `12px` `16px` `20px` `24px` in `gap` / `padding` / `margin*` | `var(--_nw-space-1)` … `var(--_nw-space-6)` |
| primary-button `background: #004C97` / hover `#002855` / `color: white` | `--_nw-button-bg` / `--_nw-button-bg-hover` / `--_nw-button-fg` |
| `outline: 2px solid #009CDE` on `:focus-visible` | `outline: var(--_nw-focus-ring)` |

`--nw-color-warning` has the accent's hex by default but does **not** follow the accent, so a
re-brand never recolours a payment status.

**Leave these literal.** None of them has a token:

- other greys (`#9ca3af`, `#9E9E9E`, `#E0E0E0`, `#1f2937`, …);
- tints derived from the brand: `rgba(0, 76, 151, …)`, `#D6F0FC`, `#ECF6E0`, `#FFE9E9`;
- other radii (`6px`, `10px`, `16px`, `9999px`, `50%`);
- other font sizes and weights;
- `margin: 0 0 6px`, `10px`, `9px`, `3px` and other off-scale spacing;
- the `0 0 0 1px` focus-shadow geometry. Write `box-shadow: 0 0 0 1px var(--_nw-color-primary)`
  and keep the geometry literal.

In a mixed shorthand, convert only the parts that match: `padding: 10px var(--_nw-space-5)`.

A new colour role is a new token: add it to `theme-tokens.ts` and README "Theming" rather
than writing a raw hex.

### 2.3 The guard

`packages/embed-sdk/src/shared/theme-tokens.test.ts` asserts that **no widget source contains
a raw brand hex or a literal `ui-sans-serif` font stack**. (It started as a per-file ratchet;
the budget table reached zero and was removed.) Run:

```
pnpm exec vitest run packages/embed-sdk/src/shared/theme-tokens.test.ts
```

It does not count comments, or a hex that is the **fallback** inside a `var()`. Don't use
fallbacks to game it. Write the bare `var(--_nw-…)`, except in the two places under 2.4.

### 2.4 Edge cases

- **Light-DOM portal styles.** The token block exists only inside shadow roots. Styles
  appended to `document.head` — `my-invoices.ts` `injectCheckoutPortalStyles()`,
  `user-menu.ts` `injectPortalStyles()`, and any modal portalled out of the shadow root — see
  no `--_nw-*`. Write `var(--nw-color-primary, #004C97)`, the **public** name with the default
  as the fallback. The guard ignores fallback hexes.
- **`full-calendar-styles.ts`.** The `--fc-classic-*` block must stay complete (CLAUDE.md,
  Toolchain). Its brand entries read `var(--_nw-…, <old hex>)`. Do not try to tokenise the
  tints.
- **Hexes in JavaScript, not CSS.** Examples are `full-calendar.ts`'s event-type colour map and
  `eventColor`, and any canvas, SVG `fill=` or inline `style=` written from TS.
  - A string that ends up as an inline style inside the shadow root can become
    `"var(--_nw-color-primary)"`. Check it still renders.
  - A value that is computed with, or written to canvas, an email or a URL, cannot use a token.
- **`:host { all: initial }`** does not reset custom properties. That is why the tokens survive
  it.
- **Shared style constants** — `shared/base-widget.ts` `SIGN_IN_REQUIRED_STYLES`,
  `shared/custom-form.ts`, `shared/form-validation.ts`, `shared/card-link.ts` — are inlined
  into many widgets and follow the same rules.

### 2.5 Checking for visual drift

- `pnpm --filter @mpnext/embed-sdk demo --port <free port> --strictPort`.
- Mock the API with Playwright `page.route` for `/api/embed/auth/config`,
  `/api/embed/session` and the widget's own routes, so cards render.
- Compare `getComputedStyle` of every shadow element, not just the screenshot, at 1280px and
  390px.
- Screenshot each width **twice** and use the second. Going from a 1280px load straight to
  390px left a stale 15px scrollbar width in the first sample.
