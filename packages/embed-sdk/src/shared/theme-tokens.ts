/**
 * The `--nw-*` theming contract.
 *
 * Custom properties inherit across the Shadow DOM boundary; selectors do not.
 * So a documented token set is the supported way for a church to re-brand
 * every widget from its own stylesheet:
 *
 * ```css
 * :root { --nw-color-primary: #7a1f2b; --nw-font-family: "Lato", sans-serif; --nw-radius: 4px; }
 * ```
 *
 * ## Two names per token, deliberately
 *
 * The **public** name (`--nw-color-primary`) is an *input*: the SDK never
 * declares it. The **resolved** name (`--_nw-color-primary`) is what widget
 * CSS reads, and it is declared here on `:host` as
 * `var(--nw-color-primary, <default>)`.
 *
 * The obvious design — declare `--nw-color-primary: #004C97` on `:host` — does
 * not work. A value declared on the host element beats any value the host
 * *inherits*, so a church's `:root { --nw-color-primary: … }` would be silently
 * ignored and only a rule aimed at the element itself
 * (`next-event-finder { … }`) would reach it. Resolving into a private name
 * keeps both working: the public name is read through inheritance from any
 * ancestor, or from a rule on the element, and falls back to the default.
 *
 * `:host { all: initial }` in each widget sheet does not disturb any of this:
 * the `all` shorthand never resets custom properties.
 *
 * ## Defaults
 *
 * Every default is the value the components used, as a literal, before tokens
 * existed — the dominant value in a survey of all component stylesheets
 * (2026-10-11). With nothing set, a widget renders exactly as it did. Where a
 * component used a different value from the dominant one, it keeps its literal;
 * tokens replace *exact* matches only (see
 * `.claude/references/widget-building-blocks.md` §2).
 *
 * **This is a supported, versioned API** (README "Theming"). Adding a token is
 * a minor change; renaming or removing one, or changing what it controls, is a
 * breaking one.
 */

/** One token: its public name, default, and what it controls. */
export interface ThemeToken {
  /** Public, church-settable name, without the leading `--`. */
  name: string;
  /** Default value. May reference another token's resolved name. */
  value: string;
  /** What it controls — the README "Theming" table is written from this. */
  description: string;
}

export const THEME_TOKENS: readonly ThemeToken[] = [
  // ── Colour: brand palette ──
  { name: "nw-color-primary", value: "#004C97", description: "Primary brand colour: buttons, links, focused inputs, dates, spinners, selected states." },
  { name: "nw-color-secondary", value: "#002855", description: "Secondary brand colour: headings and card titles, button hover." },
  { name: "nw-color-accent", value: "#F1BE48", description: "Accent: badges (e.g. Featured) and highlights." },
  { name: "nw-color-info", value: "#009CDE", description: "Informational colour; also the default focus-ring colour." },
  { name: "nw-color-success", value: "#86AD3F", description: "Success states and confirmations." },
  { name: "nw-color-error", value: "#FF6D6A", description: "Error accent: invalid-field borders, required markers, error icons." },
  { name: "nw-color-warning", value: "#F1BE48", description: "Pending and warning states: a payment still processing, an amount due, warning toasts, the sandbox notice." },
  { name: "nw-color-text", value: "#2D2926", description: "Body text." },
  // ── Colour: neutrals ──
  { name: "nw-color-text-subtle", value: "#474747", description: "Secondary body text, such as descriptions." },
  { name: "nw-color-muted", value: "#6b7280", description: "Muted text: field labels, metadata, empty and loading states." },
  { name: "nw-color-on-primary", value: "#ffffff", description: "Text and icons drawn on a primary-coloured background." },
  { name: "nw-color-surface", value: "#ffffff", description: "Card, panel and input background." },
  { name: "nw-color-surface-muted", value: "#f3f4f6", description: "Subdued background: image placeholders, inactive chips." },
  { name: "nw-color-border", value: "#e5e7eb", description: "Card and panel borders, dividers." },
  { name: "nw-color-border-strong", value: "#d1d5db", description: "Form-control borders." },
  { name: "nw-color-error-text", value: "#b91c1c", description: "Error message text (darker than the error accent, for contrast)." },
  // ── Type ──
  { name: "nw-font-family", value: "ui-sans-serif, system-ui, -apple-system, sans-serif", description: "Font stack for every widget." },
  { name: "nw-font-size-base", value: "14px", description: "Body and form-control text size." },
  { name: "nw-line-height", value: "1.5", description: "Line height of running text." },
  { name: "nw-font-weight-heading", value: "700", description: "Weight of headings and card titles." },
  // ── Shape ──
  { name: "nw-radius", value: "8px", description: "Corner radius of buttons, inputs and small surfaces." },
  { name: "nw-radius-lg", value: "12px", description: "Corner radius of cards and panels." },
  { name: "nw-border-width", value: "1px", description: "Width of card, panel and control borders." },
  { name: "nw-shadow", value: "0 1px 2px rgba(0,0,0,0.05)", description: "Resting shadow of cards and panels." },
  { name: "nw-shadow-hover", value: "0 4px 10px rgba(0,0,0,0.08)", description: "Shadow of a card under the pointer." },
  // ── Space ──
  { name: "nw-space-1", value: "4px", description: "Spacing step 1 (gaps, padding, margins)." },
  { name: "nw-space-2", value: "8px", description: "Spacing step 2." },
  { name: "nw-space-3", value: "12px", description: "Spacing step 3." },
  { name: "nw-space-4", value: "16px", description: "Spacing step 4." },
  { name: "nw-space-5", value: "20px", description: "Spacing step 5." },
  { name: "nw-space-6", value: "24px", description: "Spacing step 6." },
  // ── Controls ── (default to the tokens above, so re-branding the palette carries through)
  { name: "nw-button-bg", value: "var(--_nw-color-primary)", description: "Primary button background. Defaults to --nw-color-primary." },
  { name: "nw-button-bg-hover", value: "var(--_nw-color-secondary)", description: "Primary button background on hover. Defaults to --nw-color-secondary." },
  { name: "nw-button-fg", value: "var(--_nw-color-on-primary)", description: "Primary button text. Defaults to --nw-color-on-primary." },
  { name: "nw-button-radius", value: "var(--_nw-radius)", description: "Primary button corner radius. Defaults to --nw-radius." },
  { name: "nw-focus-ring", value: "2px solid var(--_nw-color-info)", description: "Keyboard focus outline (an `outline` shorthand). Defaults to 2px solid --nw-color-info." },
];

/**
 * The `:host` block every widget sheet starts with. Prepended by
 * `MPNextWidget.injectStyles()`, so no widget includes it by hand.
 */
export const THEME_TOKENS_CSS = [
  ":host {",
  ...THEME_TOKENS.map((t) => `  --_${t.name}: var(--${t.name}, ${t.value});`),
  "}",
].join("\n");
