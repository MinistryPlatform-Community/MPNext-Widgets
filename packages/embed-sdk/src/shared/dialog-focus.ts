/**
 * Focus management for dialogs, popovers and menus (CROSS-3 class 4: C08, C54).
 *
 * Lifted from `next-add-to-calendar`, which already did it right, so there is
 * one implementation rather than one per widget:
 *
 * 1. **Open** — focus moves into the container (the first focusable element,
 *    or `initialFocus`; the container itself when it holds nothing focusable).
 * 2. **While open** — Tab and Shift+Tab cycle inside the container
 *    (`trapTab`, default on; a `role="menu"` passes `false`, because Tab out of
 *    a menu is expected to leave it). Escape calls `onEscape` when given.
 * 3. **Close** — `release(reason)` returns focus to the trigger, **except**
 *    after an outside click (`"outside"`): the visitor clicked something else,
 *    and yanking focus back to the trigger would fight them. Opt back in with
 *    `restoreOnOutsideClick`. Focus is also left alone when it has already
 *    moved somewhere else on purpose.
 *
 * ```ts
 * import { dialogFocus, type DialogFocusHandle } from "../shared/dialog-focus";
 *
 * this.modalFocus = dialogFocus(modalEl, triggerButton, {
 *   onEscape: () => this.closeModal("escape"),
 * });
 * // in closeModal(reason): … re-render …; this.modalFocus?.release(reason);
 * ```
 *
 * `trigger` may be a function, for widgets that re-render the trigger on close
 * and so cannot hold the original element.
 */

export type DialogCloseReason = "escape" | "outside" | "programmatic";

export interface DialogFocusOptions {
  /** What to focus on open: an element, or a selector inside the container. */
  initialFocus?: HTMLElement | string | null;
  /** Keep Tab inside the container while open. Default `true`. */
  trapTab?: boolean;
  /**
   * Escape pressed inside the container. Close the dialog here; `release` is
   * then called with `"escape"` for you, returning focus to the trigger.
   */
  onEscape?: () => void;
  /** Return focus to the trigger even after an outside-click close. Default `false`. */
  restoreOnOutsideClick?: boolean;
}

export interface DialogFocusHandle {
  /** Stop managing focus and (usually) return it to the trigger. Idempotent. */
  release(reason?: DialogCloseReason): void;
  /** False once released. */
  readonly active: boolean;
}

type TriggerRef = HTMLElement | null | (() => HTMLElement | null | undefined);

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

/** Focusable descendants of `container`, in document order. */
export function focusableWithin(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[hidden], [inert]"),
  );
}

/** The focused element as seen from `container`'s tree (shadow-aware). */
function activeIn(root: Node): Element | null {
  const scope = root as Document | ShadowRoot;
  return "activeElement" in scope ? scope.activeElement : null;
}

function resolveTrigger(trigger: TriggerRef): HTMLElement | null {
  return (typeof trigger === "function" ? trigger() : trigger) ?? null;
}

export function dialogFocus(
  container: HTMLElement,
  trigger: TriggerRef,
  opts: DialogFocusOptions = {},
): DialogFocusHandle {
  const root = container.getRootNode();
  const trapTab = opts.trapTab !== false;
  let active = true;

  const onKeyDown = (e: KeyboardEvent) => {
    if (!active) return;
    if (e.key === "Escape" && opts.onEscape) {
      e.preventDefault();
      e.stopPropagation();
      opts.onEscape();
      handle.release("escape");
      return;
    }
    if (e.key !== "Tab" || !trapTab) return;

    const items = focusableWithin(container);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = activeIn(root);
    if (e.shiftKey && (current === first || !container.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !container.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener("keydown", onKeyDown);

  // Move focus in.
  let target: HTMLElement | null = null;
  if (typeof opts.initialFocus === "string") {
    target = container.querySelector<HTMLElement>(opts.initialFocus);
  } else if (opts.initialFocus) {
    target = opts.initialFocus;
  }
  if (!target) target = focusableWithin(container)[0] ?? null;
  if (!target) {
    if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
    target = container;
  }
  try {
    target.focus();
  } catch {
    /* focus is best-effort */
  }

  const handle: DialogFocusHandle = {
    get active() {
      return active;
    },
    release(reason: DialogCloseReason = "programmatic") {
      if (!active) return;
      active = false;
      container.removeEventListener("keydown", onKeyDown);

      if (reason === "outside" && !opts.restoreOnOutsideClick) return;

      // Leave focus alone if the visitor already put it somewhere else.
      const current = activeIn(root);
      const docActive = document.activeElement;
      const lost =
        current === null || current === document.body
          ? docActive === null || docActive === document.body
          : container.contains(current) || !current.isConnected;
      if (!lost) return;

      const back = resolveTrigger(trigger);
      if (back && back.isConnected) {
        try {
          back.focus();
        } catch {
          /* best-effort */
        }
      }
    },
  };
  return handle;
}
