/**
 * `dialogFocus()` (CROSS-3 class 4: C08, C54).
 *
 * C08's calendar modal declared `aria-modal` and never moved focus in; C54's
 * user menu dropped focus to `<body>` on close. The contract under test: focus
 * in on open, Tab trapped while open, focus back to the trigger on close — and
 * **not** back to the trigger after an outside click.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { dialogFocus, focusableWithin } from "./dialog-focus";

function setup(inner = `<button id="a">A</button><input id="b"><button id="c">C</button>`) {
  document.body.innerHTML = `
    <button id="trigger">Open</button>
    <button id="elsewhere">Elsewhere</button>
    <div id="dialog" role="dialog" aria-modal="true">${inner}</div>`;
  const trigger = document.getElementById("trigger") as HTMLButtonElement;
  const dialog = document.getElementById("dialog") as HTMLElement;
  trigger.focus();
  return { trigger, dialog };
}

const tab = (el: Element, shiftKey = false) => {
  const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};

describe("dialogFocus()", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("moves focus to the first focusable element on open", () => {
    const { dialog } = setup();
    dialogFocus(dialog, null);
    expect(document.activeElement?.id).toBe("a");
  });

  it("honours initialFocus, as an element or a selector", () => {
    const { dialog, trigger } = setup();
    dialogFocus(dialog, trigger, { initialFocus: "#b" }).release();
    expect(document.activeElement).toBe(trigger);
    dialogFocus(dialog, trigger, { initialFocus: document.getElementById("c") });
    expect(document.activeElement?.id).toBe("c");
  });

  it("focuses the container itself when it holds nothing focusable", () => {
    const { dialog } = setup(`<p>Just text</p>`);
    dialogFocus(dialog, null);
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute("tabindex")).toBe("-1");
  });

  it("wraps Tab from the last element to the first, and Shift+Tab back", () => {
    const { dialog } = setup();
    dialogFocus(dialog, null);
    const c = document.getElementById("c")!;
    c.focus();
    const forward = tab(c);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("a");

    const back = tab(document.getElementById("a")!, true);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("c");
  });

  it("leaves Tab alone in the middle of the dialog", () => {
    const { dialog } = setup();
    dialogFocus(dialog, null);
    expect(tab(document.getElementById("a")!).defaultPrevented).toBe(false);
  });

  it("does not trap Tab when trapTab is false (menus)", () => {
    const { dialog } = setup();
    dialogFocus(dialog, null, { trapTab: false });
    const c = document.getElementById("c")!;
    c.focus();
    expect(tab(c).defaultPrevented).toBe(false);
  });

  it("returns focus to the trigger on close", () => {
    const { dialog, trigger } = setup();
    const handle = dialogFocus(dialog, trigger);
    handle.release("programmatic");
    expect(document.activeElement).toBe(trigger);
    expect(handle.active).toBe(false);
  });

  it("returns focus to the trigger on Escape, via onEscape", () => {
    const { dialog, trigger } = setup();
    const onEscape = vi.fn(() => {
      dialog.hidden = true;
    });
    const handle = dialogFocus(dialog, trigger, { onEscape });
    document.getElementById("b")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(handle.active).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("does NOT steal focus back after an outside-click close", () => {
    const { dialog, trigger } = setup();
    const handle = dialogFocus(dialog, trigger);
    const elsewhere = document.getElementById("elsewhere")!;
    elsewhere.focus(); // what the outside click did
    handle.release("outside");
    expect(document.activeElement).toBe(elsewhere);
  });

  it("restores after an outside click only when asked to", () => {
    const { dialog, trigger } = setup();
    const handle = dialogFocus(dialog, trigger, { restoreOnOutsideClick: true });
    dialog.remove();
    handle.release("outside");
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves focus alone when the visitor already moved it elsewhere", () => {
    const { dialog, trigger } = setup();
    const handle = dialogFocus(dialog, trigger);
    const elsewhere = document.getElementById("elsewhere")!;
    elsewhere.focus();
    handle.release("programmatic");
    expect(document.activeElement).toBe(elsewhere);
  });

  it("resolves a function trigger late, for widgets that re-render it", () => {
    const { dialog } = setup();
    let current: HTMLElement | null = null;
    const handle = dialogFocus(dialog, () => current);
    const fresh = document.createElement("button");
    document.body.appendChild(fresh);
    current = fresh;
    handle.release();
    expect(document.activeElement).toBe(fresh);
  });

  it("works inside a shadow root", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button class="t">T</button><div class="m"><button class="o">O</button></div>`;
    const trigger = shadow.querySelector<HTMLElement>(".t")!;
    const menu = shadow.querySelector<HTMLElement>(".m")!;
    const handle = dialogFocus(menu, trigger);
    expect(shadow.activeElement).toBe(shadow.querySelector(".o"));
    handle.release("escape");
    expect(shadow.activeElement).toBe(trigger);
  });

  it("is idempotent and stops listening once released", () => {
    const { dialog, trigger } = setup();
    const handle = dialogFocus(dialog, trigger);
    handle.release();
    handle.release();
    const c = document.getElementById("c")!;
    c.focus();
    expect(tab(c).defaultPrevented).toBe(false);
  });
});

describe("focusableWithin()", () => {
  it("skips disabled, hidden-input, tabindex=-1 and [hidden] subtrees", () => {
    document.body.innerHTML = `<div id="r">
      <button>ok</button><button disabled>no</button><input type="hidden">
      <span tabindex="-1">no</span><span tabindex="0">ok</span>
      <div hidden><button>no</button></div><a href="#">ok</a><a>no</a></div>`;
    expect(focusableWithin(document.getElementById("r")!)).toHaveLength(3);
  });
});
