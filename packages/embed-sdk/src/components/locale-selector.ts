import { MPNextWidget } from "../shared/base-widget";
import { LOCALE_CODES, endonym, type LocaleCode } from "../i18n";

/**
 * `next-locale-selector` — lets a visitor choose the widget language.
 *
 * The counterpart to MinistryPlatform's `<mpp-locale-selector>`, which sat
 * top-left on all 21 pages of MP's sample site and was the control that decided
 * which language `GetLabels` returned (filed as C73). Without it a bilingual
 * church could not serve its congregation from these widgets at all.
 *
 * ## Why this is usually not the important path
 *
 * The `LocaleSession` resolution ladder reads `<html lang>`, so a bilingual site
 * whose CMS marks up its own pages — WordPress/Polylang and friends — gets
 * translated widgets with **no snippet change and no selector**. This element is
 * for sites that cannot set `lang`, or that want to offer the choice explicitly
 * on an otherwise single-language page. Document the `<html lang>` route first;
 * reach for this second.
 *
 * ## Zero translated strings of its own
 *
 * Option labels are **endonyms** from `Intl.DisplayNames` — "English",
 * "Español", "Português (Brasil)" — each language named in its own language,
 * which is what a language picker should always do (a Spanish speaker looking
 * for their language scans for "Español", not for "Spanish"). The platform
 * already knows every one of these, so the roster costs nothing to translate and
 * a new locale needs no new copy here.
 *
 * Attributes:
 *   `variant="select" | "inline"`  dropdown (default) or a row of buttons
 *   `hide-label`                   render the label to screen readers only
 *   `locales="en,es"`              restrict the offered set (default: all shipped)
 *
 * Unlike every other widget here this one needs no token and makes no API call,
 * so it renders immediately and works on a fully public page.
 */
export class LocaleSelectorWidget extends MPNextWidget {
  static get observedAttributes() {
    return ["variant", "hide-label", "locales"];
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    // Guard the first set: `attributeChangedCallback` fires before
    // `connectedCallback` for attributes present in the parsed markup, and
    // rendering then would run before `injectStyles` (filed as C39 for the
    // widgets that get this wrong).
    if (oldValue === newValue || !this.isConnected) return;
    this.render();
    this.attachListeners();
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    // No catalogue await before the first paint: the only copy this widget
    // renders is the label, and the endonyms come from the platform. Still
    // `initLocale()`, so the label localises and the control re-renders when a
    // sibling widget or another tab changes the language.
    void this.initLocale().then(() => {
      this.render();
      this.attachListeners();
    });
  }

  /** The locales to offer: the `locales` attribute filtered to shipped ones. */
  private offered(): LocaleCode[] {
    const requested = this.getAttribute("locales");
    if (!requested) return [...LOCALE_CODES];

    const wanted = requested
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const filtered = LOCALE_CODES.filter((code) =>
      wanted.includes(code.toLowerCase()),
    );
    // An attribute naming nothing we ship would leave the visitor with an empty
    // control, which is worse than ignoring it.
    return filtered.length ? filtered : [...LOCALE_CODES];
  }

  render() {
    const locales = this.offered();
    const current = this.locale;
    const hideLabel = this.hasAttribute("hide-label");
    const label = this.t("localeSelector.label");
    const ariaLabel = this.t("localeSelector.ariaLabel");

    // A single offered locale makes the control meaningless — render nothing
    // rather than a dropdown with one option.
    if (locales.length < 2) {
      this.root.innerHTML = "";
      return;
    }

    const body =
      this.getAttribute("variant") === "inline"
        ? this.renderInline(locales, current)
        : this.renderSelect(locales, current, ariaLabel);

    this.root.innerHTML = `
      <div class="nw-ls">
        <label class="nw-ls-label ${hideLabel ? "nw-ls-sr" : ""}" for="nw-ls-select">
          ${this.escapeHtml(label)}
        </label>
        ${body}
      </div>`;
  }

  private renderSelect(
    locales: LocaleCode[],
    current: LocaleCode,
    ariaLabel: string,
  ): string {
    const options = locales
      .map(
        (code) =>
          `<option value="${this.escapeAttr(code)}" ${code === current ? "selected" : ""}>${this.escapeHtml(endonym(code))}</option>`,
      )
      .join("");

    return `
      <select
        id="nw-ls-select"
        class="nw-ls-select"
        aria-label="${this.escapeAttr(ariaLabel)}"
      >${options}</select>`;
  }

  private renderInline(locales: LocaleCode[], current: LocaleCode): string {
    // `aria-current="true"` rather than a disabled button: the active language
    // stays focusable, which is how a screen-reader user discovers which one is
    // selected.
    const buttons = locales
      .map(
        (code) =>
          `<button
             type="button"
             class="nw-ls-btn ${code === current ? "nw-ls-btn--active" : ""}"
             data-locale="${this.escapeAttr(code)}"
             lang="${this.escapeAttr(code)}"
             ${code === current ? 'aria-current="true"' : ""}
           >${this.escapeHtml(endonym(code))}</button>`,
      )
      .join("");

    return `<div class="nw-ls-inline" role="group">${buttons}</div>`;
  }

  private attachListeners() {
    const select = this.root.querySelector<HTMLSelectElement>("#nw-ls-select");
    if (select) {
      select.addEventListener("change", () => {
        void this.choose(select.value);
      });
    }

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
      ".nw-ls-btn",
    )) {
      btn.addEventListener("click", () => {
        void this.choose(btn.dataset.locale || "");
      });
    }
  }

  /**
   * Apply the choice page-wide.
   *
   * `setLocale` persists it and notifies every mounted widget, so all of them
   * re-render together — and only after the catalogue is in hand, so the page
   * does not flash through English on the way.
   */
  private async choose(code: string) {
    if (!code || code === this.locale) return;
    await this.localeSession.setLocale(code);
    this.emit("localeChanged", { locale: this.localeSession.getLocale() });
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: inline-block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-ls { display: inline-flex; align-items: center; gap: 8px; }
      .nw-ls-label { font-size: 13px; font-weight: 600; color: #6b7280; }

      /* Visually hidden but still announced — not display:none, which would
         remove the label from the accessibility tree entirely. */
      .nw-ls-sr {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
      }

      .nw-ls-select {
        padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px;
        font-size: 14px; font-family: inherit; color: #2D2926; background: white;
        outline: none; cursor: pointer;
      }
      .nw-ls-select:focus-visible { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }

      .nw-ls-inline { display: inline-flex; gap: 4px; }
      .nw-ls-btn {
        padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 8px;
        background: white; font-size: 13px; font-family: inherit; font-weight: 600;
        color: #004C97; cursor: pointer;
      }
      .nw-ls-btn:hover { border-color: #004C97; }
      .nw-ls-btn:focus-visible { outline: 2px solid #004C97; outline-offset: 2px; }
      .nw-ls-btn--active { background: #004C97; border-color: #004C97; color: white; cursor: default; }
    `;
  }
}

customElements.define("next-locale-selector", LocaleSelectorWidget);
