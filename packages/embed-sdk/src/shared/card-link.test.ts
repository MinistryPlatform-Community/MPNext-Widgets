/**
 * `cardLink()` / `cardButton()` (CROSS-3 class 1: C05, C10, C22, C45).
 *
 * The defect these replace was `div role="link" tabindex="0"` with a click
 * listener: announced as a link, dead to Enter, and missing every browser link
 * affordance. So the load-bearing assertions are structural — a real anchor
 * with a real href, and never `role="link"` or a `tabindex` on the wrapper.
 */
import { describe, it, expect, vi } from "vitest";
import {
  bindCardSelect,
  cardButton,
  cardLink,
  isModifiedClick,
  CARD_LINK_STYLES,
} from "./card-link";

function render(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("cardLink()", () => {
  it("renders the body inside a real <a href>", () => {
    const host = render(
      cardLink({ href: "/groups?id=4", className: "gf-card", body: "<span>Alpha</span>" }),
    );
    const a = host.querySelector("a")!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("/groups?id=4");
    expect(a.classList.contains("gf-card")).toBe(true);
    expect(a.classList.contains("nw-card-link")).toBe(true);
    expect(a.innerHTML).toBe("<span>Alpha</span>");
  });

  it("never puts role or tabindex on the card", () => {
    for (const href of ["/x", null]) {
      const el = render(cardLink({ href, className: "c", body: "b" })).firstElementChild!;
      expect(el.getAttribute("role")).not.toBe("link");
      expect(el.hasAttribute("tabindex")).toBe(false);
    }
  });

  it("renders a role=article div when there is no destination", () => {
    for (const href of [null, undefined, "", "   "]) {
      const el = render(cardLink({ href, className: "ef-card", body: "b" })).firstElementChild!;
      expect(el.tagName, String(href)).toBe("DIV");
      expect(el.getAttribute("role")).toBe("article");
      expect(el.classList.contains("ef-card")).toBe(true);
    }
  });

  it("refuses non-web schemes rather than rendering them as links", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x"]) {
      const host = render(cardLink({ href, className: "c", body: "b" }));
      expect(host.querySelector("a"), href).toBeNull();
    }
    expect(render(cardLink({ href: "https://church.org/e/1", className: "c", body: "b" })).querySelector("a")).not.toBeNull();
  });

  it("escapes the href and extra attributes, and drops invalid attribute names", () => {
    const host = render(
      cardLink({
        href: '/e?id=1"onmouseover="x',
        className: "c",
        body: "b",
        attrs: { "data-id": '4" onclick="x', 'bad name"': "y", hidden: false, "data-on": true },
      }),
    );
    const a = host.querySelector("a")!;
    expect(a.getAttribute("onmouseover")).toBeNull();
    expect(a.getAttribute("onclick")).toBeNull();
    expect(a.getAttribute("data-id")).toBe('4" onclick="x');
    expect(a.hasAttribute("hidden")).toBe(false);
    expect(a.hasAttribute("data-on")).toBe(true);
  });

  it("adds rel=noopener with a target", () => {
    const a = render(
      cardLink({ href: "/x", className: "c", body: "b", target: "_blank" }),
    ).querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener");
  });
});

describe("cardButton()", () => {
  it("renders a type=button with the row classes", () => {
    const btn = render(
      cardButton({ className: "table-row", body: "<span>INV-1</span>", attrs: { "data-invoice-id": 9 } }),
    ).querySelector("button")!;
    expect(btn.type).toBe("button");
    expect(btn.classList.contains("table-row")).toBe(true);
    expect(btn.dataset.invoiceId).toBe("9");
    expect(btn.hasAttribute("role")).toBe(false);
  });
});

describe("isModifiedClick()", () => {
  it("is true for Ctrl, Meta, Shift, Alt and non-primary buttons", () => {
    expect(isModifiedClick(new MouseEvent("click"))).toBe(false);
    expect(isModifiedClick(new MouseEvent("click", { ctrlKey: true }))).toBe(true);
    expect(isModifiedClick(new MouseEvent("click", { metaKey: true }))).toBe(true);
    expect(isModifiedClick(new MouseEvent("click", { shiftKey: true }))).toBe(true);
    expect(isModifiedClick(new MouseEvent("click", { altKey: true }))).toBe(true);
    expect(isModifiedClick(new MouseEvent("click", { button: 1 }))).toBe(true);
  });
});

describe("bindCardSelect()", () => {
  function setup(onSelect: (card: HTMLElement, e: MouseEvent) => boolean | void) {
    const host = render(
      cardLink({ href: "/x?id=7", className: "card", body: "b", attrs: { "data-id": 7 } }),
    );
    document.body.appendChild(host);
    bindCardSelect(host, ".card", onSelect);
    return host.querySelector<HTMLAnchorElement>("a.card")!;
  }

  it("emits on a plain click and leaves navigation to the anchor", () => {
    const onSelect = vi.fn();
    const a = setup(onSelect);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].dataset.id).toBe("7");
    expect(ev.defaultPrevented).toBe(false);
    a.remove();
  });

  it("never prevents a modified click, even when the handler cancels", () => {
    const a = setup(() => false);
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      a.dispatchEvent(ev);
      expect(ev.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    a.remove();
  });

  it("cancels a plain click only when the handler returns false", () => {
    const a = setup(() => false);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    a.remove();
  });

  it("emits on a middle-click (auxclick) too", () => {
    const onSelect = vi.fn();
    const a = setup(onSelect);
    a.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    a.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    a.remove();
  });
});

describe("CARD_LINK_STYLES", () => {
  it("puts the focus ring on the anchor and button, not on a wrapper", () => {
    expect(CARD_LINK_STYLES).toContain("a.nw-card-link:focus-visible");
    expect(CARD_LINK_STYLES).toContain("button.nw-card-button:focus-visible");
  });
});
