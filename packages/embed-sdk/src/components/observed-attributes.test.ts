/**
 * Guard: widget attributes are kebab-case (C79, CROSS-4).
 *
 * An unknown attribute on a custom element throws nothing and logs nothing, so
 * a host who guesses `hide-soft-credits` where the widget reads
 * `hidesoftcredits` silently keeps the default. One spelling rule across the
 * catalogue is what makes an attribute predictable rather than something to
 * look up, and this test is what turns that rule from a convention a reviewer
 * has to remember into one the suite enforces — in the spirit of
 * `src/lib/no-template-concat.test.ts`.
 *
 * Two exemptions, both meant to shrink to nothing:
 *
 * - **`attributeAliases` values.** A renamed attribute keeps its old spelling
 *   for one release, declared on the class and read through
 *   `MPNextWidget.readAttr()`, which warns once.
 * - **`LEGACY_SPELLINGS`** — a ratchet over the five flat-lowercase names that
 *   predate the rule. It fails when an entry stops being used, so the
 *   workstream that renames an attribute (W3 / W5 / W6) must delete its entry
 *   in the same commit. Never add to it.
 */
import { describe, it, expect } from "vitest";
import { MPNextWidget } from "../shared/base-widget";

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Ratchet. Delete an entry when its widget renames the attribute. Never add. */
const LEGACY_SPELLINGS: Record<string, string> = {
  hidesoftcredits: "next-my-giving → hide-soft-credits (W5)",
  hideaddhouseholdmember: "next-my-household → hide-add-household-member (W6)",
  hidecancelbuttonpledge: "next-my-pledges → hide-cancel-button-pledge (W5)",
  cancelpledgeemailtemplate: "next-my-pledges → cancel-pledge-email-template (W5)",
};

type WidgetClass = typeof MPNextWidget & {
  observedAttributes?: string[];
  name: string;
};

const modules = import.meta.glob(["./*.ts", "!./*.test.ts"], {
  eager: true,
}) as Record<string, Record<string, unknown>>;

const widgets: WidgetClass[] = [];
for (const mod of Object.values(modules)) {
  for (const value of Object.values(mod)) {
    if (typeof value === "function" && value.prototype instanceof MPNextWidget) {
      if (!widgets.includes(value as WidgetClass)) widgets.push(value as WidgetClass);
    }
  }
}

function observed(cls: WidgetClass): string[] {
  return (cls.observedAttributes ?? []).map(String);
}

function aliases(cls: WidgetClass): Record<string, string> {
  return { ...(cls.attributeAliases ?? {}) };
}

describe("observedAttributes naming (C79)", () => {
  it("finds the widget classes it is supposed to check", () => {
    // A guard against the guard: a glob that silently matched nothing would
    // make every assertion below pass.
    expect(widgets.length).toBeGreaterThanOrEqual(30);
    expect(widgets.map((w) => w.name)).toContain("PreCheckWidget");
  });

  it("every observed attribute is kebab-case, an alias, or a ratcheted legacy spelling", () => {
    const offenders: string[] = [];
    for (const cls of widgets) {
      const aliasValues = new Set(Object.values(aliases(cls)));
      for (const attr of observed(cls)) {
        if (KEBAB.test(attr)) continue;
        if (aliasValues.has(attr)) continue;
        if (attr in LEGACY_SPELLINGS) continue;
        offenders.push(`${cls.name}: "${attr}"`);
      }
    }
    expect(
      offenders,
      "Widget attributes are kebab-case. Rename, and read any old spelling via readAttr() + attributeAliases.",
    ).toEqual([]);
  });

  it("has no LEGACY_SPELLINGS entry that is no longer in use (ratchet)", () => {
    const stillUsed = new Set<string>();
    for (const cls of widgets) {
      const aliasValues = new Set(Object.values(aliases(cls)));
      for (const attr of observed(cls)) {
        if (!aliasValues.has(attr)) stillUsed.add(attr);
      }
    }
    const stale = Object.keys(LEGACY_SPELLINGS).filter((name) => !stillUsed.has(name));
    expect(
      stale,
      "These were renamed: delete them from LEGACY_SPELLINGS in this commit.",
    ).toEqual([]);
  });

  it("declares every alias against a kebab-case name, and observes both spellings", () => {
    const problems: string[] = [];
    for (const cls of widgets) {
      const names = new Set(observed(cls));
      for (const [kebab, legacy] of Object.entries(aliases(cls))) {
        if (!KEBAB.test(kebab)) problems.push(`${cls.name}: alias key "${kebab}" is not kebab-case`);
        if (!names.has(kebab)) problems.push(`${cls.name}: "${kebab}" is not observed`);
        if (!names.has(legacy)) problems.push(`${cls.name}: legacy "${legacy}" is not observed`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the pattern itself accepts kebab-case and rejects the drift it exists to catch", () => {
    for (const ok of ["api-host", "campaign-id", "show-suggest-a-group-button", "lang", "x2-y"]) {
      expect(KEBAB.test(ok), ok).toBe(true);
    }
    for (const bad of ["hideSoftCredits", "hide_soft_credits", "-hide", "hide-", "hide--x", "2fa"]) {
      expect(KEBAB.test(bad), bad).toBe(false);
    }
  });
});
