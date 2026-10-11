# W7 — Theming tokens (wave 2)

**Item:** C68. Scope decided 2026-10-11: **`--nw-*` tokens only**. The `injectStyles` fix ships
in W0.

**Out of scope, recorded in C68's resolution as still open:**
- `part=` attributes
- a per-element `custom-css` attribute
- a domain stylesheet endpoint (the `GetCustomStyles` equivalent)

**Design source:** `Plans/CROSS-5-theming-labels-locale.md` §1. Ignore §3–5: labels and locale
were resolved differently by i18n, and C77 is won't-do.

**Why wave 2:** this work rewrites the CSS of all 33 components. Running it alongside wave 1
would collide with every theme.

## W7a — the contract (one agent, branch `ws/w7a-tokens`)

1. Add `shared/theme-tokens.ts`. It holds the `:host` block declaring every `--nw-*` token with
   brand defaults. Use the token table in CROSS-5 §1 (colour, type, shape, space, controls).
   `base-widget` includes the block ahead of each widget's own sheet.
2. Defaults must reproduce today's look **pixel-for-pixel**. A church that sets nothing should
   see no change.
3. Document the contract in README under "Theming". List each token, its default and its
   meaning, and say plainly that tokens are a **supported, versioned API**.
4. Add a guard test with a per-file ratchet, like the i18n one. It fails when a component
   stylesheet contains a raw brand hex that a token covers (`#004C97`, `#002855`, `#F1BE48`,
   `#009CDE`, `#86AD3F`, `#FF6D6A`, `#2D2926`). Start with a per-file budget equal to today's
   count.
5. **Reference consumer:** convert `event-finder.ts`, and drop its budget to 0.
6. **Do not** touch `full-calendar-styles.ts`'s `--fc-classic-*` contract. Map
   `--fc-classic-*` defaults *from* `--nw-*` tokens where that is safe. Leave everything else
   as it is.

Merge W7a into the epic before starting W7b.

## W7b — the conversion (six agents in parallel, one per wave-1 family)

The family split matches wave 1's file ownership: W1 files, W2 files, and so on, so the six
agents don't conflict. `locale-selector`, `unsubscribe`, `prayer-feedback`,
`subscribe-to-publication`, `pre-check`, `contact-attributes`, the `mission-trip-*` elements
and `add-to-calendar` are spread across the families:

- **W2:** `add-to-calendar`
- **W3:** `prayer-feedback`
- **W4:** `pre-check`
- **W5:** `mission-trip-finder`, `my-mission-trips`
- **W6:** `contact-attributes`, `unsubscribe`, `subscribe-to-publication`, `locale-selector`,
  `user-menu`

Each W7b agent:

1. Replaces every raw colour, font, radius, shadow and spacing value that a token covers with
   `var(--nw-…)`.
2. Lowers each file's ratchet budget to 0.
3. Makes no visual change. Take before/after screenshots of each demo page with Playwright
   at 1280px and 390px, and attach the diffs to the report.

## Acceptance

- Setting `--nw-color-primary`, `--nw-font-family` and `--nw-radius` on `:root` re-brands
  every widget, with no stylesheet.
- With no overrides set, there is no visual diff.
- The ratchet table is empty, so the guard can then be collapsed.
- The C68 resolution section records the three deferred channels.

## How to convert (for the W7b agents) — written by W7a, 2026-10-11

The reference conversion is `components/event-finder.ts` (`getStyles()`). Diff it against
`eab2e09` to see every rule below applied.

### Read the resolved name, never the public one

A church **sets** `--nw-color-primary`. Widget CSS **reads** `var(--_nw-color-primary)`.
Note the underscore. `base-widget.injectStyles()` prepends a `:host` block to every widget
sheet that declares `--_nw-X: var(--nw-X, <default>)`. You add nothing to the widget.

Do not write `var(--nw-color-primary)` in a component, and do not declare `--nw-*` anywhere.
If you declare the public name on `:host`, `:root { --nw-… }` stops working: a declared value
beats an inherited one.

`theme-tokens.test.ts` fails on any `var(--_nw-…)` name that has no token behind it.

### Tokens and the exact raw values they replace

