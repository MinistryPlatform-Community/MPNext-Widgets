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

describe("shadow-hosted content (C54: the account modal hosts widgets)", () => {
  /** A dialog whose second child is a "widget" with its own open shadow root. */
  function setupNested() {
    document.body.innerHTML = `
      <button id="trigger">Open</button>
      <div id="dialog" role="dialog" aria-modal="true">
        <button id="close">Close</button>
        <x-widget id="w"></x-widget>
      </div>`;
    const host = document.getElementById("w")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input class="f1"><select class="f2"><option>1</option></select><button class="save">Save</button>`;
    return {
      dialog: document.getElementById("dialog")!,
      trigger: document.getElementById("trigger")!,
      host,
      shadow,
    };
  }

  it("focusableWithin() descends into open shadow roots in composed order", () => {
    const { dialog } = setupNested();
    const names = focusableWithin(dialog).map((el) => el.id || el.className);
    expect(names).toEqual(["close", "f1", "f2", "save"]);
  });

  it("follows slots to their assigned light children, in slot order", () => {
    document.body.innerHTML = `<div id="d"><x-host id="h"><button id="slotted">S</button><button id="unslotted" slot="nowhere">U</button></x-host></div>`;
    const shadow = document.getElementById("h")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button class="before">B</button><slot></slot><button class="after">A</button>`;
    const names = focusableWithin(document.getElementById("d")!).map((el) => el.id || el.className);
    expect(names).toEqual(["before", "slotted", "after"]);
  });

  it("prunes a [hidden] host's shadow content", () => {
    const { dialog, host } = setupNested();
    host.hidden = true;
    expect(focusableWithin(dialog).map((el) => el.id)).toEqual(["close"]);
  });

  it("wraps Tab from the last field inside a nested widget back to the first", () => {
    const { dialog, trigger, shadow } = setupNested();
    dialogFocus(dialog, trigger);
    const save = shadow.querySelector<HTMLElement>(".save")!;
    save.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true, cancelable: true });
    save.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("close");
  });

  it("does not trap Tab while it moves between fields of a nested widget", () => {
    const { dialog, trigger, shadow } = setupNested();
    dialogFocus(dialog, trigger);
    const f1 = shadow.querySelector<HTMLElement>(".f1")!;
    f1.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true, cancelable: true });
    f1.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("wraps Shift+Tab from the first element to the last nested field", () => {
    const { dialog, trigger, shadow } = setupNested();
    dialogFocus(dialog, trigger);
    const ev = tab(document.getElementById("close")!, true);
    expect(ev.defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(shadow.querySelector(".save"));
  });

  it("returns focus to the trigger when it was last inside a nested widget", () => {
    const { dialog, trigger, shadow } = setupNested();
    const handle = dialogFocus(dialog, trigger);
    shadow.querySelector<HTMLElement>(".f1")!.focus();
    handle.release("programmatic");
    expect(document.activeElement).toBe(trigger);
  });
});
