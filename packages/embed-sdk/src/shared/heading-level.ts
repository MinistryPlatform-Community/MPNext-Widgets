/**
 * The `heading-level` convention (C35, CROSS-3).
 *
 * Introduced by the giving widgets (W5) and promoted here when the checkout,
 * pay, full-calendar and unsubscribe widgets adopted it, so no widget outside
 * the giving family has to import a giving-family module to get a heading.
 */

/**
 * Heading tag for a widget's outline.
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

/**
 * Reset so a swapped-in heading tag looks exactly like the `<div>`/`<p>` it
 * replaced. Put it **before** the widget's own rules: it is a type selector,
 * so any class rule that sets `font-*` or `margin` still wins.
 */
export const HEADING_RESET_STYLES = `
  h1, h2, h3, h4, h5, h6 { font: inherit; margin: 0; }
`;
