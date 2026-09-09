/**
 * Integration tests for the widget side of localisation: `MPNextWidget`'s
 * locale plumbing, and the `next-locale-selector` element.
 *
 * The `declaredLang` tests carry the most weight. The host's `lang` is both an
 * input (a page author declaring the language — the highest-priority rung) and
 * an output (the base class reflecting the resolved locale so screen readers
 * switch voice). Confusing the two pins a widget to whatever it rendered first,
 * and nothing about that failure looks like a bug in the resolution ladder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MPNextWidget } from "../shared/base-widget";
import {
  __clearOverrides,
  __resetFormatterCaches,
  __resetLocaleSession,
  getLocaleSession,
  setOverrides,
} from ".";
import "../components/locale-selector";

/** Minimal concrete widget: records every render so re-renders are countable. */
class TestWidget extends MPNextWidget {
  renderCount = 0;
  lastText = "";

  connectedCallback() {
    void this.initLocale().then(() => this.render());
  }

  render() {
    this.renderCount++;
    this.lastText = this.t("common.save");
    this.root.innerHTML = `<span>${this.lastText}</span>`;
  }

  /** Test seams onto the protected members. */
  publicT(key: Parameters<TestWidget["t"]>[0]) {
    return this.t(key);
  }
  publicFmt() {
    return this.fmt;
  }
  publicLocale() {
    return this.locale;
  }
  publicErrorText(payload: unknown) {
    return this.errorText(payload);
  }
}
customElements.define("test-i18n-widget", TestWidget);

/**
 * Wait for `initLocale()` to finish and the widget to have rendered.
 *
 * English resolves synchronously, but a non-English locale is a dynamic
 * `import()` of its catalogue chunk, so the widget's
 * `initLocale().then(render)` chain needs the session's own promise to settle
 * first and then a tick for the `.then`. Awaiting `ready` rather than counting
 * ticks keeps this from being flaky as the catalogues grow.
 */
async function settle(): Promise<void> {
  await getLocaleSession().ready.catch(() => {});
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * Poll until `check` passes.
 *
 * `settle()` awaits the *page-wide* catalogue, which is not always the one a
 * given widget needs: an element with its own `lang` loads a different chunk on
 * its own promise chain. Rather than guess a tick count per case, wait for the
 * observable outcome.
 */
async function waitFor(check: () => boolean, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  expect(check(), "condition never became true").toBe(true);
}

function mount<T extends HTMLElement>(tag: string, attrs: Record<string, string> = {}): T {
  const el = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
  __clearOverrides();
  __resetFormatterCaches();
  __resetLocaleSession();
  try {
    window.localStorage.clear();
  } catch {
    /* blocked */
  }
  vi.restoreAllMocks();
});

