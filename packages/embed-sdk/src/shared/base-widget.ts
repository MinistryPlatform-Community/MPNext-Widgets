import { getAuthSession, type AuthSession } from "./auth-session";
import {
  getFormatters,
  getLocaleSession,
  onOverridesChange,
  tEnglish,
  type Formatters,
  type LocaleCode,
  type LocaleSession,
  type MessageKey,
  type Translator,
} from "../i18n";

/**
 * Wire error codes whose catalogue key is spelled differently, plus the ones
 * that deliberately share a sentence.
 *
 * `src/app/api/embed/**` answers with a snake_case machine code; the catalogue
 * uses this repo's camelCase key convention for the generic errors. Mapping
 * here keeps each sentence written exactly once across three locales instead of
 * carrying `authRequired` and `auth_required` side by side.
 *
 * `invalid_body` and `invalid_request` collapse onto one sentence on purpose:
 * both mean the widget sent something malformed, which a congregant can do
 * nothing about and should never see spelled out.
 */
export const WIRE_CODE_KEYS: Record<string, MessageKey> = {
  auth_required: "errors.authRequired",
  session_expired: "errors.sessionExpired",
  rate_limited: "errors.rateLimited",
  invalid_request: "errors.invalidRequest",
  invalid_body: "errors.invalidRequest",
  internal_error: "errors.generic",
  // The anonymous-write routes (`unsubscribe`, and C70's opt-in) answer
  // `save_failed` when MP accepted the read and refused the write. It maps onto
  // the sentence `errors.saveFailed` already carries rather than introducing an
  // `errors.save_failed` spelling of the same words in three catalogues — which
  // is exactly what this table is for.
  save_failed: "errors.saveFailed",
  // `withAnonymousWrite` refuses anything but POST. A visitor can do nothing
  // about it — it means the widget built a bad request — so it deliberately
  // degrades to the generic sentence rather than surfacing an HTTP concept.
  // Mapped explicitly rather than left to `errorText`'s unmapped-code fallback,
  // so `error-codes.test.ts` can see that the choice was made on purpose. It
  // reached `main` with no entry at all because the guard scanned only route
  // files, and this code is emitted from `src/lib/embed/`.
  method_not_allowed: "errors.generic",
};

/**
 * Base class for MPNext embeddable widgets
 * Handles Shadow DOM, API communication, token management and localisation
 */
export abstract class MPNextWidget extends HTMLElement {
  protected root: ShadowRoot;
  protected apiHost: string;
  protected tokenProvider: () => Promise<string>;

  /**
   * Translator for this widget's resolved locale.
   *
   * Seeded with the English translator so a widget that renders before
   * `initLocale()` resolves still produces text rather than throwing. Replaced
   * with the real translator by `applyLocale()`.
   */
  protected t: Translator = tEnglish;

  /** Locale-aware date / number / list formatters. */
  protected fmt: Formatters = getFormatters("en");

  /** The resolved locale for this element. */
  protected locale: LocaleCode = "en";

  private localeUnsubscribe: (() => void) | null = null;
  private overridesUnsubscribe: (() => void) | null = null;
  private langObserver: MutationObserver | null = null;

