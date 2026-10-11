/**
 * In-page accessibility probe for the a11y spec (W8 section 3, CROSS-3 class).
 *
 * `@axe-core/playwright` is not a dependency and W8 may not add one, so this is
 * a deliberately small custom probe. It walks every `next-*` element's open
 * shadow root (and any nested `next-*` shadow roots) and reports four rule
 * classes, each one a defect class the comparison found shipped:
 *
 *   - `name`:       a visible focusable control with no accessible name (C28);
 *   - `role-link`:  `role="link"` on anything but an `<a href>` (C05/C10/C22);
 *   - `heading`:    a widget that renders no `h1`-`h6` / `role="heading"` (C35);
 *   - `dialog`:     a visible `[role=dialog][aria-modal=true]` that does not hold
 *                   focus (C08/C54).
 *
 * The name computation is a pragmatic subset of accname 1.2: aria-labelledby,
 * aria-label, associated / wrapping <label>, title, placeholder, alt, value for
 * input buttons, and subtree text for name-from-content roles. It errs towards
 * *accepting* a name -- a probe that cries wolf gets deleted.
 *
 * The function is serialised into the page by `page.evaluate`, so it must be
 * self-contained: no imports, no closures over module scope.
 */

export type A11yRule = "name" | "role-link" | "heading" | "dialog";

export interface A11yViolation {
  rule: A11yRule;
  /** Host element tag, e.g. `next-profile`. */
  widget: string;
  /** Short description of the offending node: tag, class, data-action, type. */
  node: string;
}

export interface A11yProbeResult {
  widgets: { tag: string; signedOutPanel: boolean; headings: number; rendered: boolean }[];
  violations: A11yViolation[];
}

export function runA11yProbe(): A11yProbeResult {
  const FOCUSABLE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='']",
    "[contenteditable='true']",
  ].join(",");

  const describe = (el: Element): string => {
    const parts = [el.localName];
    const cls = el.getAttribute("class");
    if (cls) parts.push(`.${cls.trim().split(/\s+/).join(".")}`);
    for (const attr of ["data-action", "type", "name", "role", "id"]) {
      const v = el.getAttribute(attr);
      if (v) parts.push(`[${attr}="${v}"]`);
    }
    return parts.join("");
  };

  const isRendered = (el: Element): boolean => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const text = (node: Node | null | undefined): string =>
    (node?.textContent ?? "").replace(/\s+/g, " ").trim();

  const accessibleName = (el: Element, root: ShadowRoot): string => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const name = labelledBy
        .split(/\s+/)
        .map((id) => text(root.getElementById(id)))
        .join(" ")
        .trim();
      if (name) return name;
    }
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return aria;

    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const fromLabels = Array.from(el.labels ?? [])
        .map((l) => text(l))
        .join(" ")
        .trim();
      if (fromLabels) return fromLabels;
      if (el instanceof HTMLInputElement) {
        if (["button", "submit", "reset"].includes(el.type) && el.value.trim()) return el.value.trim();
        if (el.type === "submit") return "Submit"; // UA default label
        if (el.type === "reset") return "Reset";
        if (el.type === "image" && el.alt.trim()) return el.alt.trim();
      }
    }
    const title = el.getAttribute("title")?.trim();
    if (title) return title;
    const placeholder = el.getAttribute("placeholder")?.trim();
    if (placeholder) return placeholder;

    // Name from content: buttons, links, summary and button-ish roles.
    const fromContent =
      el instanceof HTMLButtonElement ||
      el instanceof HTMLAnchorElement ||
      el.localName === "summary" ||
      ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"].includes(
        el.getAttribute("role") ?? "",
      );
    if (fromContent) {
      const t = text(el);
      if (t) return t;
      const img = el.querySelector("img[alt]:not([alt=''])");
      if (img) return img.getAttribute("alt")!.trim();
      const svgTitle = el.querySelector("svg title");
      if (svgTitle && text(svgTitle)) return text(svgTitle);
      const labelled = el.querySelector("[aria-label]");
      if (labelled) return labelled.getAttribute("aria-label")!.trim();
    }
    return "";
  };

  const violations: A11yViolation[] = [];
  const widgets: A11yProbeResult["widgets"] = [];

  const hosts = Array.from(document.querySelectorAll("*")).filter(
    (el) => el.localName.startsWith("next-") && el.shadowRoot,
  );

  for (const host of hosts) {
    const widget = host.localName;
    // Collect this widget's shadow root plus nested next-* roots.
    const roots: ShadowRoot[] = [];
    const queue: ShadowRoot[] = [host.shadowRoot!];
    while (queue.length) {
      const r = queue.shift()!;
      roots.push(r);
      for (const child of Array.from(r.querySelectorAll("*"))) {
        if (child.localName.startsWith("next-") && child.shadowRoot) queue.push(child.shadowRoot);
      }
    }

    let headings = 0;
    let signedOutPanel = false;
    for (const root of roots) {
      headings += root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]").length;
      if (root.querySelector("[data-nw-signin]")) signedOutPanel = true;

      for (const el of Array.from(root.querySelectorAll(FOCUSABLE))) {
        if ((el as HTMLButtonElement).disabled) continue;
        if (el.closest("[inert],[aria-hidden=true],[hidden]")) continue;
        if (!isRendered(el)) continue;
        if (!accessibleName(el, root)) violations.push({ rule: "name", widget, node: describe(el) });
      }

      for (const el of Array.from(root.querySelectorAll("[role=link]"))) {
        if (!(el instanceof HTMLAnchorElement && el.hasAttribute("href"))) {
          violations.push({ rule: "role-link", widget, node: describe(el) });
        }
      }

      for (const dialog of Array.from(root.querySelectorAll("[role=dialog][aria-modal=true]"))) {
        if (!isRendered(dialog)) continue;
        // Deep activeElement: descend through shadow roots from the document.
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        if (!active || !dialog.contains(active)) {
          violations.push({
            rule: "dialog",
            widget,
            node: `${describe(dialog)} (focus on ${active ? describe(active) : "nothing"})`,
          });
        }
      }
    }
    widgets.push({ tag: widget, signedOutPanel, headings, rendered: isRendered(host) });
  }

  return { widgets, violations };
}
