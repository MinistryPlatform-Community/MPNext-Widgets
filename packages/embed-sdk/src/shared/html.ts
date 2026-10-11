/**
 * Markup escaping for the shared render helpers (`renderSignInRequired`,
 * `cardLink`, `field`).
 *
 * Every component carries a private `escapeHtml` of its own; these exist so the
 * shared helpers do not have to reach into a widget for one. Both escape `"` and
 * `'`, so either is safe inside a quoted attribute value.
 */

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for element content or a quoted attribute value. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Alias of {@link escapeHtml}, named for readability at attribute call sites. */
export const escapeAttr = escapeHtml;

/**
 * Serialise an attribute map. `false` / `null` / `undefined` omit the
 * attribute, `true` renders it bare (`disabled`), anything else is escaped.
 * Attribute **names** are validated, not escaped: a name outside the HTML
 * grammar is dropped rather than allowed to break out of the tag.
 */
export function renderAttrs(
  attrs: Record<string, string | number | boolean | null | undefined> | undefined,
): string {
  if (!attrs) return "";
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/.test(name)) continue;
    if (value === false || value === null || value === undefined) continue;
    parts.push(value === true ? name : `${name}="${escapeHtml(value)}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}