describe("MPNextWidget locale plumbing", () => {
  it("renders English by default", async () => {
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    expect(el.lastText).toBe("Save");
    expect(el.publicLocale()).toBe("en");
  });

  it("follows <html lang>", async () => {
    document.documentElement.setAttribute("lang", "es");
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    expect(el.lastText).toBe("Guardar");
  });

  it("lets the element's own lang win over <html lang>", async () => {
    document.documentElement.setAttribute("lang", "es");
    const el = mount<TestWidget>("test-i18n-widget", { lang: "pt-BR" });
    await waitFor(() => el.lastText === "Salvar");
    expect(el.publicLocale()).toBe("pt-BR");
    expect(el.lastText).toBe("Salvar");
  });

  it("follows an ancestor's lang, so a bilingual section works", async () => {
    const section = mount<HTMLDivElement>("div", { lang: "es" });
    const el = document.createElement("test-i18n-widget") as TestWidget;
    section.appendChild(el);
    await settle();
    expect(el.publicLocale()).toBe("es");
  });

  it("reflects lang and dir onto the host for assistive tech", async () => {
    document.documentElement.setAttribute("lang", "es");
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    expect(el.getAttribute("lang")).toBe("es");
    // `dir` must be an attribute: every widget's styles open with
    // `:host { all: initial }`, which resets the `direction` property.
    expect(el.getAttribute("dir")).toBe("ltr");
  });

  it("does not mistake its own reflected lang for a declaration", async () => {
    // The regression this guards: reflecting `lang="es"` onto the host, then
    // reading it back as rung 1, pins the widget to `es` forever and a later
    // `setLocale` silently does nothing to it.
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    expect(el.getAttribute("lang")).toBe("en"); // reflected, not declared

    await getLocaleSession().setLocale("pt-BR");
    await settle();

    expect(el.publicLocale()).toBe("pt-BR");
    expect(el.lastText).toBe("Salvar");
    expect(el.getAttribute("lang")).toBe("pt-BR");
  });

  it("re-renders once when the page-wide locale changes", async () => {
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    const before = el.renderCount;

    await getLocaleSession().setLocale("es");
    await settle();

    // Once, into Spanish — not twice via English, which would flash.
    expect(el.renderCount).toBe(before + 1);
    expect(el.lastText).toBe("Guardar");
  });

  it("does not re-render a widget pinned by its own lang", async () => {
    const el = mount<TestWidget>("test-i18n-widget", { lang: "en" });
    await settle();
    const before = el.renderCount;

    await getLocaleSession().setLocale("es");
    await settle();

    expect(el.renderCount).toBe(before);
    expect(el.lastText).toBe("Save");
  });

  it("switches when a page author changes lang after mount", async () => {
    const el = mount<TestWidget>("test-i18n-widget", { lang: "en" });
    await settle();

    el.setAttribute("lang", "es");
    // The MutationObserver fires as a microtask, then awaits the catalogue.
    await waitFor(() => el.lastText === "Guardar");
    expect(el.publicLocale()).toBe("es");
  });

  it("stops listening once disconnected", async () => {
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    el.remove();
    const before = el.renderCount;

    await getLocaleSession().setLocale("es");
    await settle();

    // A leaked subscription here is invisible in the UI and only shows up as
    // slow drift after many mounts, which is why it gets its own test.
    expect(el.renderCount).toBe(before);
  });

  it("honours a label override", async () => {
    setOverrides("*", { "common.save": "Store it" });
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    expect(el.lastText).toBe("Store it");
  });

  it("exposes locale-aware formatters", async () => {
    document.documentElement.setAttribute("lang", "es");
    const el = mount<TestWidget>("test-i18n-widget");
    await settle();
    expect(el.publicFmt().date("2026-09-10", "long")).toContain("septiembre");
  });
});

describe("errorText", () => {
  let el: TestWidget;

  beforeEach(async () => {
    el = mount<TestWidget>("test-i18n-widget");
    await settle();
  });

  it("translates a machine code", () => {
    expect(el.publicErrorText({ error: "invoice_not_found" })).toBe(
      "We could not find that invoice.",
    );
  });

  it("maps a wire code whose catalogue key is spelled differently", () => {
    expect(el.publicErrorText({ error: "auth_required" })).toBe(
      "Please sign in to continue.",
    );
  });

  it("never renders the server's English message", () => {
    // The whole point: a congregant must not read "Missing formId or formGuid".
    const text = el.publicErrorText({
      error: "invalid_request",
      message: "Missing formId or formGuid",
    });
    expect(text).not.toContain("formId");
    expect(text).toBe("That request was not valid. Please try again.");
  });

  it("falls back to a generic sentence for an unmapped code", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(el.publicErrorText({ error: "brand_new_code", message: "Kaboom" })).toBe(
      "Something went wrong. Please try again.",
    );
    // Reported, so an unmapped code is findable rather than silent.
    expect(warn).toHaveBeenCalled();
  });

  it("handles a missing or malformed payload", () => {
    const generic = "Something went wrong. Please try again.";
    expect(el.publicErrorText(undefined)).toBe(generic);
    expect(el.publicErrorText(null)).toBe(generic);
    expect(el.publicErrorText({})).toBe(generic);
    expect(el.publicErrorText({ error: 42 })).toBe(generic);
  });

  it("translates the code, not the message, in Spanish", async () => {
    await getLocaleSession().setLocale("es");
    await settle();
    expect(el.publicErrorText({ error: "invoice_not_found" })).toBe(
      "No encontramos esa factura.",
    );
  });
});

