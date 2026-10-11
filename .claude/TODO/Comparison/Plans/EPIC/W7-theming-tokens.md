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