Replace **exact matches only**. A value that differs even slightly stays literal. That is the
"keep the per-component value" rule, and it is what keeps the visual diff at zero.

| Raw value (case-insensitive) | Becomes |
|---|---|
| `#004C97` | `var(--_nw-color-primary)` |
| `#002855` | `var(--_nw-color-secondary)` |
| `#F1BE48` | `var(--_nw-color-accent)` |
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
| `ui-sans-serif, system-ui, -apple-system, sans-serif` (exactly this stack) | `var(--_nw-font-family)` |
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

**Leave these literal.** None of them has a token:

- other greys (`#9ca3af`, `#9E9E9E`, `#E0E0E0`, `#1f2937`, …);
- tints derived from the brand: `rgba(0, 76, 151, …)`, `#D6F0FC`, `#ECF6E0`, `#FFE9E9`;
- other radii (`6px`, `10px`, `16px`, `9999px`, `50%`);
- other font sizes and weights;
- `margin: 0 0 6px`, `10px`, `9px`, `3px` and other off-scale spacing;
- the `0 0 0 1px` focus-shadow geometry. Write `box-shadow: 0 0 0 1px var(--_nw-color-primary)`
  and keep the geometry literal.

In a mixed shorthand, convert only the parts that match: `padding: 10px var(--_nw-space-5)`.

### Lowering the budget

`packages/embed-sdk/src/shared/theme-tokens.test.ts` has a `BUDGET` entry per file with
`brandHex` and `fontStack` counts. After converting a file, set its counts to the new numbers.
Delete the entry when both counts reach 0.

The test fails **both** over and under budget, and its message tells you the number. Run:

```
pnpm exec vitest run packages/embed-sdk/src/shared/theme-tokens.test.ts
```

The test does not count comments, or a hex that is the **fallback** inside a `var()`. Don't
use fallbacks to game it. Write the bare `var(--_nw-…)`, except in the two places listed under
edge cases.

### Edge cases W7a hit, or saw coming

- **Light-DOM portal styles.** The token block exists only inside shadow roots. Three places
  append a `<style>` to `document.head`: `my-invoices.ts` `injectCheckoutPortalStyles()`,
  `user-menu.ts` `injectPortalStyles()`, and any modal portalled out of the shadow root. In
  those, `--_nw-*` is undefined. Write `var(--nw-color-primary, #004C97)`, the **public** name
  with the default as the fallback. The ratchet ignores fallback hexes, so the budget can still
  reach 0.
- **`full-calendar-styles.ts`.** The `--fc-classic-*` block must stay complete (CLAUDE.md).
  Eight brand entries already read `var(--_nw-…, <old hex>)`. The remaining hexes there are in
  W2's normal rules and convert as usual. Do not try to tokenise the tints.
- **Hexes in JavaScript, not CSS.** Examples are `full-calendar.ts`'s event-type colour map
  and `eventColor`, and any canvas, SVG `fill=` or inline `style=` written from TS.
  - A string that ends up as an inline style inside the shadow root can become
    `"var(--_nw-color-primary)"`. Check it still renders.
  - A value that is computed with, or written to canvas, an email or a URL, cannot use a token.
    Leave it literal, keep its budget, and say so in the report.
- **`:host { all: initial }`** does not reset custom properties. That is why the tokens survive
  it.
- **Shared style constants**: `shared/base-widget.ts` `SIGN_IN_REQUIRED_STYLES`,
  `shared/custom-form.ts` and `shared/form-validation.ts`. Each is inlined into many widgets,
  and no W7b family owns them. **W6** takes them, as the last family. Note that `base-widget.ts`
  also carries the auth/fetch code. Touch only the style constant.
  - `shared/card-link.ts` is already converted.
- **Visual check.** `pnpm --filter @mpnext/embed-sdk demo --port <free port> --strictPort`.
  - Mock the API with Playwright `page.route` for `/api/embed/auth/config`,
    `/api/embed/session` and the widget's own routes, so cards render.
  - Compare `getComputedStyle` of every shadow element, not just the screenshot.
  - Screenshot each width **twice** and use the second. Going from a 1280px load straight to
    390px left a stale 15px scrollbar width in the first sample.
