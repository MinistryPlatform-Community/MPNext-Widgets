/**
 * Result cards that are real links (CROSS-3 class 1: C05, C10, C22; C45 for
 * the button variant).
 *
 * The finders rendered each card as `div role="link" tabindex="0"` with a click
 * listener and no key handler: assistive tech announced a link, Enter did
 * nothing, and middle-click, Ctrl-click, "copy link address" and the hover
 * status bar were all missing for every visitor. Every one of those widgets
 * already knows the destination URL synchronously, so the card body goes inside
 * a real `<a href>` and the browser does the rest.
 *
 * ```ts
 * import { cardLink, bindCardSelect, CARD_LINK_STYLES } from "../shared/card-link";
 *
 * // getStyles(): `${styles}${CARD_LINK_STYLES}`
 * const html = cardLink({
 *   href: this.buildDetailUrl(group.id),   // null → a non-interactive article
 *   className: "gf-card",
 *   body: `<span class="gf-name">${esc(group.name)}</span>…`,
 *   attrs: { "data-id": group.id },
 * });
 * // after render — emit only; the anchor navigates by itself:
 * bindCardSelect(this.root, ".gf-card", (card) => {
 *   this.emit("groupSelected", { id: Number(card.dataset.id) });
 * });
 * ```
 *
 * **The card body must not contain another interactive element** (a link or a
 * button inside a link is invalid HTML and unreachable by keyboard). Put a
 * secondary action beside the card, not inside it.
 */

import { escapeAttr, renderAttrs } from "./html";

type AttrValue = string | number | boolean | null | undefined;

export interface CardLinkOptions {
  /**
   * Destination. `null` / empty (no `target-url` configured) renders the card
   * as a plain `role="article"` block, which is correct for a card that goes
   * nowhere. A `javascript:` or other non-web scheme is treated as no link.
   */
  href: string | null | undefined;
  /** The widget's own card classes, e.g. `"ef-card ef-card--featured"`. */
  className: string;
  /** Inner markup, **already escaped** by the caller. */
  body: string;
  /** Extra attributes, e.g. `{ "data-id": 42 }`. Never `role` or `tabindex`. */
  attrs?: Record<string, AttrValue>;
  /** Optional `target` (e.g. `"_blank"`); adds `rel="noopener"`. */
  target?: string;
}

export interface CardButtonOptions {
  /** The widget's own row classes, e.g. `"table-row"`. */
  className: string;
  /**
   * Inner markup, **already escaped**. A `<button>` takes phrasing content
   * only: use `<span>`s (styled `display: block` where needed), not `<div>`s.
   */
  body: string;
  attrs?: Record<string, AttrValue>;
}

/** Accept http(s) and relative URLs; refuse `javascript:`, `data:` and the rest. */
function safeHref(href: string | null | undefined): string | null {
  const value = (href ?? "").trim();
  if (!value) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!scheme) return value; // relative: "/groups/4", "?id=4", "#x"
  const name = scheme[1].toLowerCase();
  return name === "http" || name === "https" ? value : null;
}

/**
 * A result card. With an `href`, the body sits inside a real `<a>`; without
 * one, inside a `role="article"` div. Neither carries `tabindex` or
 * `role="link"`.
 */
export function cardLink(opts: CardLinkOptions): string {
  const href = safeHref(opts.href);
  const attrs = renderAttrs(opts.attrs);
  if (href === null) {
    return `<div class="${escapeAttr(opts.className)}" role="article"${attrs}>${opts.body}</div>`;
  }
  const target = opts.target
    ? renderAttrs({ target: opts.target, rel: "noopener" })
    : "";
  const className = ["nw-card-link", opts.className].filter(Boolean).join(" ");
  return `<a class="${escapeAttr(className)}" href="${escapeAttr(href)}"${target}${attrs}>${opts.body}</a>`;
}

/**
 * An in-widget detail row (`next-my-invoices`): a real `<button type="button">`,
 * so it is focusable and Enter / Space activate it, for a row that opens a view
 * inside the widget rather than navigating.
 */
export function cardButton(opts: CardButtonOptions): string {
  const className = ["nw-card-button", opts.className].filter(Boolean).join(" ");
  return `<button type="button" class="${escapeAttr(className)}"${renderAttrs(opts.attrs)}>${opts.body}</button>`;
}

/**
 * True for a click the browser should be left to handle on its own: Ctrl /
 * Meta / Shift / Alt held, or any button but the primary one (middle-click
 * opens a new tab). Never `preventDefault()` one of these.
 */
export function isModifiedClick(e: MouseEvent): boolean {
  return e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || (e.button ?? 0) !== 0;
}

/**
 * Bind the `*Selected` emit to every card under `root`.
 *
 * `onSelect` runs for plain and modified clicks alike, and for Enter on a
 * focused anchor (the browser synthesises a click). Navigation is left to the
 * anchor. Return `false` from `onSelect` to cancel navigation for a **plain**
 * click — e.g. a host page that called `preventDefault()` on a cancelable
 * `*Selected` event; a modified click is never cancelled. Listens on
 * `click` and `auxclick`, so middle-click emits too.
 */
export function bindCardSelect(
  root: ParentNode,
  selector: string,
  onSelect: (card: HTMLElement, e: MouseEvent) => boolean | void,
): void {
  for (const card of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const handler = (e: Event) => {
      const mouse = e as MouseEvent;
      if (e.type === "auxclick" && mouse.button !== 1) return;
      const result = onSelect(card, mouse);
      if (result === false && e.type === "click" && !isModifiedClick(mouse)) {
        e.preventDefault();
      }
    };
    card.addEventListener("click", handler);
    card.addEventListener("auxclick", handler);
  }
}

/**
 * Include in the widget's `getStyles()`. The resets sit inside `:where()` so
 * they carry zero specificity and the widget's own card class always wins;
 * only the focus ring is asserted.
 */
export const CARD_LINK_STYLES = `
  :where(a.nw-card-link) { display: block; color: inherit; text-decoration: none; }
  :where(button.nw-card-button) { display: block; width: 100%; margin: 0; font: inherit; color: inherit; text-align: inherit; background: none; border: 0; cursor: pointer; }
  a.nw-card-link:focus-visible,
  button.nw-card-button:focus-visible { outline: 2px solid #009CDE; outline-offset: 2px; }
`;
