/**
 * Guard: `render()` owns its listener re-bind.
 *
 * The base class re-renders a widget through `render()` alone — on a page-wide
 * locale change (`MPNextEmbed.setLocale`, `next-locale-selector`), a label
 * override (`MPNextEmbed.setMessages`), or a `lang` attribute edit. A widget
 * that paints in `render()` and binds in a separate `attachListeners()` that
 * its *own* call sites run afterwards comes back from any of those with every
 * button dead. Twenty widgets had exactly that shape.
 *
 * The rule this enforces: no `this.render();` immediately followed by a
 * `this.attach…Listeners();`. Either `render()` calls the binder itself (the
 * usual fix: `render() { this.paintMarkup(); this.attachListeners(); }`), or
 * the widget binds by delegation once. A pair left behind after the fix is
 * worse than the bug, because the elements are then bound twice and a submit
 * fires twice.
 *
 * `PENDING` was a ratchet for files another workstream owned (W1 payments:
 * checkout, checkout-complete, my-invoices, pay); all four are fixed and it is
 * empty. It fails when an entry stops matching, so a fixing commit deletes its
 * entry. Never add to it.
 */
import { describe, it, expect } from "vitest";

const PENDING = new Set<string>([]);

const sources = import.meta.glob(["./*.ts", "!./*.test.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const PAIR = /this\.render\(\);[ \t]*(?:\/\/[^\n]*)?\r?\n[ \t]*this\.attach\w*Listeners\(\);/;

describe("render() re-binds its own listeners", () => {
  it("finds the component sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  for (const [file, src] of Object.entries(sources)) {
    if (PENDING.has(file)) {
      it(`${file} is still pending (delete it from PENDING once fixed)`, () => {
        expect(PAIR.test(src)).toBe(true);
      });
      continue;
    }
    it(`${file} never binds listeners after render() at a call site`, () => {
      expect(PAIR.test(src)).toBe(false);
    });
  }
});