  /**
   * The `lang` value this class last wrote onto the host, so `declaredLang()`
   * can tell a page author's declaration (an input) from our own accessibility
   * reflection (an output). Without this the first render would pin the widget
   * to that locale forever — the host's own `lang` is the highest-priority
   * rung, so reading back what we wrote would outrank every later change.
   */
  private reflectedLang: string | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });

    // Determine API host: element attribute → script tag origin → empty
    this.apiHost =
      this.getAttribute("api-host") ||
      this.detectApiHostFromScript() ||
      "";

    // Token provider — resolved lazily via waitForTokenProvider()
    this.tokenProvider =
      window.__nextTokenProvider?.get ||
      (async () => {
        console.warn("No token provider initialized.");
        return this.getAttribute("token") || "";
      });
  }

  /**
   * Derive the API host from the SDK script's own URL.
   */
  private detectApiHostFromScript(): string {
    // Prefer host set by the cache-busting loader
    if ((window as any).__nextEmbedApiHost) {
      return (window as any).__nextEmbedApiHost;
    }

    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[src*="next-embed"]',
    );
    for (const s of scripts) {
      try {
        return new URL(s.src).origin;
      } catch { /* continue */ }
    }

    // Fall back to a sibling widget's api-host (handles Vite dev, where the SDK
    // is a local module import — no "next-embed" script tag — and a widget
    // without an explicit api-host would otherwise fetch the wrong origin).
    const sibling = document.querySelector(
      "next-user-menu, next-add-to-calendar, next-full-calendar, next-profile, next-my-invoices, next-my-contribution-statement, next-statement-preferences, next-my-giving, next-my-household, next-my-pledges, next-my-groups, next-subscriptions, next-unsubscribe, next-subscribe-to-publication, next-event-finder, next-event-details, next-group-finder, next-group-details, next-plan-your-visit, next-prayer-feedback, next-pre-check, next-custom-form, next-checkout, next-pay, next-checkout-complete",
    );
    if (sibling && sibling !== this) {
      const host = sibling.getAttribute("api-host");
      if (host) return host;
    }

    return "";
  }

  /**
   * Fetch wrapper with automatic token injection and refresh on 401
   */
  protected async fetch(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    await this.waitForTokenProvider();

    const token = await this.tokenProvider();

    if (!token) {
      throw new Error("Authentication token not available.");
    }

    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    };

    const res = await fetch(`${this.apiHost}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      mode: "cors",
    });

    // Handle token refresh on 401
    if (res.status === 401 && window.__nextTokenProvider?.refresh) {
      const newToken = await window.__nextTokenProvider.refresh();
      return fetch(`${this.apiHost}${path}`, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${newToken}`,
        },
        credentials: "omit",
        mode: "cors",
      });
    }

    return res;
  }

  /**
   * Inject CSS into Shadow DOM
   * Uses Constructable Stylesheets when available, fallback to <style> tag
   */
  protected injectStyles(css: string): void {
    if (
      "adoptedStyleSheets" in Document.prototype &&
      "replace" in CSSStyleSheet.prototype
    ) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        this.root.adoptedStyleSheets = [sheet];
      } catch {
        this.injectStyleTag(css);
      }
    } else {
      this.injectStyleTag(css);
    }
  }

  private injectStyleTag(css: string): void {
    const style = document.createElement("style");
    style.textContent = css;
    this.root.appendChild(style);
  }

  /**
   * Wait for token provider to be initialized (max 5 seconds)
   */
  private async waitForTokenProvider(): Promise<void> {
    if (window.__nextSDKReady) {
      await window.__nextSDKReady;
    }

    const maxWait = 5000;
    const interval = 100;
    const start = Date.now();

    while (!window.__nextTokenProvider) {
      if (Date.now() - start > maxWait) {
        throw new Error(
          "Token provider not initialized after 5 seconds.",
        );
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    this.tokenProvider = window.__nextTokenProvider.get;
  }

  /**
   * Page-wide AuthSession (mode discovery, sid, login/logout helpers).
   */
  protected get authSession(): AuthSession {
    return getAuthSession(this.apiHost);
  }

  // ── Localisation ─────────────────────────────────────────────────────────

  /** Page-wide locale singleton (resolution, catalogue loading, onChange). */
  protected get localeSession(): LocaleSession {
    return getLocaleSession();
  }

  /**
   * Resolve this widget's locale, load its catalogue, and keep it in step.
   *
   * Call once at the top of `connectedCallback` and **await it before the first
   * `render()`** — that ordering is what stops a visitor seeing English swap to
   * Spanish. It is nearly free in practice: every widget already paints a
   * loading state while it fetches its own data, so the catalogue fetch (one
   * static file from the same origin already serving the SDK) hides inside a
   * window that exists anyway. English resolves synchronously.
   *
   * Idempotent, so re-entering `connectedCallback` after a move in the DOM does
   * not stack subscriptions.
   */
  protected async initLocale(): Promise<void> {
    const session = this.localeSession;
    this.applyLocale();

    if (!this.localeUnsubscribe) {
      this.localeUnsubscribe = session.onChange(() => {
        const previous = this.locale;
        this.applyLocale();
        // A page-wide switch that does not change *this* element's locale
        // (because it declares its own `lang`) must not trigger a re-render.
        if (this.isConnected && this.locale !== previous) this.render();
      });
    }

    // Label overrides are a separate signal and must NOT go through the check
    // above: `MPNextEmbed.setMessages()` changes the copy without changing the
    // locale, so a locale-equality guard would swallow it and the override
    // would only appear on the next unrelated re-render. Found by
    // `e2e/widget/localisation.spec.ts`, which set an override on an
    // already-Spanish page and watched nothing happen.
    if (!this.overridesUnsubscribe) {
      this.overridesUnsubscribe = onOverridesChange(() => {
        this.applyLocale();
        if (this.isConnected) this.render();
      });
    }

    // A page author changing `lang` on the element after mount should switch
    // that widget. Watched with a MutationObserver rather than through
    // `observedAttributes` for two reasons: it needs no edit to the 30
    // components' static attribute lists (11 of which have none at all), and it
    // sidesteps `attributeChangedCallback` entirely — several implementations
    // ignore the first set (filed as C39), and our own reflection writes would
    // otherwise feed back in as input.
    if (!this.langObserver && typeof MutationObserver === "function") {
      this.langObserver = new MutationObserver(() => {
        const previous = this.locale;
        this.applyLocale();
        if (this.locale === previous) return; // our own reflection, or a no-op
        void session.readyForLocale(this.locale).then(() => {
          this.applyLocale();
          if (this.isConnected) this.render();
        });
      });
      this.langObserver.observe(this, {
        attributes: true,
        attributeFilter: ["lang"],
      });
    }

    await session.readyForLocale(this.locale);
    this.applyLocale();
  }

  /**
   * Point `t` / `fmt` at the current locale and reflect it for assistive tech.
   */
  private applyLocale(): void {
    const session = this.localeSession;
    this.locale = session.localeForDeclared(this.declaredLang());
    this.t = session.translator(this.locale);
    this.fmt = session.formatters(this.locale);
    this.reflectLocale();
  }

  /**
   * The `lang` a page author declared for this widget, or null.
   *
   * Reads the host's own attribute only when it is not the value we reflected,
   * then walks ancestors from `parentElement` so the reflection can never be
   * mistaken for a declaration. `<html lang>` is excluded here — it is a lower
   * rung, handled inside `LocaleSession`, so that a visitor's stored choice
   * still beats the page's default.
   */
  private declaredLang(): string | null {
    const own = this.getAttribute("lang");
    if (own && own !== this.reflectedLang) return own;

    try {
      const tagged = this.parentElement?.closest?.("[lang]");
      if (tagged && tagged !== document.documentElement) {
        return tagged.getAttribute("lang");
      }
    } catch {
      /* detached node */
    }
    return null;
  }

  /**
   * Mirror the resolved locale onto the host as `lang` / `dir`, so screen
   * readers switch voice pronunciation and a future RTL locale lays out
   * correctly.
   *
   * `dir` has to be an attribute rather than inherited CSS: every widget's
   * styles open with `:host { all: initial }`, which resets `direction`.
   */
  private reflectLocale(): void {
    try {
      if (this.getAttribute("lang") !== this.locale) {
        this.reflectedLang = this.locale;
        this.setAttribute("lang", this.locale);
      }
      const dir = this.localeSession.getDirection(this.locale);
      if (this.getAttribute("dir") !== dir) this.setAttribute("dir", dir);
    } catch {
      /* attribute writes cannot fail meaningfully; never break a render */
    }
  }

  /**
   * Turn an API error response into a sentence for the visitor.
   *
   * Routes answer `{ error: "<machine_code>", message: "<English>" }`. The code
   * is the contract; the English `message` is a debug aid that is logged and
   * **never rendered**, so a congregant never reads "Missing formId or formGuid"
   * — in any language. An unmapped code degrades to `errors.generic`, which is
   * what makes adding a route safe.
   *
   * Most codes are named identically to their catalogue key, so the lookup is
   * just `errors.<code>`. `WIRE_CODE_KEYS` covers the ones that are not, rather
   * than duplicating the same sentence under two spellings in three catalogues.
   */
  protected errorText(
    payload: unknown,
    fallbackKey: MessageKey = "errors.generic",
  ): string {
    const body = (payload ?? {}) as { error?: unknown; message?: unknown };
    const code = typeof body.error === "string" ? body.error : "";

    if (code) {
      const key = WIRE_CODE_KEYS[code] ?? (`errors.${code}` as MessageKey);
      const text = this.t(key);
      // `t()` returns the key itself when nothing matches, in `en` either.
      if (text !== key) return text;
      if (typeof body.message === "string" && body.message) {
        console.warn(
          `[mpnext] Unmapped API error code "${code}" (server message: ${body.message})`,
        );
      }
    }
    return this.t(fallbackKey);
  }

  /**
   * Cleanup. **A subclass that defines its own `disconnectedCallback` must call
   * `super.disconnectedCallback()`** — six of the thirty components already
   * define one, and without the super call each mount leaks a locale
   * subscription and a MutationObserver.
   */
  disconnectedCallback(): void {
    this.localeUnsubscribe?.();
    this.localeUnsubscribe = null;
    this.overridesUnsubscribe?.();
    this.overridesUnsubscribe = null;
    this.langObserver?.disconnect();
    this.langObserver = null;
  }

  /**
   * Ask for sign-in. Emits a cancelable, bubbling `loginRequired` event with
   * `{ wid }` so host pages that already handle login keep working. When the
   * event is not prevented and the auth mode is `dual` or `hardened`, the SDK
   * navigates to the widget host's login route itself. In `legacy` (or before
   * the mode is known) behavior is unchanged: the event is the only signal.
   */
  protected requestLogin(wid: string): void {
    const ev = new CustomEvent("loginRequired", {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: { wid },
    });
    const handled = !this.dispatchEvent(ev);
    const mode = this.authSession.getMode();
    if (!handled && mode !== null && mode !== "legacy") {
      this.authSession.login({ wid });
    }
  }

  /**
   * Emit custom event from widget
   */
  protected emit(eventName: string, detail?: unknown): void {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  abstract render(): void;
  abstract connectedCallback(): void;
}

declare global {
  interface Window {
    __nextTokenProvider?: {
      get: () => Promise<string>;
      refresh?: () => Promise<string>;
    };
    __nextSDKReady?: Promise<void>;
    __nextSDKReadyResolve?: () => void;
  }
}