describe("next-locale-selector", () => {
  it("offers every shipped locale, named in its own language", async () => {
    const el = mount("next-locale-selector");
    await settle();

    const options = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("option"),
    ];
    expect(options.map((o) => o.value)).toEqual(["en", "es", "pt-BR"]);
    // Endonyms from Intl.DisplayNames — a Spanish speaker scans for "Español",
    // not for "Spanish", and this costs no translated strings.
    expect(options.map((o) => o.textContent).join(" ").toLowerCase()).toContain(
      "espa",
    );
  });

  it("marks the current locale as selected", async () => {
    document.documentElement.setAttribute("lang", "es");
    const el = mount("next-locale-selector");
    await settle();

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("es");
  });

  it("changes the page-wide locale and notifies siblings", async () => {
    const widget = mount<TestWidget>("test-i18n-widget");
    const selector = mount("next-locale-selector");
    await settle();
    expect(widget.lastText).toBe("Save");

    const select = selector.shadowRoot!.querySelector<HTMLSelectElement>("select")!;
    select.value = "es";
    select.dispatchEvent(new Event("change"));
    await settle();
    await settle();

    expect(getLocaleSession().getLocale()).toBe("es");
    expect(widget.lastText).toBe("Guardar");
  });

  it("emits localeChanged", async () => {
    const el = mount("next-locale-selector");
    await settle();
    const seen: string[] = [];
    el.addEventListener("localeChanged", (e) => {
      seen.push((e as CustomEvent<{ locale: string }>).detail.locale);
    });

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("select")!;
    select.value = "pt-BR";
    select.dispatchEvent(new Event("change"));
    await settle();
    await settle();

    expect(seen).toEqual(["pt-BR"]);
  });

  it("restricts the offered set via the locales attribute", async () => {
    const el = mount("next-locale-selector", { locales: "en,es" });
    await settle();
    const values = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("option"),
    ].map((o) => o.value);
    expect(values).toEqual(["en", "es"]);
  });

  it("ignores a locales attribute naming nothing we ship", async () => {
    // Better to offer everything than to leave the visitor an empty control.
    const el = mount("next-locale-selector", { locales: "de,fr" });
    await settle();
    const values = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("option"),
    ].map((o) => o.value);
    expect(values).toEqual(["en", "es", "pt-BR"]);
  });

  it("renders nothing when only one locale is on offer", async () => {
    // A picker with one option is worse than no picker.
    const el = mount("next-locale-selector", { locales: "es" });
    await settle();
    expect(el.shadowRoot!.querySelector("select")).toBeNull();
    expect(el.shadowRoot!.querySelector(".nw-ls")).toBeNull();
  });

  it("renders a button group in inline mode, marking the active one", async () => {
    const el = mount("next-locale-selector", { variant: "inline" });
    await settle();

    const buttons = [
      ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".nw-ls-btn"),
    ];
    expect(buttons.length).toBe(3);
    const active = buttons.filter((b) => b.getAttribute("aria-current") === "true");
    expect(active.length).toBe(1);
    expect(active[0]?.dataset.locale).toBe("en");
    // Each button is tagged with its own language so a screen reader pronounces
    // "Español" in Spanish rather than reading it as English.
    expect(buttons.map((b) => b.getAttribute("lang"))).toEqual([
      "en",
      "es",
      "pt-BR",
    ]);
  });

  it("switches from an inline button", async () => {
    const el = mount("next-locale-selector", { variant: "inline" });
    await settle();

    el.shadowRoot!
      .querySelector<HTMLButtonElement>('[data-locale="es"]')!
      .click();
    await settle();
    await settle();

    expect(getLocaleSession().getLocale()).toBe("es");
  });

  it("keeps its label reachable when hidden", async () => {
    const el = mount("next-locale-selector", { "hide-label": "" });
    await settle();
    const label = el.shadowRoot!.querySelector(".nw-ls-label");
    // Visually hidden, but still in the accessibility tree — not display:none.
    expect(label).not.toBeNull();
    expect(label?.classList.contains("nw-ls-sr")).toBe(true);
    expect(label?.textContent?.trim()).toBe("Language");
  });

  it("localises its own label", async () => {
    document.documentElement.setAttribute("lang", "es");
    const el = mount("next-locale-selector");
    await settle();
    expect(
      el.shadowRoot!.querySelector(".nw-ls-label")?.textContent?.trim(),
    ).toBe("Idioma");
  });
});
