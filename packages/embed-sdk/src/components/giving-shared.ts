/**
 * Presentation helpers shared by the four signed-in giving widgets —
 * `next-my-giving`, `next-my-pledges`, `next-my-contribution-statement` and
 * `next-statement-preferences` (workstream W5).
 *
 * Deliberately **not** in `shared/`: these are giving-family layout pieces, not
 * SDK primitives, and `shared/**` belongs to the foundation workstream. Nothing
 * here registers an element, and nothing here carries visible text — the
 * signed-out panel itself is the base class's `renderSignInRequired()`.
 */

/**
 * The signed-out state (C30, CROSS-1 Phase 2): the widget's own chrome plus a
 * muted skeleton of its layout, with the shared sign-in panel laid over it, so
 * an anonymous visitor reads "your giving lives here — sign in" rather than
 * "something broke". The skeleton is `aria-hidden`; the panel is the only thing
 * assistive tech announces.
 *
 * Stacked with a one-cell grid rather than absolute positioning, so the block is
 * as tall as whichever of the two is taller and nothing overflows on a phone.
 */
export function givingSignedOut(panel: string, rows = 3): string {
  const bars = Array.from({ length: rows }, (_, i) =>
    `<div class="gv-sk-bar${i === rows - 1 ? " gv-sk-bar--short" : ""}"></div>`,
  ).join("");
  return [
    `<div class="gv-signed-out">`,
    `<div class="gv-skeleton" aria-hidden="true">`,
    `<div class="gv-sk-bar gv-sk-bar--wide"></div>`,
    `<div class="gv-sk-row"><div class="gv-sk-block"></div><div class="gv-sk-block"></div></div>`,
    bars,
    `</div>`,
    panel,
    `</div>`,
  ].join("");
}

/** Styles for {@link givingSignedOut}. Include alongside `SIGN_IN_REQUIRED_STYLES`. */
export const GIVING_SIGNED_OUT_STYLES = `
  .gv-signed-out { display: grid; }
  .gv-signed-out > * { grid-area: 1 / 1; }
  .gv-skeleton { display: flex; flex-direction: column; gap: var(--_nw-space-3); opacity: 0.55; }
  .gv-sk-bar { height: 14px; border-radius: 6px; background: #e5e7eb; }
  .gv-sk-bar--wide { height: 48px; border-left: 3px solid var(--_nw-color-accent); background: var(--_nw-color-surface-muted); }
  .gv-sk-bar--short { width: 60%; }
  .gv-sk-row { display: flex; gap: var(--_nw-space-3); }
  .gv-sk-block { flex: 1; height: 96px; border-radius: var(--_nw-radius); background: #eef0f3; }
  .gv-signed-out .nw-signin {
    align-self: center;
    justify-self: center;
    max-width: 420px;
    margin: 0 var(--_nw-space-2);
    background: rgba(255, 255, 255, 0.94);
    border-radius: var(--_nw-radius-lg);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
    color: var(--_nw-color-text);
    font-size: 15px;
    line-height: var(--_nw-line-height);
  }
`;

/**
 * Heading tag for a widget's outline (C35).
 *
 * `heading-level` (default **2**) is the level of the widget's own title, so a
 * widget embedded under the host page's `<h1>` slots into the page outline
 * instead of starting a second one — legacy hard-coded `h1` in every widget.
 * `offset` steps down from there (`1` for a section, `2` for an item), clamped
 * to `h6`. Anything unparsable falls back to the default.
 */
export function headingTag(raw: string | null, offset = 0): string {
  const parsed = parseInt(raw ?? "", 10);
  const base = Number.isFinite(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 2;
  return `h${Math.min(6, base + offset)}`;
}

/** Reset so a swapped-in heading tag looks exactly like the `<div>` it replaced. */
export const HEADING_RESET_STYLES = `
  h1, h2, h3, h4, h5, h6 { font: inherit; margin: 0; }
`;
